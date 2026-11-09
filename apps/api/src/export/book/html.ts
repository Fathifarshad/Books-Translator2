import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { COVER_STYLE } from '@dozabaneh/cover';
import { captionStart } from '@dozabaneh/pdf';
import { BOOK_PAGE_MM, type BookPdfOptions } from '@dozabaneh/shared';
import { escapeHtml, getLanguage, localizeDigits, markupToHtml } from '@dozabaneh/text';
import type { BookDocument } from '../document';
import { embeddedFonts } from '../offline';
import { type BookStrings, fill } from '../strings';
import { backCover, COVER_CSS, type CoverContent, generatedCover, imageCover, THEMES } from './cover';
import { type BookFigure, needsTranslation } from './figures';
import type { Block, BookLayout, PlacedFigure } from './layout';

const require = createRequire(import.meta.url);

/**
 * The book as one HTML page laid out for print (ADR-046). The browser on this computer turns it into the PDF: it
 * is the only engine here that shapes Persian correctly, and Chromium's paged media gives named pages (no number on
 * the cover, the chapter title in each running head), page numbers in the book's own digits, and a PDF outline.
 *
 * The page is printed twice: the outline of the first print says on which page every heading and figure landed, and
 * those pages become the numbers of the table of contents in the second print.
 */
export interface BookHtmlInput {
  doc: BookDocument;
  book: { publisher?: string | undefined; year?: number | undefined };
  layout: BookLayout;
  options: BookPdfOptions;
  strings: BookStrings;
  /** URL of each figure image as the page loads it (relative to the HTML file). */
  figureSrc: (f: BookFigure) => string;
  coverImage?: string | undefined;
  /** The cover designed in «استودیوی جلد» (ADR-048): front and back markup and the CSS of its fonts. */
  designedCover?: { front: string; back: string; css: string } | undefined;
  editOnly: boolean;
  /** Page of each heading and figure anchor (second print); absent on the first. */
  pages?: Map<string, number> | undefined;
}

/**
 * Ids of the page's headings in document order — the order of the PDF outline the browser builds from them. Every
 * heading carries an id, figures included (a hidden anchor), so the first print's outline gives each its page.
 */
export function headingIds(html: string): string[] {
  return [...html.matchAll(/<h[1-6]\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1] as string);
}

let naskhCss: string | undefined;
function naskhFonts(): string {
  if (naskhCss !== undefined) return naskhCss;
  try {
    const dir = join(dirname(require.resolve('@fontsource/noto-naskh-arabic/package.json')), 'files');
    const face = (subset: string, weight: number, range: string) =>
      `@font-face{font-family:"Book Naskh";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(
        join(dir, `noto-naskh-arabic-${subset}-${weight}-normal.woff2`),
      ).toString('base64')}) format("woff2");unicode-range:${range}}`;
    const arabic = 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF';
    naskhCss = [400, 700].map((w) => face('arabic', w, arabic)).join('');
  } catch {
    naskhCss = '';
  }
  return naskhCss;
}

let figureCss: string | undefined;
/**
 * The type of the words set inside figures: Noto Sans Arabic (OFL), a sans with open, even letterforms, at a
 * semi-condensed width so a Persian label — usually longer than the English it replaces — keeps a readable size in
 * the original's box. Latin abbreviations («aPTT», «Xa») and signs («≥») come from the same family.
 */
