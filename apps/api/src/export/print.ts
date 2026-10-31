import { escapeHtml, getLanguage, markupToHtml } from '@dozabaneh/text';
import type { BookDocument, DocRow, ExportMode } from './document';
import { rowText } from './document';
import { embeddedFonts } from './offline';
import { exportStrings, fill } from './strings';

/**
 * «خروجی PDF»: one printable page of the whole book that opens the browser's print dialog, where «Save as PDF»
 * writes the file. The browser is the only engine on this computer that shapes Persian correctly — a PDF writer
 * in Node would hand back disconnected letters — and it needs no extra program and no service.
 *
 * Book text is escaped here (markupToHtml), so the page only ever places trusted fragments.
 */
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Vazirmatn Offline", system-ui, sans-serif; font-size: 11.5pt; line-height: 1.9;
  color: #111; background: #fff; }
main { max-width: 190mm; margin: 0 auto; padding: 10mm; }
h1 { font-size: 22pt; margin: 0 0 4mm; }
h2 { font-size: 16pt; margin: 8mm 0 3mm; break-before: page; }
h2:first-of-type { break-before: avoid; }
h3 { font-size: 13pt; margin: 6mm 0 2mm; }
h4 { font-size: 11.5pt; margin: 4mm 0 2mm; }
p, li { margin: 0 0 2.4mm; text-align: justify; }
blockquote { margin: 0 0 2.4mm; padding-inline-start: 4mm; border-inline-start: 2px solid #ccc; color: #444; }
code { font-family: "Courier New", monospace; font-size: 0.92em; }
.meta { color: #555; font-size: 10pt; margin-bottom: 8mm; }
.term { display: block; margin-bottom: 1.6mm; }
.src { color: #444; font-size: 0.94em; }
@page { size: A4; margin: 14mm 12mm; }
@media print { main { padding: 0; max-width: none; } }
`;

const DIR = (lang: string) => getLanguage(lang).dir;

function rowHtml(r: DocRow, text: string, lang: string): string {
  if (!text.trim()) return '';
  const html = markupToHtml(text, getLanguage(lang).refLabels);
  const dir = ` dir="${DIR(lang)}" lang="${escapeHtml(lang)}"`;
  switch (r.type) {
    case 'heading':
      return `<h4${dir}>${html}</h4>`;
    case 'list_item':
      return `<ul><li${dir}>${html}</li></ul>`;
    case 'quote':
    case 'caption':
    case 'footnote':
      return `<blockquote${dir}>${html}</blockquote>`;
    case 'code':
      return `<pre${dir}><code>${html}</code></pre>`;
    default:
      return `<p${dir}>${html}</p>`;
  }
}

export function buildPrintHtml(doc: BookDocument, mode: ExportMode = 'target'): string {
  const t = exportStrings();
  const tgt = doc.lang.tgt;
  const date = new Intl.DateTimeFormat(doc.lang.tgtLocale, { dateStyle: 'medium' }).format(doc.exportedAt);
  const parts: string[] = [
    `<h1 dir="${DIR(tgt)}">${escapeHtml(doc.title)}</h1>`,
    doc.titleSrc && doc.titleSrc !== doc.title
      ? `<p class="src" dir="${DIR(doc.lang.src)}">${escapeHtml(doc.titleSrc)}</p>`
      : '',
    doc.authors.length ? `<p class="meta">${escapeHtml(doc.authors.join(' · '))}</p>` : '',
    `<p class="meta">${escapeHtml(fill(t.footer, { date }))}</p>`,
  ];

  let chapter: string | undefined;
  for (const section of doc.sections) {
    if (section.chapter && section.chapter !== chapter) {
      chapter = section.chapter;
      parts.push(`<h2 dir="${DIR(tgt)}">${escapeHtml(chapter)}</h2>`);
    }
    if (!section.chapter) chapter = undefined;
    const headingLang = mode === 'source' ? doc.lang.src : tgt;
    const heading = mode === 'source' ? section.titleSrc : section.title;
    if (heading) {
      const tag = section.chapter ? 'h3' : 'h2';
      parts.push(`<${tag} dir="${DIR(headingLang)}">${escapeHtml(heading)}</${tag}>`);
    }
    for (const r of section.rows) {
      if (mode === 'bilingual') {
        parts.push(rowHtml(r, r.tgt, tgt));
        parts.push(rowHtml({ ...r, type: 'quote' }, r.src, doc.lang.src));
      } else {
        parts.push(rowHtml(r, rowText(r, mode), mode === 'source' ? doc.lang.src : tgt));
      }
    }
  }

  if (doc.glossary.length) {
    parts.push(`<h2 dir="${DIR(tgt)}">${escapeHtml(t.glossary)}</h2>`);
    for (const g of doc.glossary) {
      const definition = g.definition ? `: ${g.definition}` : '';
      parts.push(
        `<span class="term" dir="${DIR(tgt)}"><b dir="${DIR(doc.lang.src)}">${escapeHtml(g.src)}</b> — ${escapeHtml(
          `${g.tgt}${definition}`,
        )}</span>`,
      );
    }
  }

  return `<!doctype html>
<html lang="${escapeHtml(tgt)}" dir="${DIR(tgt)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>${embeddedFonts()}${PRINT_CSS}</style>
</head>
<body>
<main>${parts.filter(Boolean).join('\n')}</main>
<script>addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
</body>
</html>
`;
}
