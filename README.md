# react-render-to-markdown

```tsx
import { renderToMarkdownString } from 'react-render-to-markdown';

const markdown = renderToMarkdownString(<h1>Hello, World!</h1>);
console.log(markdown); // # Hello, World!
```

## Installation

```bash
npm install react-render-to-markdown
```

## Requirements

```json
{
  "react": "^18.2.0",
  "react-reconciler": "^0.29.0"
}
```

## Used By

- [Rspress SSG-MD](https://rspress.rs/guide/basic/ssg-md) — Rspress uses this library to power its SSG-MD feature, which renders documentation pages as Markdown files instead of HTML. This enables Generative Engine Optimization (GEO) by generating `llms.txt` and `llms-full.txt` for better Agent accessibility.

## License

MIT License.