function figureFonts(): string {
  if (figureCss !== undefined) return figureCss;
  try {
    const dir = join(dirname(require.resolve('@fontsource-variable/noto-sans-arabic/package.json')), 'files');
    const face = (subset: string, range: string) =>
      `@font-face{font-family:"Figure Sans";font-style:normal;font-weight:100 900;font-stretch:62.5% 100%;src:url(data:font/woff2;base64,${readFileSync(
        join(dir, `noto-sans-arabic-${subset}-standard-normal.woff2`),
      ).toString('base64')}) format("woff2");unicode-range:${range}}`;
    figureCss =
      face('arabic', 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+FB50-FDFF,U+FE70-FEFC') +
      face('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122') +
      face('math', 'U+2190-21FF,U+2200-22FF');
  } catch {
    figureCss = '';
  }
  return figureCss;
}

/** CSS `counter()` style for page numbers in the digits of the language. */
function counterStyle(lang: string): string {
  const digits = getLanguage(lang).digits;
  return digits === 'arabext' ? 'persian' : digits === 'arab' ? 'arabic-indic' : 'decimal';
}

const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12))}…`;
}

const SIZES = {
  a4: { margin: '21mm 18mm 19mm', font: '11pt' },
  vaziri: { margin: '18mm 15mm 17mm', font: '10.5pt' },
  roqee: { margin: '16mm 13mm 15mm', font: '10pt' },
} as const;

function pageCss(input: BookHtmlInput): string {
  const { options, layout, doc } = input;
  const mm = BOOK_PAGE_MM[options.pageSize];
  const size = SIZES[options.pageSize];
  const counter = counterStyle(doc.lang.tgt);
  const foot = `@bottom-center { content: counter(page, ${counter}); font-family: "Vazirmatn Offline"; font-size: 9pt; color: #555; }`;
  const head = (title: string) =>
    `@top-center { content: ${cssString(shorten(title, 70))}; font-family: "Vazirmatn Offline"; font-size: 8pt; color: #666;
      vertical-align: bottom; padding-bottom: 2.5mm; border-bottom: 0.4pt solid #bbb; }`;
  const chapters = layout.chapters
    .map(
      (ch, i) =>
        `@page ch${i} { ${head(ch.title)} } @page ch${i}:first { @top-center { content: none; border: none; } }`,
    )
    .join('\n');
  return `
@page { size: ${mm.width}mm ${mm.height}mm; margin: ${size.margin}; ${foot} }
@page cover { margin: 0; @bottom-center { content: none; } }
@page front { @bottom-center { content: none; } }
@page lists { ${foot} }
@page gloss { ${head(input.strings.glossary)} }
${chapters}
:root { --page-w: ${mm.width}mm; --page-h: ${mm.height}mm; --body-size: ${size.font}; }`;
}

