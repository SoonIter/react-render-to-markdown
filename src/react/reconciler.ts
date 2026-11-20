import { createContext } from 'react';
import createReconciler, { type ReactContext } from 'react-reconciler';
import {
  DefaultEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants.js';

// Define types
type ElementNames = string;
type Props = Record<string, unknown>;
type HostContext = {
  isInsideText: boolean;
};

// React 19.2/19.3 commit flags used by the pinned reconciler 0.33.
// Commit reveal/deletion paths call refs and class lifecycles without checking
// flags. Mask them on Fibers for the commit, leaving user instances untouched.
type CommitFiber = {
  tag: number;
  flags: number;
  ref: unknown;
  stateNode: unknown;
  alternate: CommitFiber | null;
  deletions: CommitFiber[] | null;
  child: CommitFiber | null;
  sibling: CommitFiber | null;
};
const clientClassLifecycles = new Set([
  'componentDidMount',
  'componentDidUpdate',
  'componentWillUnmount',
  'getSnapshotBeforeUpdate',
]);

function suppressClientCommit(fiber: CommitFiber | null): () => void {
  const restorations: (() => void)[] = [];
  const visited = new Set<CommitFiber>();
  const suppress = (node: CommitFiber) => {
    if (visited.has(node)) return;
    visited.add(node);
    node.flags &= ~512; // Ref
    const ref = node.ref;
    node.ref = null;
    restorations.push(() => {
      node.ref = ref;
    });
    if (node.tag === 1) {
      node.flags &= ~(4 | 1024); // Class layout lifecycle and snapshot
      const instance = node.stateNode as Record<string, unknown>;
      const commitInstance = new Proxy(instance, {
        get(target, prop) {
          if (typeof prop === 'string' && clientClassLifecycles.has(prop)) {
            return undefined;
          }
          const value = Reflect.get(target, prop, target);
          // Error callbacks and any synchronous render retry must retain the
          // original `this`, including access to private fields.
          return typeof value === 'function' && prop !== 'constructor'
            ? value.bind(target)
            : value;
        },
        set(target, prop, value) {
          return Reflect.set(target, prop, value, target);
        },
      });
      node.stateNode = commitInstance;
      restorations.push(() => {
        // Passive deletion may already have detached this Fiber.
        if (node.stateNode === commitInstance) node.stateNode = instance;
      });
    }
  };
  const traverse = (first: CommitFiber | null) => {
    for (let node = first; node; node = node.sibling) {
      suppress(node);
      if (node.alternate) suppress(node.alternate);
      for (const deleted of node.deletions ?? []) traverse(deleted);
      traverse(node.child);
    }
  };
  traverse(fiber);
  return () => {
    for (const restore of restorations) restore();
  };
}

// Text node class
export class TextNode {
  hidden = false;
  public text: string;
  public parent?: MarkdownNode;

  constructor(text: string) {
    this.text = text;
  }

  setText(text: string): void {
    this.text = text;
  }
}

// Markdown node class
export class MarkdownNode {
  hidden = false;
  onCommit?: () => void;
  renderRoot?: { current: { alternate: CommitFiber | null } };
  restoreClientCommit?: () => void;
  public type: string;
  public props: Record<string, unknown>;
  public children: (MarkdownNode | TextNode)[];
  public parent?: MarkdownNode;

  constructor(type: string, props: Record<string, unknown> = {}) {
    this.type = type;
    this.props = props;
    this.children = [];
  }

  appendChild(child: MarkdownNode | TextNode): void {
    this.children.push(child);
    if ('parent' in child) {
      child.parent = this;
    }
  }

  removeChild(child: MarkdownNode | TextNode): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  insertBefore(
    child: MarkdownNode | TextNode,
    beforeChild: MarkdownNode | TextNode,
  ): void {
    const index = this.children.indexOf(beforeChild);
    if (index !== -1) {
      this.children.splice(index, 0, child);
    } else {
      this.appendChild(child);
    }
    if ('parent' in child) {
      child.parent = this;
    }
  }
}

// Current update priority
let currentUpdatePriority = NoEventPriority;

// Create React Reconciler config
const hostConfig: createReconciler.HostConfig<
  string,
  Props,
  MarkdownNode,
  MarkdownNode,
  TextNode,
  MarkdownNode,
  unknown,
  unknown,
  unknown,
  HostContext,
  unknown,
  unknown,
  unknown,
  unknown
> = {
  // Basic capabilities
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,

  // Get root host context
  getRootHostContext(): HostContext {
    return { isInsideText: false };
  },

  // Get child host context
  getChildHostContext(
    parentHostContext: HostContext,
    type: string,
  ): HostContext {
    const previousIsInsideText = parentHostContext.isInsideText;
    // Determine whether this should be treated as text
    const isInsideText =
      type === 'text' || type === 'span' || previousIsInsideText;

    if (previousIsInsideText === isInsideText) {
      return parentHostContext;
    }

    return { isInsideText };
  },

  // Create instance
  createInstance(type: string, props: Props): MarkdownNode {
    return new MarkdownNode(type, props);
  },

  // Create text instance
  createTextInstance(text: string): TextNode {
    return new TextNode(text);
  },

  // Determine whether to set text content directly
  shouldSetTextContent(_type: string, _props: Props): boolean {
    // For simple text content, return false so React creates a text node
    return false;
  },

  // Append child
  appendChild(parent: MarkdownNode, child: MarkdownNode | TextNode): void {
    parent.appendChild(child);
  },

  // Insert child before another
  insertBefore(
    parent: MarkdownNode,
    child: MarkdownNode | TextNode,
    beforeChild: MarkdownNode | TextNode,
  ): void {
    parent.insertBefore(child, beforeChild);
  },

  // Remove child
  removeChild(parent: MarkdownNode, child: MarkdownNode | TextNode): void {
    parent.removeChild(child);
  },

  // Commit text update
  commitTextUpdate(
    textInstance: TextNode,
    _oldText: string,
    newText: string,
  ): void {
    textInstance.setText(newText);
  },

  // Commit update
  commitUpdate(
    instance: MarkdownNode,
    _type: string,
    _oldProps: Props,
    newProps: Props,
    _internalHandle: unknown,
  ): void {
    // Update instance props with new props
    instance.props = newProps;
  },

  // Finalize initial children
  finalizeInitialChildren(): boolean {
    // Return false to prevent commitMount from being called
    return false;
  },

  // Host commitMount is separate from class lifecycle callbacks.
  commitMount(): void {
    // No-op: In SSR/static rendering, we don't want lifecycle methods to run
  },

  // Clear container
  clearContainer(container: MarkdownNode): void {
    container.children = [];
  },

  // Handle update priority
  setCurrentUpdatePriority(newPriority: number): void {
    currentUpdatePriority = newPriority;
  },

  getCurrentUpdatePriority(): number {
    return currentUpdatePriority;
  },

  resolveUpdatePriority(): number {
    if (currentUpdatePriority !== NoEventPriority) {
      return currentUpdatePriority;
    }
    return DefaultEventPriority;
  },

  // Append initial child
  appendInitialChild(
    parent: MarkdownNode,
    child: MarkdownNode | TextNode,
  ): void {
    parent.appendChild(child);
  },

  preparePortalMount(): void {
    // Portal mount preparation logic
  },

  // Other required implementations
  resetTextContent(): void {},
  getPublicInstance(instance: MarkdownNode | TextNode) {
    return instance;
  },
  prepareForCommit(containerInfo: MarkdownNode): null {
    containerInfo.restoreClientCommit?.();
    const restore = suppressClientCommit(
      containerInfo.renderRoot?.current.alternate ?? null,
    );
    containerInfo.restoreClientCommit = restore;
    // resetAfterCommit runs before layout effects. Restore only once React has
    // finished the entire synchronous commit, including Suspense reveal work.
    queueMicrotask(() => {
      if (containerInfo.restoreClientCommit === restore) {
        restore();
        containerInfo.restoreClientCommit = undefined;
      }
    });
    return null;
  },
  resetAfterCommit(containerInfo: MarkdownNode): void {
    containerInfo.onCommit?.();
  },
  // Use real setTimeout/clearTimeout to allow React to schedule work properly
  // Effects will still be scheduled, but we'll read the result before they execute
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  scheduleMicrotask:
    typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (fn: () => unknown) => Promise.resolve().then(fn),
  getInstanceFromNode(): null {
    return null;
  },
  beforeActiveInstanceBlur(): void {},
  afterActiveInstanceBlur(): void {},
  prepareScopeUpdate(): void {},
  getInstanceFromScope(): null {
    return null;
  },
  detachDeletedInstance(): void {},

  // Container related methods
  appendChildToContainer(
    container: MarkdownNode,
    child: MarkdownNode | TextNode,
  ): void {
    container.appendChild(child);
  },

  insertInContainerBefore(
    container: MarkdownNode,
    child: MarkdownNode | TextNode,
    beforeChild: MarkdownNode | TextNode,
  ): void {
    container.insertBefore(child, beforeChild);
  },

  removeChildFromContainer(
    container: MarkdownNode,
    child: MarkdownNode | TextNode,
  ): void {
    container.removeChild(child);
  },

  hideInstance(_instance: MarkdownNode): void {
    _instance.hidden = true;
    // Logic to hide an instance; can set a flag here
  },

  hideTextInstance(textInstance: TextNode): void {
    textInstance.hidden = true;
  },

  unhideInstance(_instance: MarkdownNode): void {
    _instance.hidden = false;
    // Logic to unhide an instance
  },

  unhideTextInstance(textInstance: TextNode, text: string): void {
    textInstance.hidden = false;
    textInstance.setText(text);
  },

  // React 19 additional methods
  maySuspendCommit(): boolean {
    return false;
  },

  preloadInstance(): boolean {
    return true;
  },

  startSuspendingCommit(): void {},

  suspendInstance(): void {},

  waitForCommitToBeReady(): null {
    return null;
  },

  NotPendingTransition: null as unknown,

  HostTransitionContext: createContext(
    null,
  ) as unknown as ReactContext<unknown>,

  resetFormInstance(): void {},

  requestPostPaintCallback(): void {},

  shouldAttemptEagerTransition(): boolean {
    return false;
  },

  trackSchedulerEvent(): void {},

  resolveEventType(): null {
    return null;
  },

  resolveEventTimeStamp(): number {
    return -1.1;
  },
};

// Create reconciler instance
export const reconciler = createReconciler<
  ElementNames,
  Props,
  MarkdownNode,
  MarkdownNode,
  TextNode,
  MarkdownNode,
  unknown,
  unknown,
  unknown,
  HostContext,
  unknown,
  unknown,
  unknown,
  unknown
>(hostConfig);
