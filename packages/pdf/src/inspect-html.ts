import { createRequire } from 'node:module';
import type { Block, ExtractedBook } from './types';

const require = createRequire(import.meta.url);
const PDFJS_VERSION = (require('pdfjs-dist/package.json') as { version: string }).version;

const COLORS: Record<Block['type'], string> = {
  heading: '#d9480f',
  paragraph: '#1c7ed6',
  list_item: '#2f9e44',
  quote: '#9c36b5',
  code: '#495057',
  caption: '#f08c00',
  footnote: '#0c8599',
  figure: '#e03131',
};

/**
 * Debug page (SPEC §8.9): renders each PDF page with pdf.js in the browser and overlays coloured boxes
 * for the detected blocks. The PDF is embedded, so the file stays local (pdf.js is loaded from a CDN).
 */
export function inspectHtml(data: Uint8Array, ex: ExtractedBook, blocks: Block[]): string {
  const boxes = blocks.flatMap((b) => {
    const byPage = new Map<number, typeof b.lines>();
    for (const l of b.lines) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l]);
    if (b.box)
      return [{ page: b.page, x: b.box.x, y: b.box.y, w: b.box.width, h: b.box.height, type: b.type, label: b.type }];
    return [...byPage.entries()].map(([page, lines]) => {
      const x0 = Math.min(...lines.map((l) => l.x0));
      const x1 = Math.max(...lines.map((l) => l.x1));
      const y0 = Math.min(...lines.map((l) => l.y - l.size));
      const y1 = Math.max(...lines.map((l) => l.y + l.size * 0.25));
      return { page, x: x0, y: y0, w: x1 - x0, h: y1 - y0, type: b.type, label: `${b.type} ${b.text.slice(0, 40)}` };
    });
  });
  const pages = ex.pages.map((p) => ({ index: p.index, width: p.width, height: p.height }));
  const base64 = Buffer.from(data).toString('base64');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>pdf:inspect</title>
<style>
body{font:13px system-ui,sans-serif;background:#eee;margin:0;padding:16px}
.page{position:relative;margin:0 auto 24px;background:#fff;box-shadow:0 2px 8px #0002}
.box{position:absolute;border:1.5px solid;opacity:.85}
.box span{position:absolute;top:-14px;left:0;font-size:10px;white-space:nowrap;background:#fff;padding:0 2px}
.legend span{display:inline-block;margin-inline-end:12px}
</style></head><body>
<p class="legend">${Object.entries(COLORS)
    .map(([t, c]) => `<span style="color:${c}">■ ${t}</span>`)
    .join('')}</p>
<div id="pages"></div>
<script type="module">
import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs';
const pages = ${JSON.stringify(pages)};
const boxes = ${JSON.stringify(boxes)};
const colors = ${JSON.stringify(COLORS)};
const bytes = Uint8Array.from(atob('${base64}'), (c) => c.charCodeAt(0));
const pdf = await pdfjs.getDocument({ data: bytes }).promise;
const scale = 1.5;
for (const p of pages) {
  const page = await pdf.getPage(p.index + 1);
  const vp = page.getViewport({ scale });
  const div = document.createElement('div');
  div.className = 'page';
  div.style.width = vp.width + 'px';
  div.style.height = vp.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  div.append(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  for (const b of boxes.filter((x) => x.page === p.index)) {
    const el = document.createElement('div');
    el.className = 'box';
    Object.assign(el.style, { left: b.x * scale + 'px', top: b.y * scale + 'px', width: b.w * scale + 'px', height: b.h * scale + 'px', borderColor: colors[b.type] });
    const label = document.createElement('span');
    label.textContent = b.label; label.style.color = colors[b.type];
    el.append(label);
    div.append(el);
  }
  const caption = document.createElement('p');
  caption.textContent = 'page ' + (p.index + 1);
  document.getElementById('pages').append(caption, div);
}
</script></body></html>`;
}