function bookCss(input: BookHtmlInput): string {
  const theme = THEMES[input.options.theme];
  const body = input.options.font === 'naskh' ? '"Book Naskh", "Vazirmatn Offline"' : '"Vazirmatn Offline"';
  return `
:root { color-scheme: light; --accent: ${theme.accent}; --tint: ${theme.tint}; --orn: ${theme.ornament};
  --f-body: ${body}, serif; --f-head: "Vazirmatn Offline", sans-serif; --f-latin: "Vazirmatn Offline", "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: var(--f-body); font-size: var(--body-size); line-height: ${input.options.font === 'naskh' ? 1.95 : 1.85};
  color: #161616; text-rendering: optimizeLegibility; font-kerning: normal; }
.anchor { height: 1px; margin: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: transparent; }
h1, h2, h3, h4 { position: relative; font-family: var(--f-head); break-after: avoid; break-inside: avoid; text-wrap: balance; }
.front { page: front; break-before: page; }
.lists { page: lists; break-before: page; }
.titlepage { height: calc(var(--page-h) - 42mm); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.titlepage .orn { width: 30mm; color: var(--orn); }
.titlepage .t { margin: 8mm 0 3mm; font-family: var(--f-head); font-size: 25pt; font-weight: 800; line-height: 1.5; color: var(--accent); }
.titlepage .o { font-family: var(--f-latin); font-size: 12pt; color: #555; }
.titlepage .a { margin-top: 3mm; font-size: 11pt; color: #333; }
.titlepage .rule { width: 35%; margin: 10mm auto; border-top: 0.6pt solid var(--orn); }
.titlepage .preparer .role { font-size: 10pt; color: #777; }
.titlepage .preparer .name { margin-top: 1mm; font-family: var(--f-head); font-size: 15pt; font-weight: 700; }
.titlepage .preparer .about { font-size: 10.5pt; color: #444; }
.titlepage .date { margin-top: 18mm; font-size: 10pt; color: #777; }
.imprint { display: flex; flex-direction: column; justify-content: flex-end; height: calc(var(--page-h) - 42mm); }
.imprint h2 { font-size: 12pt; color: var(--accent); margin: 0 0 3mm; }
.imprint table { width: 100%; border-collapse: collapse; font-size: 9.5pt; line-height: 1.7; }
.imprint th { width: 26%; text-align: start; font-family: var(--f-head); font-weight: 600; color: #444; vertical-align: top; padding: 1.2mm 0; }
.imprint td { padding: 1.2mm 0; border-bottom: 0.4pt solid #e2e2e2; }
.imprint th { border-bottom: 0.4pt solid #e2e2e2; }
.imprint .made { margin-top: 5mm; font-size: 8.5pt; color: #888; }
.fm-title { font-size: 19pt; color: var(--accent); margin: 0 0 7mm; padding-bottom: 3mm; border-bottom: 1.2pt solid var(--accent); }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li a { display: flex; align-items: baseline; gap: 2mm; color: inherit; text-decoration: none; }
.toc li .t { flex: 0 1 auto; }
.toc li .d { flex: 1 1 auto; min-width: 8mm; border-bottom: 0.9pt dotted #999; transform: translateY(-0.9mm); }
.toc li .n { flex: 0 0 auto; min-width: 9mm; text-align: end; font-family: var(--f-head); font-variant-numeric: tabular-nums; }
.toc .l1 { margin-top: 3.2mm; font-family: var(--f-head); font-weight: 700; font-size: 11pt; color: var(--accent); break-after: avoid; }
.toc .l2 { margin-top: 1mm; padding-inline-start: 6mm; font-size: 10pt; }
.toc .l3 { padding-inline-start: 12mm; font-size: 9pt; color: #444; }
.toc .fig .t { max-width: 82%; }
.chapter { break-before: page; }
.opener { margin: 6mm 0 9mm; padding: 9mm 7mm 7mm; background: var(--tint); border-top: 2.4pt solid var(--accent); text-align: center; }
.opener .orn { width: 15mm; color: var(--orn); margin: 0 auto 3mm; display: block; }
.opener h1 { margin: 0; font-size: 21pt; line-height: 1.55; font-weight: 800; color: var(--accent); }
.opener .src { margin-top: 2mm; font-family: var(--f-latin); font-size: 10pt; color: #666; }
h2 { margin: 7mm 0 2.5mm; padding-bottom: 1.2mm; font-size: 14.5pt; font-weight: 700; color: var(--accent); border-bottom: 0.6pt solid color-mix(in srgb, var(--accent) 35%, white); }
h3 { margin: 5mm 0 1.8mm; font-size: 12pt; font-weight: 700; color: #222; }
h4 { margin: 4mm 0 1.2mm; font-size: 10.5pt; font-weight: 700; color: var(--accent); }
.hsrc { margin: -1mm 0 2mm; font-family: var(--f-latin); font-size: 8.5pt; color: #777; }
p { margin: 0 0 1.6mm; text-align: justify; text-justify: inter-word; orphans: 2; widows: 2; }
p.body { text-indent: 1.3em; }
h1 + p.body, h2 + p.body, h3 + p.body, h4 + p.body, .hsrc + p.body, figure + p.body, ul + p.body { text-indent: 0; }
p.note { font-size: 0.86em; color: #444; line-height: 1.7; padding-inline-start: 3mm; border-inline-start: 1.2pt solid #ddd; }
p.caption { font-size: 0.9em; color: #333; }
p.code, pre { font-family: Consolas, "Courier New", monospace; font-size: 0.85em; direction: ltr; text-align: left; white-space: pre-wrap; }
p.src, .src-li { direction: ltr; text-align: left; text-indent: 0; font-family: var(--f-latin); font-size: 0.8em; line-height: 1.6; color: #666; margin: -0.6mm 0 2.2mm; }
ul.list { margin: 1mm 0 2.4mm; padding: 0; list-style: none; }
ul.list li { position: relative; margin: 0 0 1.2mm; padding-inline-start: 5.5mm; text-align: justify; }
ul.list li.bullet::before { content: ""; position: absolute; inset-inline-start: 1.2mm; top: 0.8em; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--accent); }
ul.list li.own { padding-inline-start: 0; }
sup.fn { font-size: 0.7em; line-height: 0; }
code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; }
figure.fig { margin: 4mm auto 5mm; break-inside: avoid; text-align: center; }
.art { position: relative; container-type: inline-size; margin: 0 auto; }
.art img { display: block; width: 100%; height: 100%; }
.lbl { position: absolute; display: flex; align-items: center; justify-content: center; overflow: hidden;
  font-family: "Figure Sans", "Vazirmatn Offline", sans-serif; font-weight: 450; font-stretch: 87.5%; line-height: 1.32;
  color: #1a1a1a; text-align: center; text-indent: 0; letter-spacing: 0; word-spacing: 0.04em; }
.lbl.start { justify-content: flex-start; align-items: flex-start; text-align: start; }
.lbl > span { display: block; max-width: 100%; }
.lbl .li { display: block; padding-inline-start: 0.9em; text-indent: -0.9em; }
.lbl.rot > span { position: absolute; left: 50%; top: 50%; transform-origin: center; }
figcaption { margin: 2.2mm auto 0; max-width: 96%; font-size: 0.86em; line-height: 1.75; color: #333; text-align: justify; text-indent: 0; }
figcaption b { font-family: var(--f-head); color: var(--accent); }
figcaption .src { display: block; }
.glossary { page: gloss; break-before: page; }
.glossary h1 { font-size: 19pt; color: var(--accent); margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 1.2pt solid var(--accent); }
.glossary dl { margin: 0; columns: 2; column-gap: 8mm; font-size: 9.3pt; line-height: 1.65; }
.glossary .term { break-inside: avoid; margin: 0 0 1.8mm; }
.glossary dt { font-family: var(--f-latin); direction: ltr; text-align: left; color: var(--accent); font-weight: 600; }
.glossary dd { margin: 0; }
${COVER_CSS}`;
}

