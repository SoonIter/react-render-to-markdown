import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import React, { useImperativeHandle, useRef } from 'react';
import { renderToPipeableStream, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderToMarkdownString } from './render';

function createDeferredValue() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForRender(rendered: () => boolean) {
  await expect.poll(rendered).toBe(true);
  await setImmediate();
}

async function renderAllToHtml(element: React.ReactElement) {
  let html = '';
  await new Promise<void>((resolve, reject) => {
    const destination = new Writable({
      write(chunk, _encoding, next) {
        html += chunk.toString();
        next();
      },
    });
    destination.on('finish', resolve);
    destination.on('error', reject);
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(destination);
      },
      onError: reject,
    });
  });
  return html;
}

describe('SSR behavior and documented renderer differences', () => {
  it('rejects transition and optimistic updates during server rendering', async () => {
    const Transition = () => {
      const [, start] = React.useTransition();
      start(() => {});
      return null;
    };
    const Optimistic = () => {
      const [, update] = React.useOptimistic('initial');
      update('updated');
      return null;
    };
    for (const element of [
      <Transition key="transition" />,
      <Optimistic key="optimistic" />,
    ]) {
      expect(() => renderToString(element)).toThrow();
      await expect(renderToMarkdownString(element)).rejects.toThrow();
    }
  });

  it('rejects errors even when a class boundary catches them', async () => {
    const calls: string[] = [];
    class Boundary extends React.Component<{ children: React.ReactNode }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch() {
        calls.push('caught');
      }
      render() {
        return this.state.failed ? <p>Fallback</p> : this.props.children;
      }
    }
    const Comp = (): React.ReactNode => {
      throw new Error('Broken');
    };
    const element = (
      <Boundary>
        <Comp />
      </Boundary>
    );
    expect(() => renderToString(element)).toThrow('Broken');
    expect(calls).toEqual([]);
    await expect(renderToMarkdownString(element)).rejects.toThrow('Broken');
    // Client error callbacks remain supported, although Fizz skips boundaries.
    expect(calls).toEqual(['caught']);
  });

  it('keeps concurrent contexts isolated and retains distinct client reconciler IDs', async () => {
    const Context = React.createContext('default');
    const Comp = () => <p>{`${React.useContext(Context)}:${React.useId()}`}</p>;
    const elements = ['one', 'two'].map((value) => (
      <Context.Provider key={value} value={value}>
        <Comp />
      </Context.Provider>
    ));
    const results = await Promise.all(elements.map(renderToMarkdownString));
    for (let index = 0; index < elements.length; index++) {
      expect(results[index]).toMatch(
        new RegExp(`^${['one', 'two'][index]}:_r_[a-z0-9]+_\\n\\n$`),
      );
    }
    expect(results[0]).not.toBe(results[1].replace('two:', 'one:'));
  });

  it('does not attach refs or execute class mount lifecycles', async () => {
    const calls: string[] = [];
    class Comp extends React.Component {
      componentDidMount() {
        calls.push('mount');
      }
      render() {
        return (
          <p
            ref={() => {
              calls.push('ref');
            }}
          >
            Content
          </p>
        );
      }
    }
    expect(renderToString(<Comp />)).toBe('<p>Content</p>');
    expect(await renderToMarkdownString(<Comp />)).toBe('Content\n\n');
    await setImmediate();
    expect(calls).toEqual([]);
  });

  it('does not run client callbacks when Suspense reveals content or removes fallback', async () => {
    const calls: string[] = [];
    const classRef = React.createRef<Content>();
    const hostRef = React.createRef<HTMLParagraphElement>();
    let value = createDeferredValue();
    let fallbackRendered = false;
    let instance: Content | undefined;
    class Content extends React.Component<{ children: React.ReactNode }> {
      #content = 'Ready';
      constructor(props: { children: React.ReactNode }) {
        super(props);
        instance = this;
      }
      componentDidMount() {
        calls.push('mount');
      }
      componentWillUnmount() {
        calls.push('content unmount');
      }
      render() {
        return (
          <p ref={hostRef}>
            <span
              ref={() => {
                calls.push('content ref');
              }}
            >
              {`${this.#content}:${this.props.children}`}
            </span>
          </p>
        );
      }
    }
    class Fallback extends React.Component {
      componentWillUnmount() {
        calls.push('fallback unmount');
      }
      render() {
        fallbackRendered = true;
        return (
          <p
            ref={() => {
              calls.push('fallback ref');
            }}
          >
            Loading
          </p>
        );
      }
    }
    const Async = () => (
      <Content ref={classRef}>{React.use(value.promise)}</Content>
    );
    const element = (
      <React.Suspense fallback={<Fallback />}>
        <Async />
      </React.Suspense>
    );
    const serverResult = renderAllToHtml(element);
    await waitForRender(() => fallbackRendered);
    value.resolve('content');
    expect(await serverResult).toContain('<p><span>Ready:content</span></p>');
    expect(calls).toEqual([]);

    value = createDeferredValue();
    fallbackRendered = false;
    const result = renderToMarkdownString(element);
    await waitForRender(() => fallbackRendered);
    value.resolve('content');
    expect(await result).toBe('Ready:content\n\n');
    expect(classRef.current).toBeNull();
    expect(hostRef.current).toBeNull();
    expect(instance?.componentDidMount).toBe(
      Content.prototype.componentDidMount,
    );
    await setImmediate();
    expect(calls).toEqual([]);
  });

  it('uses server values for transition, deferred, optimistic and initial action state hooks', async () => {
    const Comp = () => {
      const [pending] = React.useTransition();
      const deferred = React.useDeferredValue('current', 'initial');
      const [optimistic] = React.useOptimistic('optimistic');
      const [state, , actionPending] = React.useActionState(
        (value: string) => value,
        'state',
      );
      return (
        <p>{`${pending},${deferred},${optimistic},${state},${actionPending}`}</p>
      );
    };
    expect(renderToString(<Comp />)).toBe(
      '<p>false,initial,optimistic,state,false</p>',
    );
    expect(await renderToMarkdownString(<Comp />)).toBe(
      'false,initial,optimistic,state,false\n\n',
    );
  });

  it('uses the current deferred value when no initial value is supplied', async () => {
    const Comp = () => <p>{React.useDeferredValue('current')}</p>;
    expect(renderToString(<Comp />)).toBe('<p>current</p>');
    expect(await renderToMarkdownString(<Comp />)).toBe('current\n\n');
  });

  it('preserves a null deferred initial value', async () => {
    const Comp = () => (
      <p>{String(React.useDeferredValue<string | null>('current', null))}</p>
    );
    expect(renderToString(<Comp />)).toBe('<p>null</p>');
    expect(await renderToMarkdownString(<Comp />)).toBe('null\n\n');
  });

  it('waits for async Suspense content instead of returning the fallback', async () => {
    const value = new Promise<string>((resolve) =>
      setTimeout(() => resolve('Resolved content'), 10),
    );
    const Comp = () => <p>{React.use(value)}</p>;
    expect(
      await renderToMarkdownString(
        <React.Suspense fallback={<p>Loading</p>}>
          <Comp />
        </React.Suspense>,
      ),
    ).toBe('Resolved content\n\n');
  });

  it('strictly rejects errors inside Suspense instead of accepting the server fallback', async () => {
    const error = new Error('Async render failed');
    const Comp = (): React.ReactNode => {
      throw error;
    };
    const element = (
      <React.Suspense fallback={<p>Loading</p>}>
        <Comp />
      </React.Suspense>
    );
    expect(renderToString(element)).toContain('<p>Loading</p>');
    await expect(renderToMarkdownString(element)).rejects.toBe(error);
  });

  it('rejects when pending Suspense content fails asynchronously', async () => {
    const error = new Error('Async render failed');
    const value = createDeferredValue();
    let fallbackRendered = false;
    const Comp = () => <p>{React.use(value.promise)}</p>;
    const Fallback = () => {
      fallbackRendered = true;
      return <p>Loading</p>;
    };
    const result = renderToMarkdownString(
      <React.Suspense fallback={<Fallback />}>
        <Comp />
      </React.Suspense>,
    );
    const rejection = expect(result).rejects.toBe(error);
    await waitForRender(() => fallbackRendered);
    value.reject(error);
    await rejection;
  });

  it('does not create imperative handles', async () => {
    const calls: string[] = [];
    const Comp = () => {
      useImperativeHandle(useRef<{ location: Location } | null>(null), () => {
        calls.push('create handle');
        return { location: window.location };
      });
      return <p>Content</p>;
    };
    expect(renderToString(<Comp />)).toBe('<p>Content</p>');
    expect(calls).toEqual([]);
    expect(await renderToMarkdownString(<Comp />)).toBe('Content\n\n');
    await setImmediate();
    expect(calls).toEqual([]);
  });

  it('propagates render errors to the caller', async () => {
    const error = new Error('Render failed');
    const Comp = (): React.ReactNode => {
      throw error;
    };
    expect(() => renderToString(<Comp />)).toThrow(error);
    await expect(renderToMarkdownString(<Comp />)).rejects.toBe(error);
  });

  it('stops suspended retries after a caught error without interrupting another render', async () => {
    const calls: string[] = [];
    const caughtErrors: { caught: Error; expected: Error }[] = [];
    const failedValue = createDeferredValue();
    const healthyValue = createDeferredValue();
    let failedFallbackRendered = false;
    let healthyFallbackRendered = false;
    let failedRenders = 0;
    const error = new Error('Broken');
    class Boundary extends React.Component<{ children: React.ReactNode }> {
      #error = error;
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(caught: Error) {
        // Assert outside React's callback, where assertion failures propagate.
        caughtErrors.push({ caught, expected: this.#error });
      }
      render() {
        return this.state.failed ? <p>Fallback</p> : this.props.children;
      }
    }
    const Broken = (): React.ReactNode => {
      throw error;
    };
    const Async = ({ failed }: { failed: boolean }) => {
      if (failed) failedRenders++;
      const text = React.use(
        failed ? failedValue.promise : healthyValue.promise,
      );
      React.useEffect(() => {
        calls.push('effect');
      }, []);
      React.useImperativeHandle(React.useRef<object | null>(null), () => {
        calls.push('handle');
        return {};
      });
      return <p>{text}</p>;
    };
    const Fallback = ({ failed }: { failed: boolean }) => {
      if (failed) failedFallbackRendered = true;
      else healthyFallbackRendered = true;
      return <p>Loading</p>;
    };
    const failed = renderToMarkdownString(
      <>
        <Boundary>
          <Broken />
        </Boundary>
        <React.Suspense fallback={<Fallback failed />}>
          <Async failed />
        </React.Suspense>
      </>,
    );
    const healthy = renderToMarkdownString(
      <React.Suspense fallback={<Fallback failed={false} />}>
        <Async failed={false} />
      </React.Suspense>,
    );
    await expect(failed).rejects.toBe(error);
    expect(caughtErrors).toHaveLength(1);
    expect(caughtErrors[0].caught).toBe(error);
    expect(caughtErrors[0].expected).toBe(error);
    await waitForRender(() => healthyFallbackRendered);
    expect(failedFallbackRendered).toBe(true);
    healthyValue.resolve('Healthy');
    expect(await healthy).toBe('Healthy\n\n');
    const rendersBeforeResolve = failedRenders;
    failedValue.resolve('Failed sibling');
    await setImmediate();
    await setImmediate();
    expect(failedRenders).toBe(rendersBeforeResolve);
    expect(calls).toEqual([]);
  });
});
