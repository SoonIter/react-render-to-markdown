import { describe, expect, it } from 'vitest';
import { renderToMarkdownString } from './render';

describe('renderToMarkdownString - child boundary spacing', () => {
  it('separates adjacent transparent block wrappers', async () => {
    expect(
      await renderToMarkdownString(
        <>
          <div>Row 1</div>
          <div>Row 2</div>
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "Row 1

      Row 2"
    `);
  });

  it('separates nested transparent block wrappers', async () => {
    expect(
      await renderToMarkdownString(
        <main>
          <section>
            <div>Intro</div>
          </section>
          <article>
            <div>Details</div>
          </article>
        </main>,
      ),
    ).toMatchInlineSnapshot(`
      "Intro

      Details"
    `);
  });

  it('separates text from adjacent block wrappers in flow containers', async () => {
    expect(
      await renderToMarkdownString(
        <>
          Lead
          <section>Section</section>
          <aside>Aside</aside>
          Tail
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "Lead

      Section

      Aside

      Tail"
    `);
  });

  it('separates blocks even when the previous text ends with a space', async () => {
    expect(
      await renderToMarkdownString(
        <>
          {'Lead '}
          <section>Section</section>
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "Lead 

      Section"
    `);
  });

  it('completes block separation when the boundary already has one newline', async () => {
    expect(
      await renderToMarkdownString(
        <>
          {'Lead\n'}
          <section>Section</section>
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "Lead

      Section"
    `);
  });

  it('does not over-separate blocks that already start with one newline', async () => {
    expect(
      await renderToMarkdownString(
        <>
          {'Lead'}
          <pre data-lang="ts">
            <code>{'const value = 1;\n'}</code>
          </pre>
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "Lead

      \`\`\`ts
      const value = 1;

      \`\`\`
      "
    `);
  });

  it('does not add duplicate spacing around markdown blocks that already delimit themselves', async () => {
    expect(
      await renderToMarkdownString(
        <div>
          <h2>Title</h2>
          <p>Paragraph</p>
          <div>Footer</div>
        </div>,
      ),
    ).toMatchInlineSnapshot(`
      "## Title

      Paragraph

      Footer"
    `);
  });

  it('keeps inline siblings and punctuation joined exactly', async () => {
    expect(
      await renderToMarkdownString(
        <p>
          <strong>foo</strong>
          <span>bar</span>,<a href="/docs">docs</a>.
        </p>,
      ),
    ).toMatchInlineSnapshot(`
      "**foo**bar,[docs](/docs).

      "
    `);
  });

  it('does not insert spaces into comma-separated inline React children', async () => {
    expect(
      await renderToMarkdownString(<p>ref-value,memo-value,provided</p>),
    ).toMatchInlineSnapshot(`
      "ref-value,memo-value,provided

      "
    `);
  });

  it('keeps raw markdown text nodes untouched', async () => {
    expect(
      await renderToMarkdownString(
        <>
          {'# Code Example\\n'}
          {'\n'}
          {'```tsx\nconsole.log("Hello, world!");\n```\n'}
        </>,
      ),
    ).toMatchInlineSnapshot(`
      "# Code Example\\n
      \`\`\`tsx
      console.log("Hello, world!");
      \`\`\`
      "
    `);
  });

  it('keeps fenced code block content untouched', async () => {
    expect(
      await renderToMarkdownString(
        <pre data-lang="ts">
          <code>{'const values = ["a", "b"];\n'}</code>
        </pre>,
      ),
    ).toMatchInlineSnapshot(`
      "
      \`\`\`ts
      const values = ["a", "b"];

      \`\`\`
      "
    `);
  });
});