/** An eight-pointed star ornament (chapter openers and the title page). */
const ORNAMENT = `<svg class="orn" viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="3"><rect x="22" y="22" width="56" height="56"/><rect x="22" y="22" width="56" height="56" transform="rotate(45 50 50)"/><circle cx="50" cy="50" r="12"/></g></svg>`;

function inline(text: string, lang: string): string {
  // Note numbers follow the digits of the language they stand in.
  return markupToHtml(text, getLanguage(lang).refLabels).replace(
    /<sup class="fn">([^<]*)<\/sup>/g,
    (_m, n: string) => `<sup class="fn">${localizeDigits(n, lang)}</sup>`,
  );
}

/** Label boxes of a figure in container units: original boxes, mirrored for a table, widened into free space. */
export function labelBoxes(figure: BookFigure): {
  left: number;
  top: number;
  width: number;
  height: number;
  size: number;
  /** The original size in points: labels set alike in the original are set alike here. */
  pt: number;
  start: boolean;
  angle: number;
  text: string;
  /** Set in the target language (its direction), not kept as printed. */
  translated: boolean;
}[] {
  const W = figure.width;
  const H = figure.height;
  const boxes = figure.labels.map((l) => ({ ...l, x: figure.mirrored ? W - l.x - l.width : l.x }));
  const start = figure.kind === 'table';
  // Words the picture shows as printed get nothing set over them, but still bound their neighbours.
  return boxes.flatMap((b, i) => {
    if (b.printed) return [];
    let leftLimit = 0;
    let rightLimit = W;
    let topLimit = 0;
    let bottomLimit = H;
    for (const [j, o] of boxes.entries()) {
      if (i === j) continue;
      if (o.y < b.y + b.height && b.y < o.y + o.height) {
        if (o.x + o.width <= b.x) leftLimit = Math.max(leftLimit, (o.x + o.width + b.x) / 2);
        else if (o.x >= b.x + b.width) rightLimit = Math.min(rightLimit, (b.x + b.width + o.x) / 2);
      } else if (o.x < b.x + b.width && b.x < o.x + o.width) {
        if (o.y + o.height <= b.y) topLimit = Math.max(topLimit, (o.y + o.height + b.y) / 2);
        else if (o.y >= b.y + b.height) bottomLimit = Math.min(bottomLimit, (b.y + b.height + o.y) / 2);
      }
    }
    let left: number;
    let right: number;
    let top: number;
    let bottom: number;
    if (b.room && !figure.mirrored) {
      // The space the drawing leaves around the label (its box), never less than the original words took.
      const inset = 1;
      left = Math.min(b.x, Math.max(leftLimit, b.room.x + inset));
      right = Math.max(b.x + b.width, Math.min(rightLimit, b.room.x + b.room.width - inset));
      top = Math.min(b.y, Math.max(topLimit, b.room.y + inset));
      bottom = Math.max(b.y + b.height, Math.min(bottomLimit, b.room.y + b.room.height - inset));
    } else {
      const grow = Math.max(b.width * 0.35, b.size * 2);
      // A right-to-left table cell keeps its right edge and grows to the left — as far as its column reaches: the
      // widest cell that starts where it starts («TACO» heads a column of long cells); other labels grow both ways.
      const column = start
        ? Math.min(...boxes.filter((o) => Math.abs(o.x + o.width - (b.x + b.width)) < 2).map((o) => o.x))
        : b.x;
      left = Math.min(Math.max(leftLimit, b.x - grow), column);
      right = start ? Math.min(rightLimit, b.x + b.width + 1) : Math.min(rightLimit, b.x + b.width + grow);
      top = Math.max(topLimit, b.y - b.size * 0.25);
      bottom = Math.min(bottomLimit, b.y + b.height + b.size * 0.25);
    }
    const k = 100 / W;
    return [
      {
        left: left * k,
        top: top * k,
        width: (right - left) * k,
        height: (bottom - top) * k,
        size: b.size * k,
        pt: Math.round(b.size * 2) / 2,
        start,
        angle: Math.abs(b.angle) >= 45 ? b.angle : 0,
        text: b.tgt ?? b.text,
        translated: b.tgt !== undefined && needsTranslation(b.text),
      },
    ];
  });
}

