import { endsWithTerminalPunctuation, stripMarkup } from '@dozabaneh/text';
import { docStats, pageBlocks } from './blocks';
import { inferPageLabels, removeHeadersFooters } from './cleanup';
import { type ExtractOptions, extractPdf } from './extract';
import { orderPage } from './layout';
import { mergeContinuations } from './merge';
import { buildStructure } from './structure';
import type { Block, BookStructure, ExtractedBook, ExtractionReport } from './types';

export interface AnalyzeOptions {
  /** Source language of the book (registry code). */
  lang?: string;
  rtl?: boolean;
}

export interface Analysis extends BookStructure {
  blocks: Block[];
}

/** Pure part of ingestion: ExtractedBook → blocks → BookStructure + ExtractionReport (SPEC §8.3–§8.7). */
export function analyze(ex: ExtractedBook, opts: AnalyzeOptions = {}): Analysis {
  const lang = opts.lang ?? 'en';
  const cleaned = removeHeadersFooters(ex.pages, ex.outline, undefined, ex.meta.title ? [ex.meta.title] : []);
  const labels = inferPageLabels(ex.pageCount, ex.pageLabels, cleaned.printed);
  const stats = docStats(cleaned.pages, lang);
  const raw = cleaned.pages.flatMap((p) => pageBlocks(p, orderPage(p, opts.rtl), stats));
  const blocks = mergeContinuations(raw, stats);
  const { nodes, segments, source } = buildStructure(blocks, ex, labels);

  // Suspected mid-sentence breaks: body paragraphs of translated (non-skipped) nodes.
  const skipped = new Set(nodes.filter((n) => n.skip).map((n) => n.key));
  const paragraphs = segments.filter((s) => s.type === 'paragraph' && !skipped.has(s.nodeKey));
  const suspected = paragraphs.filter((s) => !endsWithTerminalPunctuation(stripMarkup(s.src), lang));
  const segmentsByType: Record<string, number> = {};
  for (const s of segments) segmentsByType[s.type] = (segmentsByType[s.type] ?? 0) + 1;
  const emptyPages = ex.pages.filter((p) => p.lines.reduce((n, l) => n + l.text.length, 0) < 20).map((p) => p.index);
  const ocrPages = ex.pages.filter((p) => p.ocr).map((p) => p.index);

  const warnings: ExtractionReport['warnings'] = [];
  if (ocrPages.length > 0) {
    warnings.push({
      code: 'pages_ocr',
      message: `${ocrPages.length} scanned pages read with OCR; check them for recognition errors`,
      pages: ocrPages.slice(0, 50),
    });
  }
  if (emptyPages.length > 0) {
    warnings.push({
      code: 'pages_without_text',
      message: `${emptyPages.length} pages without a text layer`,
      pages: emptyPages,
    });
  }
  if (emptyPages.length > 0 && ex.ocr?.available === false) {
    warnings.push({
      code: 'ocr_unavailable',
      message: `No OCR data for language "${ex.ocr.lang}"; scanned pages cannot be read`,
    });
  }
  if (source !== 'outline')
    warnings.push({ code: `structure_from_${source}`, message: `No PDF outline; structure from ${source}` });
  const ratio = paragraphs.length ? suspected.length / paragraphs.length : 0;
  if (ratio > 0.01) {
    warnings.push({
      code: 'suspected_breaks',
      message: `${suspected.length} paragraphs end without terminal punctuation`,
      pages: [...new Set(suspected.map((s) => s.pageEnd))].slice(0, 50),
    });
  }

  const report: ExtractionReport = {
    stats: {
      pages: ex.pageCount,
      pagesWithoutText: emptyPages.length,
      ocrPages: ocrPages.length,
      words: segments.reduce((n, s) => n + (s.src.match(/\S+/g)?.length ?? 0), 0),
      chapters: nodes.filter((n) => n.kind === 'chapter').length,
      sections: nodes.filter((n) => n.kind === 'section' || n.kind === 'subsection').length,
      segments: segments.length,
      segmentsByType,
      mergedContinuations: blocks.reduce((n, b) => n + (b.merged ?? 0), 0),
      dehyphenated: blocks.reduce((n, b) => n + (b.dehyphenated ?? 0), 0),
      removedHeaderFooterLines: cleaned.removed,
      paragraphs: paragraphs.length,
      suspectedBreaks: suspected.length,
      suspectedBreakRatio: Math.round(ratio * 10_000) / 10_000,
    },
    structureSource: source,
    warnings,
  };

  const authors = (ex.meta.author ?? '')
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
  const firstHeading = blocks.find((b) => b.type === 'heading')?.text;
  return {
    meta: { title: ex.meta.title ?? firstHeading ?? '', authors },
    pageLabels: labels,
    nodes,
    segments,
    report,
    blocks,
  };
}

/** Full ingestion of a PDF buffer. Runs pdf.js; call it inside a worker thread in the server. */
export async function ingestPdf(data: Uint8Array, opts: ExtractOptions & AnalyzeOptions = {}): Promise<Analysis> {
  const ex = await extractPdf(data, opts);
  return analyze(ex, opts);
}
