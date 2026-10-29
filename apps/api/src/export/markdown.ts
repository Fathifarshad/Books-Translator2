import { stripMarkup } from '@dozabaneh/text';
import { type BookDocument, type DocRow, type ExportMode, rowText } from './document';
import { exportStrings } from './strings';

/**
 * «خروجی مارک‌داون»: the finished book as one Markdown file. The book's own inline markup is already Markdown
 * (`*…*`, `**…**`, `` `…` ``, `[^1]`), so it travels unchanged; only figure and table references become plain
 * labels, since nothing outside this app knows them. Direction is never written into the file: a reader takes it
 * from the text itself (golden rule 1).
 */
const FIGURE_REF = /\[\[(fig|tab):([^\]\s]+)\]\]/gu;

export function inlineMarkdown(text: string): string {
  return text.replace(FIGURE_REF, (_m, kind: string, id: string) => `(${kind} ${id})`);
}

function block(r: DocRow, text: string): string[] {
  if (!text) return [];
  switch (r.type) {
    case 'heading':
      return [`#### ${text}`];
    case 'list_item':
      return [`- ${text}`];
    case 'quote':
    case 'caption':
    case 'footnote':
      return [`> ${text}`];
    case 'code':
      return ['```', text, '```'];
    default:
      return [text];
  }
}

export function toMarkdown(doc: BookDocument, mode: ExportMode = 'target'): string {
  const t = exportStrings();
  const date = new Intl.DateTimeFormat(doc.lang.tgtLocale, { dateStyle: 'medium' }).format(doc.exportedAt);
  const lines: string[] = [`# ${stripMarkup(doc.title)}`, ''];
  if (doc.titleSrc && doc.titleSrc !== doc.title) lines.push(`*${stripMarkup(doc.titleSrc)}*`, '');
  if (doc.authors.length) lines.push(doc.authors.join(' · '), '');
  lines.push(`<!-- ${doc.lang.src} → ${doc.lang.tgt} · ${date} -->`, '');

  let chapter: string | undefined;
  for (const section of doc.sections) {
    if (section.chapter && section.chapter !== chapter) {
      chapter = section.chapter;
      lines.push(`## ${stripMarkup(chapter)}`, '');
    }
    if (!section.chapter) chapter = undefined;
    const heading = mode === 'source' ? section.titleSrc : section.title;
    if (heading) lines.push(`${section.chapter ? '###' : '##'} ${stripMarkup(heading)}`, '');
    for (const r of section.rows) {
      if (mode === 'bilingual') {
        const tgt = inlineMarkdown(r.tgt.trim());
        const src = inlineMarkdown(r.src.trim());
        if (tgt) lines.push(...block(r, tgt), '');
        if (src) lines.push(`> ${src}`, '');
      } else {
        const text = inlineMarkdown(rowText(r, mode).trim());
        const out = block(r, text);
        if (out.length) lines.push(...out, '');
      }
    }
  }

  if (doc.glossary.length) {
    lines.push('---', '', `## ${t.glossary}`, '');
    for (const g of doc.glossary) {
      lines.push(`- **${g.src}** — ${g.tgt}${g.definition ? `: ${g.definition}` : ''}`);
    }
    lines.push('');
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`;
}
