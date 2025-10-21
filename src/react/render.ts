import { MarkdownNode, TextNode, reconciler } from './reconciler.js';

// Convert node tree to Markdown string
function toMarkdown(root: MarkdownNode): string {
  const { type, props, children } = root;

  // Get children's Markdown
  const childrenMd = children
    .map((child) => {
      if (child instanceof TextNode) {
        return child.text;
      }
      return toMarkdown(child);
    })
    .join('');

  // Generate corresponding Markdown based on element type
  switch (type) {
    case 'root':
      return childrenMd;
    case 'h1':
      return `# ${childrenMd}\n\n`;
    case 'h2':
      return `## ${childrenMd}\n\n`;
    case 'h3':
      return `### ${childrenMd}\n\n`;
    case 'h4':
      return `#### ${childrenMd}\n\n`;
    case 'h5':
      return `##### ${childrenMd}\n\n`;
    case 'h6':
      return `###### ${childrenMd}\n\n`;
    case 'p':
      return `${childrenMd}\n\n`;
    case 'strong':
    case 'b':
      return `**${childrenMd}**`;
    case 'em':
    case 'i':
      return `*${childrenMd}*`;
    case 'code':
      return `\`${childrenMd}\``;
    case 'pre': {
      const language = props.lang || props.language || '';
      return `\`\`\`${language}\n${childrenMd}\n\`\`\`\n\n`;
    }
    case 'a':
      return `[${childrenMd}](${props.href || '#'})`;
    case 'img':
      return `![${props.alt || ''}](${props.src || ''})`;
    case 'ul':
      return `${childrenMd}\n`;
    case 'ol':
      return `${childrenMd}\n`;
    case 'li': {
      const isOrdered = root.parent && root.parent.type === 'ol';
      const prefix = isOrdered ? '1. ' : '- ';
      return `${prefix}${childrenMd}\n`;
    }
    case 'blockquote':
      return `> ${childrenMd.split('\n').join('\n> ')}\n\n`;
    case 'br':
      return '\n';
    case 'hr':
      return '---\n\n';
    case 'table':
      return `${childrenMd}\n`;
    case 'thead':
      return childrenMd;
    case 'tbody':
      return childrenMd;
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
      return childrenMd;
    default:
      return childrenMd;
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
        console.log('Reconciler onRecoverableError:', error);
      }
    }, // onRecoverableError
    null, // transitionCallbacks
  );

  // Set up a promise that resolves when commit completes
  let resolveCommit: ((arg: string) => void) | null = null;
  let resolved = false;
  const commitPromise = new Promise<string>((resolve) => {
    resolveCommit = resolve;
  });

  try {
    reconciler.updateContainer(element, root, null, () => {
      // This callback is called after commit
      try {
        const markdownString = toMarkdown(container);
        if (resolveCommit && !resolved) {
          resolved = true;
          resolveCommit(markdownString || '');
        }
      } catch (error) {
        throw new Error(
          `Error in commit callback: ${(error as Error).message}`,
        );
      }
    });
    reconciler.flushSync();
    return commitPromise;
  } catch (error) {
    if (process.env.DEBUG) {
      console.log('Error in updateContainer:', error);
    }
    if (resolved) {
      return commitPromise;
    }
    return '';
  }
}
