import { endsWithTerminalPunctuation } from '@dozabaneh/text';
import { type OrderedLine, percentile, weightedMode } from './layout';
import type { Block, BlockType, Line, PageData, TextRun } from './types';

export interface DocStats {
  bodySize: number;
  lineGap: number;
  /** Lower-cased word frequencies (plain and hyphenated forms) for de-hyphenation. */
  words: Map<string, number>;
  lang: string;
}

const WORD = /[\p{L}][\p{L}\p{M}'’-]*[\p{L}]|[\p{L}]/gu;

export function docStats(pages: PageData[], lang: string): DocStats {
  const all = pages.flatMap((p) => p.lines);
  const bodySize = weightedMode(all, (l) => l.size) ?? 10;
  const gaps: number[] = [];
  for (const p of pages) {
    const body = p.lines.filter((l) => Math.abs(l.size - bodySize) < 0.6).sort((a, b) => a.y - b.y);
    for (let i = 1; i < body.length; i++) {
      const g = (body[i] as Line).y - (body[i - 1] as Line).y;
      if (g > bodySize * 0.8 && g < bodySize * 2.2) gaps.push(g);
    }
  }
  const words = new Map<string, number>();
  for (const l of all) {
    const text = l.text.replace(/[-‐]\s*$/, ''); // a line-end fragment is not a word
    for (const w of text.match(WORD) ?? []) {
      const k = w.toLowerCase();
      words.set(k, (words.get(k) ?? 0) + 1);
    }
  }
  return { bodySize, lineGap: gaps.length ? percentile(gaps, 0.5) : bodySize * 1.25, words, lang };
}

const MARKER = /^\s*(?:([•◦▪●○■□–—*·])|\(?(\d{1,3}|[a-z]|[ivx]{1,4})[.)])\s+/i;
const CAPTION = /^(?:figure|fig\.|table|exhibit|chart|plate)\s+[\dIVX]+(?:[.:-]\d+)*/i;
const FOOTNOTE_START = /^(?:\d{1,3}|[*†‡§])\s*/;

interface Edges {
  left: number;
  right: number;
}

function columnEdges(lines: OrderedLine[], bodySize: number): Map<number, Edges> {
  const out = new Map<number, Edges>();
  const cols = new Set(lines.map((l) => l.column));
  for (const c of cols) {
    const body = lines.filter((l) => l.column === c && Math.abs(l.size - bodySize) < 1);
    const src = body.length >= 3 ? body : lines.filter((l) => l.column === c);
    out.set(c, {
      left: percentile(
        src.map((l) => l.x0),
        0.1,
      ),
      right: percentile(
        src.map((l) => l.x1),
        0.9,
      ),
    });
  }
  return out;
}

const endsSentence = (text: string, lang: string) => endsWithTerminalPunctuation(text, lang);

/** Paragraph segmentation on one page (SPEC §8.4). Continuations across pages are merged later. */
export function pageBlocks(page: PageData, lines: OrderedLine[], stats: DocStats): Block[] {
  const edges = columnEdges(lines, stats.bodySize);
  const blocks: Block[] = [];
  let current: OrderedLine[] = [];
  let currentMarker = false;

  const flush = () => {
    if (current.length) blocks.push(makeBlock(page, current, stats, edges));
    current = [];
    currentMarker = false;
  };

  for (const line of lines) {
    const prev = current[current.length - 1];
    if (!prev) {
      current = [line];
      currentMarker = MARKER.test(line.text);
      continue;
    }
    const edge = edges.get(line.column) ?? { left: line.x0, right: line.x1 };
    const gap = line.y - prev.y;
    const expected = Math.abs(prev.size - stats.bodySize) < 0.6 ? stats.lineGap : prev.size * 1.2;
    const indent = line.x0 - edge.left;
    const prevIndent = prev.x0 - edge.left;
    const marker = MARKER.test(line.text) && !line.mono;
    const hangingContinuation =
      currentMarker && indent > line.size * 0.3 && Math.abs(line.x0 - textStart(current[0] as Line)) < line.size;

    const newBlock =
      line.column !== prev.column ||
      gap > expected * 1.35 ||
      gap < 0 ||
      Math.abs(line.size - prev.size) > 0.6 ||
      line.mono !== prev.mono ||
      (line.bold !== prev.bold && (line.bold ? line.text.length < 90 : prev.text.length < 90) && !line.mono) ||
      marker ||
      (!line.mono &&
        !hangingContinuation &&
        indent > line.size * 0.6 &&
        prevIndent < line.size * 0.3 &&
        current.length >= 1) ||
      (!line.mono &&
        !hangingContinuation &&
        endsSentence(prev.text, stats.lang) &&
        edge.right - prev.x1 > firstWordWidth(line) + line.size * 0.5);

    if (newBlock) {
      flush();
      current = [line];
      currentMarker = marker;
    } else current.push(line);
  }
  flush();

  for (const img of page.images) {
    blocks.push({
      type: 'figure',
      page: page.index,
      pageEnd: page.index,
      column: 0,
      y: img.y,
      x0: img.x,
      x1: img.x + img.width,
      size: stats.bodySize,
      lines: [],
      text: '',
      bold: false,
      indent: 0,
      meta: {},
      box: img,
    });
  }
  return blocks.sort((a, b) => a.column - b.column || a.y - b.y).sort((a, b) => columnOrder(a, b));
}

/** Keeps the page's reading order: spanning blocks (column 0) interleave by position with column regions. */
function columnOrder(a: Block, b: Block): number {
  if (a.column === b.column) return a.y - b.y;
  if (a.column === 0 || b.column === 0) return a.y - b.y;
  return a.column - b.column;
}

/** Width of a line's first word: if it would have fitted on the previous line, that line ended a paragraph. */
function firstWordWidth(line: Line): number {
  const run = line.runs[0];
  if (!run) return 0;
  const word = run.text.trimStart().split(/\s+/)[0] ?? '';
  return (run.width / Math.max(1, run.text.length)) * word.length;
}

function textStart(line: Line): number {
  const first = line.runs[0];
  if (!first) return line.x0;
  const m = MARKER.exec(first.text);
  if (!m) return line.x0;
  const second = line.runs[1];
  // Marker as its own run: the text starts at the next run.
  if (first.text.trim().length <= 3 && second) return second.x;
  const ratio = first.width / Math.max(1, first.text.length);
  return first.x + m[0].length * ratio;
}

function makeBlock(page: PageData, lines: OrderedLine[], stats: DocStats, edges: Map<number, Edges>): Block {
  const first = lines[0] as OrderedLine;
  const edge = edges.get(first.column) ?? { left: first.x0, right: first.x1 };
  const size = weightedMode(lines, (l) => l.size) ?? first.size;
  const chars = (pred: (l: Line) => boolean) => lines.filter(pred).reduce((n, l) => n + l.text.length, 0);
  const total = Math.max(
    1,
    chars(() => true),
  );
  const bold = chars((l) => l.bold) / total > 0.8;
  const mono = chars((l) => l.mono) / total > 0.8;
  const block: Block = {
    type: 'paragraph',
    page: page.index,
    pageEnd: page.index,
    column: first.column,
    y: first.y - first.size,
    x0: Math.min(...lines.map((l) => l.x0)),
    x1: Math.max(...lines.map((l) => l.x1)),
    size,
    lines,
    text: '',
    bold,
    indent: first.x0 - edge.left,
    meta: {},
  };
  block.type = classify(block, page, stats, edge, mono);
  if (block.type === 'list_item') {
    const m = MARKER.exec(first.text);
    const marker = (m?.[1] ?? m?.[2] ?? '•').trim();
    block.meta = {
      level: Math.max(0, Math.round((first.x0 - edge.left) / (size * 1.5))),
      ordered: !m?.[1],
      marker: m?.[1] ? marker : `${marker}.`,
    };
  }
  if (block.type === 'list_item') block.textX = textStart(first);
  block.text = renderText(block, stats);
  if (block.type === 'footnote') {
    const m = FOOTNOTE_START.exec(block.text);
    if (m) {
      block.meta = { footnoteId: m[0].trim() };
      block.text = block.text.slice(m[0].length).trim();
    }
  }
  if (block.type === 'caption') {
    const m = /[\dIVX]+(?:[.:-]\d+)*/.exec(block.text);
    if (m) block.meta = { figureId: m[0] };
  }
  return block;
}

function classify(block: Block, page: PageData, stats: DocStats, edge: Edges, mono: boolean): BlockType {
  const text = block.lines.map((l) => l.text).join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (mono) return 'code';
  if (CAPTION.test(text) && words < 80) return 'caption';
  const first = block.lines[0] as Line;
  const small = block.size <= stats.bodySize * 0.92;
  if (small && block.y > page.height * 0.6 && (FOOTNOTE_START.test(text) || first.runs[0]?.sup)) return 'footnote';
  const big = block.size >= stats.bodySize * 1.15;
  const shortBold = block.bold && block.lines.length <= 3 && words <= 16 && !/[.,;]$/.test(text.trim());
  if ((big && words <= 30) || shortBold) return 'heading';
  if (MARKER.test(first.text) && words > 1) return 'list_item';
  // Quotes are indented on both sides; a single indented line needs a deeper indent than a paragraph's first line.
  const indentBoth =
    block.lines.every((l) => l.x0 >= edge.left + stats.bodySize * (block.lines.length > 1 ? 1.2 : 2.5)) &&
    block.lines.slice(0, -1).every((l) => l.x1 <= edge.right - stats.bodySize * 1.2);
  if (indentBoth && words > 3) return 'quote';
  return 'paragraph';
}

interface Piece {
  text: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  sup: boolean;
}

/** Joins lines (with de-hyphenation) and renders inline markup for styled runs. */
function renderText(block: Block, stats: DocStats): string {
  if (block.type === 'code') {
    const charW = block.size * 0.6;
    const left = Math.min(...block.lines.map((l) => l.x0));
    return block.lines
      .map((l) => ' '.repeat(Math.max(0, Math.round((l.x0 - left) / charW))) + l.runs.map((r) => r.text).join(''))
      .join('\n')
      .replace(/[ \t]+$/gm, '');
  }
  const pieces: Piece[] = [];
  block.lines.forEach((line, li) => {
    const runs = li === 0 && block.type === 'list_item' ? stripMarker(line.runs) : line.runs;
    runs.forEach((r, ri) => {
      let text = r.text;
      if (ri === 0 && li > 0) text = text.replace(/^\s+/, '');
      pieces.push({ text, bold: r.bold, italic: r.italic, mono: r.mono, sup: r.sup });
    });
    const next = block.lines[li + 1];
    if (!next) return;
    joinLines(pieces, next, stats, block);
  });
  const plainStyle = block.type === 'heading';
  // Styles covering the whole block are not emphasis (e.g. an all-italic quote or a bold heading).
  const all = (k: 'bold' | 'italic' | 'mono') => pieces.filter((p) => p.text.trim()).every((p) => p[k]);
  const skip = {
    bold: plainStyle || all('bold'),
    italic: all('italic') && block.type !== 'paragraph',
    mono: all('mono'),
  };
  return renderPieces(pieces, skip).replace(/\s+/g, ' ').trim();
}

function stripMarker(runs: TextRun[]): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  const first = out[0];
  if (!first) return out;
  const m = MARKER.exec(first.text);
  if (m) first.text = first.text.slice(m[0].length);
  if (!first.text.trim() && out.length > 1) out.shift();
  return out;
}

