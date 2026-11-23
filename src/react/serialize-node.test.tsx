import { createContext, useContext, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { type RenderToMarkdownOptions, renderToMarkdownString } from './render';

describe('resolved host-node serializers', () => {
  it('executes components in their normal tree before serialization', async () => {
    const Value = createContext('default');
    const calls: string[] = [];
    function Child() {
      const [suffix] = useState('!');
      const value = useContext(Value);
      calls.push(value);
      return (
        <a href="/docs">
          {value}
          {suffix}
        </a>
      );
    }
    const options: RenderToMarkdownOptions = {
      serializers: {
        section(node, context) {
          if (node.type !== 'element') return undefined;
          expect(node.children).toEqual([
            {
              type: 'element',
              name: 'a',
              props: { href: '/docs' },
              children: [
                { type: 'text', value: 'provided' },
                { type: 'text', value: '!' },
              ],
            },
          ]);
          return `(${context.defaultSerialize(node)})`;
        },
      },
    };
    expect(
      await renderToMarkdownString(
        <Value.Provider value="provided">
          <section>
            <Child />
          </section>
        </Value.Provider>,
        options,
      ),
    ).toBe('([provided!](/docs))');
    expect(calls).toEqual(['provided']);
  });

  it('delegates unchanged nodes and applies overrides to nested children', async () => {
    expect(
      await renderToMarkdownString(
        <section>
          <span>A</span>
          <span>B</span>
        </section>,
        {
          serializers: {
            section: (node, context) => context.defaultSerialize(node),
            span: (node, context) => `[${context.defaultSerialize(node)}]`,
          },
        },
      ),
    ).toBe('[A][B]');
    expect(
      await renderToMarkdownString(<p>Hello</p>, {
        serializers: { p: () => undefined },
      }),
    ).toBe('Hello\n\n');
  });

  it('preserves ownership when a parent duplicates or suppresses children', async () => {
    function Twice({ children }: { children: React.ReactNode }) {
      return (
        <>
          {children}
          {children}
        </>
      );
    }
    function Ignore({ children: _children }: { children: React.ReactNode }) {
      return null;
    }
    expect(
      await renderToMarkdownString(
        <>
          <Twice>
            <span>X</span>
          </Twice>
          <Ignore>
            <span>Y</span>
          </Ignore>
        </>,
        {
          serializers: {
            span: (node, context) => `(${context.defaultSerialize(node)})`,
          },
        },
      ),
    ).toBe('(X)(X)');
  });

  it('rejects serializer errors without throwing out of the commit callback', async () => {
    await expect(
      renderToMarkdownString(<span>test</span>, {
        serializers: {
          span() {
            throw new Error('serialization failed');
          },
        },
      }),
    ).rejects.toThrow('serialization failed');
  });

  it('keeps concurrent serializers isolated', async () => {
    const outputs = await Promise.all(
      ['first', 'second'].map((label) =>
        renderToMarkdownString(<span>value</span>, {
          serializers: { span: () => label },
        }),
      ),
    );
    expect(outputs).toEqual(['first', 'second']);
  });
});