const n2 = (v: number) => Number(v.toFixed(3));

/** A bullet between words; also the codes a symbol font leaves when no character was mapped to its bullet. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: those codes are what is looked for
const BULLET = /\s*(?:[•●▪◦]+|[\u0001-\u0008\u000b\u000c\u000e-\u001f\uf000-\uf8ff]+)\s+/u;

/**
 * Escaped label text with Latin tokens that end in a sign («O+», «Rh−», «CD4+») kept left to right: in a
 * right-to-left line the sign would otherwise drift to the token's other side («(+O)»).
 */
export function labelHtml(text: string): string {
  const signed = (t: string) =>
    escapeHtml(t).replace(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]{0,5}[+\-−](?![A-Za-z0-9])/g, '<bdi dir="ltr">$&</bdi>');
  // A list inside a cell or a box («… within 6 hours: • Acute respiratory distress • …»): one item per line.
  const [lead = '', ...items] = text.split(BULLET);
  if (!items.length) return signed(text);
  const list = items
    .filter((i) => i.trim())
    .map((i) => `<span class="li">• ${signed(i.trim())}</span>`)
    .join('');
  return `${signed(lead.trim())}${list}`;
}

/**
 * A translated caption without its own «شکل ۵۸.۵ —», which the book sets itself (in its accent colour), and without a
 * panel letter ingestion glued in front of it («B شکل ۵۸.۵ — (الف) …»).
 */
export function captionBody(caption: string, lang: string): string {
  const text = caption.replace(/\s+/g, ' ').trim();
  const lead = /^(?:\p{L}\s+){1,3}/u.exec(text)?.[0] ?? '';
  for (const from of lead ? [lead.length, 0] : [0]) {
    const rest = text.slice(from);
    const start = captionStart(rest, lang);
    if (start)
      return rest
        .slice(start.end)
        .replace(/^\s*[—–:.-]?\s*/u, '')
        .trim();
  }
  return text;
}