/** Line join with de-hyphenation (SPEC §8.4): "compu-⏎tation" → "computation", keeps "self-⏎driving". */
function joinLines(pieces: Piece[], next: Line, stats: DocStats, block: Block): void {
  const last = pieces[pieces.length - 1];
  if (!last) return;
  const trimmed = last.text.replace(/\s+$/, '');
  const nextWord = (next.runs[0]?.text ?? '').trim().match(/^[\p{L}\p{M}'’]+/u)?.[0] ?? '';
  const hyphen = /(\p{L}+)[-‐]$/u.exec(trimmed);
  if (hyphen && nextWord) {
    const decision = dehyphenate(hyphen[1] as string, nextWord, stats.words);
    last.text = decision === 'join' ? trimmed.slice(0, -1) : trimmed;
    if (decision === 'join') block.dehyphenated = (block.dehyphenated ?? 0) + 1;
    return;
  }
  if (/[—–]$/.test(trimmed)) {
    last.text = trimmed;
    return;
  }
  last.text = `${trimmed} `;
}

export function dehyphenate(left: string, right: string, words: Map<string, number>): 'join' | 'keep' {
  const joined = (left + right).toLowerCase();
  const hyphenated = `${left}-${right}`.toLowerCase();
  if ((words.get(hyphenated) ?? 0) > (words.get(joined) ?? 0)) return 'keep';
  if ((words.get(joined) ?? 0) > 0 || /^\p{Ll}/u.test(right)) return 'join';
  return 'keep';
}

const escapeText = (t: string) => t.replace(/([*`\\])/g, '\\$1').replace(/\[(?=\^|\[)/g, '\\[');

function renderPieces(pieces: Piece[], skip: { bold: boolean; italic: boolean; mono: boolean }): string {
  // Merge neighbours with the same effective style first.
  const style = (p: Piece) => ({
    bold: p.bold && !skip.bold,
    italic: p.italic && !skip.italic,
    mono: p.mono && !skip.mono,
  });
  let out = '';
  let buf: { text: string; bold: boolean; italic: boolean; mono: boolean } | null = null;
  const emit = () => {
    if (!buf) return;
    const lead = buf.text.match(/^\s*/)?.[0] ?? '';
    const trail = buf.text.match(/\s*$/)?.[0] ?? '';
    const core = buf.text.trim();
    if (!core) out += buf.text;
    else if (buf.mono) out += `${lead}\`${core.replace(/`/g, "'")}\`${trail}`;
    else {
      let t = escapeText(core);
      if (buf.italic) t = `*${t}*`;
      if (buf.bold) t = `**${t}**`;
      out += lead + t + trail;
    }
    buf = null;
  };
  for (const p of pieces) {
    if (p.sup && /^\s*\d{1,3}\s*$/.test(p.text)) {
      emit();
      out = `${out.replace(/\s+$/, '')}[^${p.text.trim()}]`;
      continue;
    }
    const s = style(p);
    if (buf && buf.bold === s.bold && buf.italic === s.italic && buf.mono === s.mono) buf.text += p.text;
    else {
      emit();
      buf = { text: p.text, ...s };
    }
  }
  emit();
  return out;
}
