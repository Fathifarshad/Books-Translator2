import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { buildSection, chapterOf, createBookIndex, glossaryFor, nodeTitle, translationCounter } from '@dozabaneh/core';
import type { BookBundle } from '@dozabaneh/shared';
import { escapeHtml, formatNumber, getLanguage, markupToHtml, stripMarkup } from '@dozabaneh/text';
import { repoRoot } from '../config';
import { OFFLINE_CSS, OFFLINE_JS } from './offline-reader';

/**
 * «نسخه‌ی آفلاین»: one self-contained HTML file with the book (source + translation), a small reader for phones,
 * the UI strings and the fonts. It opens from Telegram/WhatsApp/Files on Android without internet or a server.
 * Book text is rendered to escaped HTML here (markupToHtml), so the embedded reader only places trusted fragments.
 */
const require = createRequire(import.meta.url);

interface OfflineBook {
  id: string;
  title: string;
  plainTitle: string;
  lang: { src: string; tgt: string; srcDir: string; tgtDir: string };
  toc: { id: string; depth: number; label: string; sub?: string }[];
  order: string[];
  sections: Record<string, { title: string; plainTitle: string; chapter?: string; rows: [string, string, string][] }>;
  glossary: [string, string, string][];
  counts: { done: string; total: string };
  exportedAt: string;
}

let fontCss: string | undefined;
/** Vazirmatn (OFL-1.1), Arabic + Latin subsets as data URLs (≈ 110 KB), so Persian renders well on any phone. */
function embeddedFonts(): string {
  if (fontCss !== undefined) return fontCss;
  try {
    const dir = join(dirname(require.resolve('@fontsource-variable/vazirmatn/package.json')), 'files');
    const face = (file: string, range: string) =>
      `@font-face{font-family:"Vazirmatn Offline";font-style:normal;font-display:swap;font-weight:100 900;` +
      `src:url(data:font/woff2;base64,${readFileSync(join(dir, file)).toString('base64')}) format("woff2");unicode-range:${range}}`;
    fontCss =
      face(
        'vazirmatn-arabic-wght-normal.woff2',
        'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF',
      ) + face('vazirmatn-latin-wght-normal.woff2', 'U+0000-00FF,U+2000-206F,U+20AC');
  } catch {
    fontCss = ''; // system fonts
  }
  return fontCss;
}

/** UI strings of the offline reader (i18n: apps/web/src/i18n/fa.json → "offline"). */
function offlineStrings(): Record<string, string> {
  const all = JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/i18n/fa.json'), 'utf8')) as {
    offline: Record<string, string>;
  };
  return all.offline;
}

/** JSON inside <script type="application/json">: `<` escaped so book text can never close the tag. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function buildOfflineBook(bundle: BookBundle, lang: string, now = new Date()): OfflineBook {
  const index = createBookIndex(bundle);
  const src = bundle.book.sourceLang;
  const srcInfo = getLanguage(src);
  const tgtInfo = getLanguage(lang);
  const html = (text: string, l: string) => markupToHtml(text, getLanguage(l).refLabels);
  const digits = (n: number) => formatNumber(n, tgtInfo.locale);

  const sections: OfflineBook['sections'] = {};
  for (const node of index.readingOrder) {
    const section = buildSection(index, node.id, lang);
    if (!section) continue;
    const chapter = chapterOf(index, node.id);
    const chapterTitle = chapter && chapter.id !== node.id ? nodeTitle(index, chapter, lang) : undefined;
    const title = section.title.tgt ?? section.title.src;
    sections[node.id] = {
      title: escapeHtml(title),
      plainTitle: stripMarkup(title),
      ...(chapterTitle ? { chapter: escapeHtml(chapterTitle.tgt ?? chapterTitle.src) } : {}),
      rows: section.rows.map((r) => [r.type, html(r.src, src), r.tgt ? html(r.tgt, lang) : '']),
    };
  }

  const toc = index.nodes
    .filter((n) => !n.skip)
    .map((n) => {
      const t = nodeTitle(index, n, lang);
      const number = n.kind === 'chapter' && n.numberLabel ? `${n.numberLabel}. ` : '';
      return {
        id: n.id,
        depth: n.depth,
        label: escapeHtml(`${number}${t.tgt ?? t.src}`),
        ...(t.tgt && t.src && t.tgt !== t.src ? { sub: escapeHtml(t.src) } : {}),
      };
    });

  const counter = translationCounter(index, lang);
  const title = bundle.book.titles[lang] ?? bundle.book.titles[src] ?? '';
  return {
    id: bundle.book.id,
    title: escapeHtml(title),
    plainTitle: title,
    lang: { src, tgt: lang, srcDir: srcInfo.dir, tgtDir: tgtInfo.dir },
    toc,
    order: index.readingOrder.map((n) => n.id).filter((id) => sections[id]),
    sections,
    glossary: glossaryFor(index, lang).map((g) => [
      escapeHtml(g.src),
      escapeHtml(g.tgt),
      g.definition ? escapeHtml(g.definition) : '',
    ]),
    counts: { done: digits(counter.done), total: digits(counter.total) },
    exportedAt: new Intl.DateTimeFormat(tgtInfo.locale, { dateStyle: 'medium' }).format(now),
  };
}

export function buildOfflineHtml(bundle: BookBundle, lang: string, now = new Date()): string {
  const book = buildOfflineBook(bundle, lang, now);
  const strings = offlineStrings();
  const ui = getLanguage(lang);
  const src = getLanguage(bundle.book.sourceLang);
  strings.modeTarget = ui.nativeName;
  strings.modeSource = src.nativeName;
  // Titles and button labels are filled in by the reader script from the UI strings.
  const drawer = (id: string, body: string) =>
    `<div class="drawer" id="${id}-drawer"><div class="panel" role="dialog" aria-labelledby="${id}-title">` +
    `<div class="bar"><h3 id="${id}-title"></h3><button style="margin-inline-start:auto" data-close="${id}-drawer"></button></div>${body}</div></div>`;
  return `<!doctype html>
<html lang="${lang}" dir="${ui.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${book.title}</title>
<style>${embeddedFonts()}${OFFLINE_CSS}</style>
</head>
<body>
<header>
<h1 id="book-title"></h1>
<div class="bar">
<button id="btn-toc"></button><button id="btn-search"></button><button id="btn-gloss"></button>
<div class="modes"><button id="mode-tgt"></button><button id="mode-both"></button><button id="mode-src"></button></div>
</div>
<div class="bar"><button id="btn-smaller"></button><button id="btn-larger"></button><button id="btn-theme"></button>
<small id="progress" style="margin-inline-start:auto;color:var(--muted)"></small></div>
</header>
<main id="main"></main>
<button class="fab" id="fab-toc"></button>
${drawer('toc', '<nav class="toc" id="toc"></nav>')}
${drawer('search', '<div class="search"><input id="q" type="search" autocomplete="off"></div><div class="results" id="results"></div>')}
${drawer('gloss', '<dl class="gloss" id="gloss"></dl>')}
<script type="application/json" id="book">${scriptJson(book)}</script>
<script type="application/json" id="strings">${scriptJson(strings)}</script>
<script>${OFFLINE_JS}</script>
</body>
</html>
`;
}