function figureHtml(p: PlacedFigure, input: BookHtmlInput): string {
  const { figure } = p;
  const tgt = input.doc.lang.tgt;
  const dir = getLanguage(tgt).dir;
  const widthPt = figure.width;
  const labels = figure.textRemoved
    ? labelBoxes(figure)
        .map((b) => {
          const style = `left:${n2(b.left)}cqw;top:${n2(b.top)}cqw;width:${n2(b.width)}cqw;height:${n2(b.height)}cqw;font-size:${n2(b.size)}cqw`;
          // A translated label reads in the target language's direction even when it opens with a Latin
          // abbreviation («aPTT در محدوده‌ی طبیعی»); numbers and abbreviations kept as printed find their own.
          const textDir = b.translated ? dir : 'auto';
          if (b.angle) {
            // The text runs along the longer side of its box, turned the way the original was.
            const inner = `width:${n2(b.height)}cqw;margin-left:-${n2(b.height / 2)}cqw;margin-top:-0.7em;transform:rotate(${-b.angle}deg)`;
            return `<div class="lbl rot" data-pt="${b.pt}" style="${style}"><span dir="${textDir}" style="${inner}">${labelHtml(b.text)}</span></div>`;
          }
          return `<div class="lbl${b.start ? ' start' : ''}" data-pt="${b.pt}" style="${style}"><span dir="${textDir}">${labelHtml(b.text)}</span></div>`;
        })
        .join('')
    : '';
  const label =
    figure.number && figure.kind !== 'image'
      ? fill(figure.kind === 'table' ? input.strings.table : input.strings.figure, {
          number: localizeDigits(figure.number, tgt),
        })
      : '';
  const caption = label ? captionBody(p.caption, tgt) : p.caption.trim();
  const captionHtml = p.caption.trim()
    ? `<figcaption dir="${dir}">${label ? `<b>${escapeHtml(label)}</b>${caption ? ' — ' : ''}` : ''}${inline(caption, tgt)}${
        p.captionSrc
          ? `<span class="src" dir="${input.doc.lang.srcDir}">${inline(p.captionSrc, input.doc.lang.src)}</span>`
          : ''
      }</figcaption>`
    : '';
  // The anchor puts the figure in the PDF outline (a bookmark) and tells the first print its page.
  const anchor = `<h6 class="anchor" id="a-${p.id}">${escapeHtml(label || input.strings.image)}</h6>`;
  const art = `<div class="art" style="width:min(100%,${n2(widthPt)}pt);aspect-ratio:${n2(figure.width)}/${n2(figure.height)}"><img src="${escapeHtml(input.figureSrc(figure))}" alt="">${labels}</div>`;
  // A table's title stands above it, a figure's caption below.
  const body = figure.kind === 'table' ? `${captionHtml}${art}` : `${art}${captionHtml}`;
  return `<figure class="fig kind-${figure.kind}" id="${p.id}">${anchor}${body}</figure>`;
}

function blockHtml(b: Block, input: BookHtmlInput): string {
  const { lang } = input.doc;
  const dir = getLanguage(lang.tgt).dir;
  const src = (s: string, cls: string) =>
    s
      ? `<${cls === 'hsrc' ? 'div' : 'p'} class="${cls}" dir="${lang.srcDir}">${inline(s, lang.src)}</${cls === 'hsrc' ? 'div' : 'p'}>`
      : '';
  switch (b.kind) {
    case 'h':
      return `<h${b.level} id="${b.id}" dir="${dir}">${inline(b.text, lang.tgt)}</h${b.level}>${src(b.src, 'hsrc')}`;
    case 'p':
      return `<p class="${b.cls}" dir="${dir}">${inline(b.text, lang.tgt)}</p>${src(b.src, 'src')}`;
    case 'list':
      return `<ul class="list" dir="${dir}">${b.items
        .map(
          (it) =>
            `<li class="${it.marker}">${inline(it.text, lang.tgt)}${it.src ? `<div class="src-li" dir="${lang.srcDir}">${inline(it.src, lang.src)}</div>` : ''}</li>`,
        )
        .join('')}</ul>`;
    case 'figure':
      return figureHtml(b.figure, input);
  }
}

function pageNo(input: BookHtmlInput, id: string): string {
  const n = input.pages?.get(id);
  return localizeDigits(n === undefined ? '000' : String(n), input.doc.lang.tgt);
}

function tocItem(input: BookHtmlInput, id: string, cls: string, text: string): string {
  return `<li class="${cls}"><a href="#${id}"><span class="t">${inline(text, input.doc.lang.tgt)}</span><span class="d"></span><span class="n">${pageNo(input, id)}</span></a></li>`;
}

