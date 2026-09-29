import type { Citation } from '@dozabaneh/shared';
import type { Root, Text } from 'mdast';
import type { ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { SKIP, visit } from 'unist-util-visit';

const CITATION = /\[(P\d{1,3})\]/g;

/** remark plugin: `[P3]` → `<span data-cite="P3">` so it can render as a chip. */
function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || !CITATION.test(node.value)) return;
      CITATION.lastIndex = 0;
      const parts: (Text | { type: 'citation'; data: object; children: [] })[] = [];
      let last = 0;
      for (const m of node.value.matchAll(CITATION)) {
        if ((m.index ?? 0) > last) parts.push({ type: 'text', value: node.value.slice(last, m.index) });
        parts.push({
          type: 'citation',
          data: { hName: 'span', hProperties: { dataCite: m[1] } },
          children: [],
        });
        last = (m.index ?? 0) + m[0].length;
      }
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...(parts as never[]));
      return [SKIP, index + parts.length];
    });
  };
}

// Sanitized Markdown only (SPEC §16): the default GitHub schema plus our data-cite attribute.
const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, span: [...(defaultSchema.attributes?.span ?? []), 'dataCite'] },
};

interface MarkdownProps {
  text: string;
  citations: Citation[];
  renderCitation: (citation: Citation | undefined, label: string) => ReactNode;
}

export function Markdown({ text, citations, renderCitation }: MarkdownProps) {
  const byLabel = new Map(citations.map((c) => [c.label, c]));
  return (
    <div className="answer" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCitations]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          span: ({ node: _node, ...props }: ComponentProps<'span'> & { node?: unknown }) => {
            const label = (props as Record<string, unknown>)['data-cite'];
            if (typeof label === 'string') return <>{renderCitation(byLabel.get(label), label)}</>;
            return <span {...props} />;
          },
          a: ({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent underline" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
