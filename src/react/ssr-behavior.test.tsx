import { setImmediate } from 'node:timers/promises';
import React, { useImperativeHandle, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderToMarkdownString } from './render';

describe('react-dom/server behavior comparisons', () => {
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
    await expect(renderToMarkdownString(element)).rejects.toThrow('Broken');
    expect(calls).toEqual(['caught']);
  });

  it('keeps concurrent renders isolated and supports server IDs', async () => {
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

  it('uses server values for transition, deferred, optimistic and action state hooks', async () => {
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

  it('rejects errors inside Suspense instead of producing fallback Markdown', async () => {
    const error = new Error('Async render failed');
    const Comp = (): React.ReactNode => {
      throw error;
    };
    await expect(
      renderToMarkdownString(
        <React.Suspense fallback={<p>Loading</p>}>
          <Comp />
        </React.Suspense>,
      ),
    ).rejects.toBe(error);
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
});
