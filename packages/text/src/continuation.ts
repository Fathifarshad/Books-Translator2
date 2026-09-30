import { getLanguage } from './languages';

/**
 * Paragraph continuation across line, column and page breaks (SPEC §8.4).
 * Fixes prototype bug §4.2-6: a list item's continuation line must not become its own row.
 */
export interface TextBlock {
  type: 'paragraph' | 'list_item' | 'quote' | 'heading' | 'code' | 'caption' | 'footnote';
  text: string;
  /** First-line indent relative to the body text (points). */
  indent?: number;
  page?: number;
  pageEnd?: number;
}

const LIST_MARKER = /^\s*(?:[•◦▪–—*]|\(?[0-9]{1,3}[.)]|\(?[a-z][.)]|[ivx]{1,4}\.)\s+/i;
const CONTINUABLE = new Set<TextBlock['type']>(['paragraph', 'list_item', 'quote', 'footnote']);

export function endsWithTerminalPunctuation(text: string, lang: string): boolean {
  // Trailing footnote / figure references do not count ("… an encoding.[^1]").
  const trimmed = text.replace(/(?:\s*(?:\[\^[^\]]+\]|\[\[[^\]]+\]\]))+\s*$/u, '').trimEnd();
  const last = trimmed.charAt(trimmed.length - 1);
  return last !== '' && getLanguage(lang).terminalPunctuation.includes(last);
}

export function startsWithListMarker(text: string): boolean {
  return LIST_MARKER.test(text);
}

export function shouldMerge(prev: TextBlock, next: TextBlock, lang: string): boolean {
  if (!CONTINUABLE.has(prev.type) || next.type !== 'paragraph') return false;
  if ((next.indent ?? 0) > 0.5) return false;
  if (startsWithListMarker(next.text)) return false;
  const hyphenated = /[A-Za-z]-$/.test(prev.text.trimEnd());
  return hyphenated || !endsWithTerminalPunctuation(prev.text, lang);
}

function join(prev: string, next: string): string {
  const a = prev.trimEnd();
  const b = next.trimStart();
  // De-hyphenate "compu-" + "tation" when the continuation starts lowercase.
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

export function mergeContinuations(blocks: TextBlock[], lang: string): TextBlock[] {
  const out: TextBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev && shouldMerge(prev, block, lang)) {
      out[out.length - 1] = {
        ...prev,
        text: join(prev.text, block.text),
        pageEnd: block.pageEnd ?? block.page ?? prev.pageEnd ?? prev.page,
      };
    } else {
      out.push({ ...block });
    }
  }
  return out;
}

/** Paragraph-like blocks that end without terminal punctuation (report stat, target < 1%). */
export function suspectedBreaks(blocks: TextBlock[], lang: string): TextBlock[] {
  return blocks.filter(
    (b) => (b.type === 'paragraph' || b.type === 'list_item') && !endsWithTerminalPunctuation(b.text, lang),
  );
}
