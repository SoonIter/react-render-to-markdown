import { PassThrough } from 'node:stream';
import { Parser } from 'htmlparser2';
import type React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { MarkdownNode, TextNode } from './nodes.js';

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
    case 'script':
    case 'template':
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

// Let React Fizz own component execution, SSR hooks, and async boundaries.
export async function renderToMarkdownString(
  element: React.ReactElement,
): Promise<string> {
  const html = await new Promise<string>((resolve, reject) => {
    const destination = new PassThrough();
    const chunks: Buffer[] = [];
    let renderError: unknown;
    let didError = false;
    destination.on('data', (chunk: Buffer) => chunks.push(chunk));
    destination.on('error', reject);
    destination.on('end', () => {
      if (didError) reject(renderError);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(destination);
      },
      onShellError: reject,
      onError(error) {
        didError = true;
        renderError = error;
      },
    });
  });

  const container = new MarkdownNode('root');
  const stack = [container];
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const node = new MarkdownNode(name, attributes);
        stack[stack.length - 1].appendChild(node);
        stack.push(node);
      },
      ontext(text) {
        stack[stack.length - 1].appendChild(new TextNode(text));
      },
      onclosetag() {
        stack.pop();
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  return toMarkdown(container);
}