export function buildBookHtml(input: BookHtmlInput): string {
  const { doc, layout, options, strings } = input;
  const tgt = doc.lang.tgt;
  const dir = getLanguage(tgt).dir;
  const theme = THEMES[options.theme];
  const date = new Intl.DateTimeFormat(doc.lang.tgtLocale, { dateStyle: 'long' }).format(doc.exportedAt);
  const preparer = { ...options.preparer, role: options.preparer.role || strings.defaultRole };
  const cover: CoverContent = {
    title: doc.title,
    titleSrc: doc.titleSrc,
    srcDir: doc.lang.srcDir,
    srcLang: doc.lang.src,
    authors: doc.authors.length ? fill(strings.by, { authors: doc.authors.join('، ') }) : '',
    preparer,
  };
  const parts: string[] = [];

  const designed = options.cover === 'designed' ? input.designedCover : undefined;
  if (designed) parts.push(`<section class="cover designed">${designed.front}</section>`);
  else if (options.cover === 'generated' || options.cover === 'designed') {
    parts.push(generatedCover(cover, theme, strings.defaultRole));
  } else if (options.cover === 'uploaded' && input.coverImage) {
    parts.push(imageCover(input.coverImage, cover, options.coverText, strings.defaultRole));
  }

  // Title page and imprint.
  const preparerBlock = preparer.name
    ? `<div class="preparer"><div class="role">${escapeHtml(preparer.role)}</div><div class="name">${escapeHtml(preparer.name)}</div>${
        preparer.title ? `<div class="about">${escapeHtml(preparer.title)}</div>` : ''
      }</div>`
    : '';
  parts.push(
    `<section class="front titlepage">${ORNAMENT}<div class="t">${escapeHtml(doc.title)}</div>${
      doc.titleSrc && doc.titleSrc !== doc.title
        ? `<div class="o" dir="${doc.lang.srcDir}" lang="${escapeHtml(doc.lang.src)}">${escapeHtml(doc.titleSrc)}</div>`
        : ''
    }${cover.authors ? `<div class="a">${escapeHtml(cover.authors)}</div>` : ''}<div class="rule"></div>${preparerBlock}<div class="date">${escapeHtml(date)}</div></section>`,
  );

  const f = strings.fields;
  const row = (k: string, v: string, vDir = dir) =>
    v ? `<tr><th>${escapeHtml(k)}</th><td dir="${vDir}">${escapeHtml(v)}</td></tr>` : '';
  const publisher = [input.book.publisher, input.book.year ? localizeDigits(String(input.book.year), tgt) : '']
    .filter(Boolean)
    .join('، ');
  parts.push(
    `<section class="front imprint"><h2 id="imprint">${escapeHtml(strings.imprint)}</h2><table>${row(f.title, doc.title)}${row(
      f.original,
      doc.titleSrc !== doc.title ? doc.titleSrc : '',
      doc.lang.srcDir,
    )}${row(f.authors, doc.authors.join('، '))}${row(f.publisher, publisher)}${row(
      preparer.role,
      [preparer.name, preparer.title].filter(Boolean).join(' — '),
    )}${row(f.kind, input.editOnly ? strings.kinds.edition : strings.kinds.translation)}${row(f.date, date)}${row(
      f.figures,
      layout.figures.length ? localizeDigits(String(layout.figures.length), tgt) : '',
    )}</table><p class="made">${escapeHtml(strings.made)} ${escapeHtml(strings.personalUse)}</p></section>`,
  );

  // Table of contents, then the lists of figures and tables.
  const glossaryId = 'glossary';
  const tocItems = layout.toc.map((e) => tocItem(input, e.id, `l${e.level}`, e.text));
  if (doc.glossary.length) tocItems.push(tocItem(input, glossaryId, 'l1', strings.glossary));
  parts.push(
    `<nav class="front toc"><h2 class="fm-title" id="toc">${escapeHtml(strings.toc)}</h2><ol>${tocItems.join('')}</ol></nav>`,
  );
  for (const kind of ['figure', 'table'] as const) {
    const list = layout.figures.filter((p) => p.figure.kind === kind && p.figure.number);
    if (!list.length) continue;
    const items = list.map((p) => {
      const label = fill(kind === 'table' ? strings.table : strings.figure, {
        number: localizeDigits(p.figure.number ?? '', tgt),
      });
      const rest = captionBody(p.caption, tgt);
      return tocItem(input, `a-${p.id}`, 'l2 fig', shorten(`${label} — ${rest || label}`, 110));
    });
    parts.push(
      `<nav class="lists toc"><h2 class="fm-title" id="${kind === 'table' ? 'lot' : 'lof'}">${escapeHtml(kind === 'table' ? strings.tables : strings.figures)}</h2><ol>${items.join('')}</ol></nav>`,
    );
  }

  // Chapters.
  layout.chapters.forEach((ch, i) => {
    const src =
      options.mode === 'bilingual' && ch.titleSrc && ch.titleSrc !== ch.title
        ? `<div class="src" dir="${doc.lang.srcDir}">${escapeHtml(ch.titleSrc)}</div>`
        : '';
    parts.push(
      `<section class="chapter" style="page: ch${i}" dir="${dir}"><header class="opener">${ORNAMENT}<h1 id="${ch.id}">${inline(
        ch.title,
        tgt,
      )}</h1>${src}</header>${ch.blocks.map((b) => blockHtml(b, input)).join('\n')}</section>`,
    );
  });

  if (doc.glossary.length) {
    const terms = doc.glossary
      .map(
        (g) =>
          `<div class="term"><dt dir="${doc.lang.srcDir}">${escapeHtml(g.src)}</dt><dd>${escapeHtml(g.tgt)}${
            g.definition ? ` — ${escapeHtml(g.definition)}` : ''
          }</dd></div>`,
      )
      .join('');
    parts.push(
      `<section class="glossary" dir="${dir}"><h1 id="${glossaryId}">${escapeHtml(strings.glossary)}</h1><dl>${terms}</dl></section>`,
    );
  }
  if (options.backCover && options.cover !== 'none') {
    parts.push(
      designed
        ? `<section class="cover designed">${designed.back}</section>`
        : backCover(cover, theme, strings.defaultRole),
    );
  }

  return `<!doctype html>
<html lang="${escapeHtml(tgt)}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>${embeddedFonts()}${designed ? `${designed.css}${COVER_STYLE}` : ''}${options.font === 'naskh' ? naskhFonts() : ''}${figureFonts()}${pageCss(input)}${bookCss(input)}</style>
</head>
<body>
${parts.join('\n')}
<script>
// Labels set back into figures shrink until they fit the space the original words had.
// Then, within a figure, labels that were one size in the original are one size again: the smallest that fits, so
// boxes of the same kind do not each get a different size; a label that needs much more shrinking than the rest
// (below 72% of the original) keeps its own size instead of shrinking them all.
window.__fitLabels = function () {
  var arts = document.querySelectorAll('.art');
  var count = 0;
  for (var a = 0; a < arts.length; a++) {
    var els = arts[a].querySelectorAll('.lbl');
    var fits = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var inner = el.firstElementChild;
      var base = parseFloat(getComputedStyle(el).fontSize);
      var size = base;
      var guard = 0;
      var rot = el.classList.contains('rot');
      var over = function () {
        return rot
          ? inner.scrollHeight > el.clientWidth + 0.5
          : inner.scrollHeight > el.clientHeight + 0.5 || inner.scrollWidth > el.clientWidth + 0.5;
      };
      while (over() && size > base * 0.5 && guard++ < 60) {
        size = size * 0.96;
        el.style.fontSize = size + 'px';
      }
      fits.push({ el: el, base: base, size: size, key: el.getAttribute('data-pt') || '' });
    }
    var common = {};
    for (var j = 0; j < fits.length; j++) {
      var f = fits[j];
      var floor = Math.max(f.size, f.base * 0.72);
      common[f.key] = common[f.key] === undefined ? floor : Math.min(common[f.key], floor);
    }
    for (var k = 0; k < fits.length; k++) {
      var g = fits[k];
      g.el.style.fontSize = Math.min(g.size, common[g.key]) + 'px';
    }
    count += els.length;
  }
  return count;
};
</script>
</body>
</html>
`;
}
