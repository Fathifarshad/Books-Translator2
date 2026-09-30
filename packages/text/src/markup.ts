/**
 * Tiny, safe inline markup (SPEC §7.2) used in source text, drafts and final translations.
 * Parsed into tokens and rendered by React components — never via innerHTML.
 */
export type MarkupToken =
  | { type: 'text'; text: string }
  | { type: 'em'; children: MarkupToken[] }
  | { type: 'strong'; children: MarkupToken[] }
  | { type: 'code'; text: string }
  | { type: 'fnref'; id: string }
  | { type: 'ref'; kind: 'fig' | 'tab'; id: string }
  | { type: 'url'; url: string };

const FNREF = /^\[\^([A-Za-z0-9_-]+)\]/;
const REF = /^\[\[(fig|tab):([^\]\s]+)\]\]/;
const URL_RE = /^https?:\/\/[^\s<>«»"]+/;
const URL_TRAILING = /[.,;:!?)»”’؟،؛]+$/;

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/u.test(ch);
}

/** Finds the closing delimiter for emphasis: not preceded by whitespace. */
function findClose(src: string, from: number, delim: string): number {
  let i = src.indexOf(delim, from);
  while (i !== -1) {
    const before = src[i - 1];
    const doubled = delim === '*' && (src[i + 1] === '*' || before === '*');
    if (!isSpace(before) && i > from && !doubled) return i;
    i = src.indexOf(delim, i + delim.length);
  }
  return -1;
}

export function tokenize(src: string): MarkupToken[] {
  const out: MarkupToken[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    const rest = src.slice(i);

    if (ch === '\\' && i + 1 < src.length && '*`['.includes(src[i + 1] as string)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const fn = FNREF.exec(rest);
      if (fn) {
        flush();
        out.push({ type: 'fnref', id: fn[1] as string });
        i += fn[0].length;
        continue;
      }
      const ref = REF.exec(rest);
      if (ref) {
        flush();
        out.push({ type: 'ref', kind: ref[1] as 'fig' | 'tab', id: ref[2] as string });
        i += ref[0].length;
        continue;
      }
    }
    if (ch === '*') {
      const strong = rest.startsWith('**');
      const delim = strong ? '**' : '*';
      const start = i + delim.length;
      if (!isSpace(src[start])) {
        const end = strong ? src.indexOf('**', start + 1) : findClose(src, start, '*');
        if (end > start && !isSpace(src[end - 1])) {
          flush();
          const children = tokenize(src.slice(start, end));
          out.push(strong ? { type: 'strong', children } : { type: 'em', children });
          i = end + delim.length;
          continue;
        }
      }
    }
    if (ch === 'h' && (rest.startsWith('http://') || rest.startsWith('https://'))) {
      const m = URL_RE.exec(rest);
      if (m) {
        const url = m[0].replace(URL_TRAILING, '');
        flush();
        out.push({ type: 'url', url });
        i += url.length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Plain text of a token list (markers removed) — for search, clipboard and tutor context. */
export function plainText(tokens: MarkupToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return t.text;
        case 'em':
        case 'strong':
          return plainText(t.children);
        case 'code':
          return t.text;
        case 'url':
          return t.url;
        default:
          return '';
      }
    })
    .join('');
}

/** Serializes tokens back to markup (inverse of `tokenize` for well-formed input). */
export function serializeMarkup(tokens: MarkupToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return t.text.replace(/([*`])/g, '\\$1');
        case 'em':
          return `*${serializeMarkup(t.children)}*`;
        case 'strong':
          return `**${serializeMarkup(t.children)}**`;
        case 'code':
          return `\`${t.text}\``;
        case 'fnref':
          return `[^${t.id}]`;
        case 'ref':
          return `[[${t.kind}:${t.id}]]`;
        case 'url':
          return t.url;
        default:
          return '';
      }
    })
    .join('');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);
}

/**
 * Static HTML for inline markup (exports such as the offline reader). Every text is escaped; only a fixed set
 * of tags is produced, and links are http(s) only — book text can never inject markup.
 */
export function markupToHtml(
  src: string,
  refLabels: { fig: string; tab: string } = { fig: 'Fig.', tab: 'Tab.' },
): string {
  const render = (tokens: MarkupToken[]): string =>
    tokens
      .map((t) => {
        switch (t.type) {
          case 'text':
            return escapeHtml(t.text);
          case 'em':
            return `<em>${render(t.children)}</em>`;
          case 'strong':
            return `<strong>${render(t.children)}</strong>`;
          case 'code':
            return `<code>${escapeHtml(t.text)}</code>`;
          case 'fnref':
            return `<sup class="fn">${escapeHtml(t.id)}</sup>`;
          case 'ref':
            return escapeHtml(`${refLabels[t.kind]} ${t.id}`);
          case 'url':
            return /^https?:\/\//.test(t.url)
              ? `<a href="${escapeHtml(t.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(t.url)}</a>`
              : escapeHtml(t.url);
          default:
            return '';
        }
      })
      .join('');
  return render(tokenize(src));
}

export function stripMarkup(src: string): string {
  return plainText(tokenize(src));
}

function signatures(tokens: MarkupToken[], acc: string[] = []): string[] {
  for (const t of tokens) {
    switch (t.type) {
      case 'code':
        acc.push(`code:${t.text}`);
        break;
      case 'fnref':
        acc.push(`fn:${t.id}`);
        break;
      case 'ref':
        acc.push(`${t.kind}:${t.id}`);
        break;
      case 'url':
        acc.push(`url:${t.url}`);
        break;
      case 'em':
      case 'strong':
        signatures(t.children, acc);
        break;
      case 'text':
        break;
    }
  }
  return acc;
}

/** Multiset of non-text tokens (footnote refs, code spans, figure/table refs, URLs), sorted. */
export function tokenSignature(src: string): string[] {
  return signatures(tokenize(src)).sort();
}

export interface MarkupDiff {
  missing: string[];
  extra: string[];
}

/** Compares the non-text token multisets of a source and its translation (SPEC §7.2 validation). */
export function compareMarkup(src: string, tgt: string): MarkupDiff {
  const a = tokenSignature(src);
  const b = tokenSignature(tgt);
  const counts = new Map<string, number>();
  for (const s of a) counts.set(s, (counts.get(s) ?? 0) + 1);
  const extra: string[] = [];
  for (const s of b) {
    const n = counts.get(s) ?? 0;
    if (n > 0) counts.set(s, n - 1);
    else extra.push(s);
  }
  const missing = [...counts.entries()].flatMap(([s, n]) => Array.from({ length: n }, () => s));
  return { missing, extra };
}
