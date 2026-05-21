import React from 'react';
import { MarkdownNode, TextNode, reconciler } from './reconciler.js';

// Access React internals to intercept the hooks dispatcher.
// React 18: __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current
// React's Fizz server renderer (renderToString) sets useEffect/useLayoutEffect
// to noop in its HooksDispatcher. We replicate this by intercepting the
// ReactCurrentDispatcher.current property during our render pass.
const ReactSharedInternals: Record<string, unknown> | null = (
  React as Record<string, unknown>
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as Record<
  string,
  unknown
> | null;

function noop(): void {}

/**
 * Intercept the React hooks dispatcher so that useEffect, useLayoutEffect,
 * and useInsertionEffect become no-ops — matching React Fizz SSR behavior.
 *
 * Uses a refcount so multiple concurrent renderToMarkdownString calls
 * (e.g. via p-map) safely share a single interceptor and only restore the
 * original descriptor when the last render completes.
 *
 * Returns a cleanup function that decrements the refcount.
 */
let interceptorRefCount = 0;
let originalDescriptor: PropertyDescriptor | undefined;
let realCurrent: Record<string, unknown> | null = null;
let cachedTarget: unknown = null;
let cachedProxy: unknown = null;

const transparentBlockTypes = new Set([
  'address',
  'article',
  'aside',
  'details',
  'div',
  'figcaption',
  'figure',
  'footer',
  'form',
  'header',
  'main',
  'nav',
  'section',
  'summary',
]);

const markdownBlockTypes = new Set([
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
]);

function installEffectInterceptor(): () => void {
  if (!ReactSharedInternals) {
    return noop;
  }

  const ReactCurrentDispatcher =
    ReactSharedInternals.ReactCurrentDispatcher as Record<
      string,
      unknown
    > | null;
  if (!ReactCurrentDispatcher) {
    return noop;
  }

  interceptorRefCount++;
  if (interceptorRefCount === 1) {
    // First caller — save the original descriptor and install the interceptor.
    originalDescriptor = Object.getOwnPropertyDescriptor(
      ReactCurrentDispatcher,
      'current',
    );
    realCurrent = ReactCurrentDispatcher.current as Record<
      string,
      unknown
    > | null;
    cachedTarget = null;
    cachedProxy = null;

    Object.defineProperty(ReactCurrentDispatcher, 'current', {
      get() {
        if (realCurrent == null) {
          return realCurrent;
        }
        // Cache the proxy per dispatcher identity to avoid creating a new one
        // on every property access.
        if (cachedTarget !== realCurrent) {
          cachedTarget = realCurrent;
          cachedProxy = new Proxy(realCurrent, {
            get(target, prop, receiver) {
              if (
                prop === 'useEffect' ||
                prop === 'useLayoutEffect' ||
                prop === 'useInsertionEffect'
              ) {
                return noop;
              }
              return Reflect.get(target, prop, receiver);
            },
          });
        }
        return cachedProxy;
      },
      set(value) {
        realCurrent = value;
      },
      configurable: true,
    });
  }

  return () => {
    interceptorRefCount--;
    if (interceptorRefCount === 0) {
      // Last caller — restore the original property descriptor.
      if (originalDescriptor) {
        Object.defineProperty(
          ReactCurrentDispatcher,
          'current',
          originalDescriptor,
        );
      } else {
        (ReactCurrentDispatcher as Record<string, unknown>).current = undefined;
        ReactCurrentDispatcher.current = realCurrent;
      }
    }
  };
}

function isFlowContainer(type: string): boolean {
  return type === 'root' || transparentBlockTypes.has(type);
}

function isBlockBoundary(child: MarkdownNode | TextNode): boolean {
  return (
    child instanceof MarkdownNode &&
    (transparentBlockTypes.has(child.type) ||
      markdownBlockTypes.has(child.type))
  );
}

function startsWithNewline(value: string): boolean {
  return value.charCodeAt(0) === 10;
}

function endsWithNewline(value: string): boolean {
  return value.charCodeAt(value.length - 1) === 10;
}

function hasBlankLineBoundary(
  previousMarkdown: string,
  markdown: string,
): boolean {
  return (
    previousMarkdown.endsWith('\n\n') ||
    markdown.startsWith('\n\n') ||
    (endsWithNewline(previousMarkdown) && startsWithNewline(markdown))
  );
}

function getBlockSeparator(
  previousChild: MarkdownNode | TextNode,
  child: MarkdownNode | TextNode,
  previousMarkdown: string,
  markdown: string,
): string {
  if (
    previousMarkdown.length === 0 ||
    markdown.length === 0 ||
    (!isBlockBoundary(previousChild) && !isBlockBoundary(child)) ||
    hasBlankLineBoundary(previousMarkdown, markdown)
  ) {
    return '';
  }

  if (endsWithNewline(previousMarkdown) || startsWithNewline(markdown)) {
    return '\n';
  }

  return '\n\n';
}

function childToMarkdown(child: MarkdownNode | TextNode): string {
  if (child instanceof TextNode) {
    return child.text;
  }
  return toMarkdown(child);
}

function renderChildren(root: MarkdownNode): string {
  const { children } = root;

  if (children.length === 0) {
    return '';
  }

  const shouldSeparateBlocks = isFlowContainer(root.type);
  const parts: string[] = [];
  let previousChild: MarkdownNode | TextNode | undefined;
  let previousMarkdown = '';

  for (const child of children) {
    const markdown = childToMarkdown(child);
    const separator =
      shouldSeparateBlocks && previousChild
        ? getBlockSeparator(previousChild, child, previousMarkdown, markdown)
        : '';

    if (separator) {
      parts.push(separator);
    }

    parts.push(markdown);

    if (markdown.length > 0) {
      previousChild = child;
      previousMarkdown = markdown;
    }
  }

  return parts.join('');
}

// Convert node tree to Markdown string
function toMarkdown(root: MarkdownNode): string {
  const { type, props, children } = root;

  // Get children's Markdown lazily so ignored nodes do not serialize children.
  const getChildrenMarkdown = () => renderChildren(root);

  // Generate corresponding Markdown based on element type
  switch (type) {
    case 'root':
      return getChildrenMarkdown();
    case 'h1':
      return `# ${getChildrenMarkdown()}\n\n`;
    case 'h2':
      return `## ${getChildrenMarkdown()}\n\n`;
    case 'h3':
      return `### ${getChildrenMarkdown()}\n\n`;
    case 'h4':
      return `#### ${getChildrenMarkdown()}\n\n`;
    case 'h5':
      return `##### ${getChildrenMarkdown()}\n\n`;
    case 'h6':
      return `###### ${getChildrenMarkdown()}\n\n`;
    case 'p':
      return `${getChildrenMarkdown()}\n\n`;
    case 'strong':
    case 'b':
      return `**${getChildrenMarkdown()}**`;
    case 'em':
    case 'i':
      return `*${getChildrenMarkdown()}*`;
    case 'code':
      // When <code> is nested inside <pre>, it represents the code block body,
      // so we must not wrap it with inline backticks (would create nested fences).
      if (root.parent?.type === 'pre') {
        return getChildrenMarkdown();
      }
      return `\`${getChildrenMarkdown()}\``;
    case 'pre': {
      const _language =
        props['data-lang'] || props.language || props.lang || '';

      const language = typeof _language === 'string' ? _language : '';
      const title = props['data-title'] || '';
      const block = ['markdown', 'mdx', 'md', ''].includes(language)
        ? '````'
        : '```';

      return `\n${block}${language}${title ? ` title=${title}` : ''}\n${getChildrenMarkdown()}\n${block}\n`;
    }
    case 'a':
      return `[${getChildrenMarkdown()}](${props.href || '#'})`;
    case 'img':
      return `![${props.alt || ''}](${props.src || ''})`;
    case 'ul':
      return `${getChildrenMarkdown()}\n`;
    case 'ol':
      return `${getChildrenMarkdown()}\n`;
    case 'li': {
      const isOrdered = root.parent && root.parent.type === 'ol';
      const prefix = isOrdered ? '1. ' : '- ';
      return `${prefix}${getChildrenMarkdown()}\n`;
    }
    case 'blockquote':
      return `> ${getChildrenMarkdown().split('\n').join('\n> ')}\n\n`;
    case 'br':
      return '\n';
    case 'hr':
      return '---\n\n';
    case 'style':
      return '';
    case 'table':
      return `${getChildrenMarkdown()}\n`;
    case 'thead':
      return getChildrenMarkdown();
    case 'tbody':
      return getChildrenMarkdown();
    case 'tr': {
      const cells = children
        .filter((child): child is MarkdownNode => child instanceof MarkdownNode)
        .map((cell) => toMarkdown(cell).trim());

      // If it's a header row, add separator
      if (root.parent && root.parent.type === 'thead') {
        const separator = `|${cells.map(() => ' --- ').join('|')}|\n`;
        return `| ${cells.join(' | ')} |\n${separator}`;
      }

      return `| ${cells.join(' | ')} |\n`;
    }
    case 'th':
    case 'td':
      return getChildrenMarkdown();
    default:
      return getChildrenMarkdown();
  }
}

// Render function (SSR-like behavior: neither useEffect nor useLayoutEffect run)
export async function renderToMarkdownString(
  element: React.ReactElement,
): Promise<string> {
  const container = new MarkdownNode('root');

  const root = reconciler.createContainer(
    container,
    0, // tag (LegacyRoot = 0)
    null, // hydrationCallbacks
    false, // isStrictMode
    false, // concurrentUpdatesByDefaultOverride
    '', // identifierPrefix
    (error: Error) => {
      if (process.env.DEBUG) {
        console.error('Reconciler onRecoverableError:', error);
      }
    }, // onRecoverableError
    null, // transitionCallbacks
  );

  // Intercept the React hooks dispatcher to make useEffect / useLayoutEffect
  // / useInsertionEffect no-ops, matching React Fizz SSR behavior.
  const removeInterceptor = installEffectInterceptor();

  try {
    // Set up a promise that resolves when commit completes
    let resolveCommit: ((arg: string) => void) | null = null;
    const commitPromise = new Promise<string>((resolve) => {
      resolveCommit = resolve;
    });

    reconciler.updateContainer(element, root, null, () => {
      // This callback is called after commit
      if (resolveCommit) {
        resolveCommit(toMarkdown(container));
      }
    });

    reconciler.flushSync();
    return await commitPromise;
  } finally {
    removeInterceptor();
  }
}
