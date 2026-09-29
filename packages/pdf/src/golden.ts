import type { Analysis } from './pipeline';

export interface GoldenNode {
  kind: string;
  depth: number;
  title: string;
  numberLabel?: string;
  skip: boolean;
  pages: [number, number];
  segments: [type: string, text: string][];
}

export interface Golden {
  source: string;
  labels: string[];
  nodes: GoldenNode[];
  stats: {
    mergedContinuations: number;
    dehyphenated: number;
    removedHeaderFooterLines: number;
    suspectedBreaks: number;
  };
}

/** Stable, reviewable summary of an ingestion result for golden tests (no generated ids). */
export function summarize(a: Omit<Analysis, 'blocks'>): Golden {
  return {
    source: a.report.structureSource,
    labels: a.pageLabels,
    nodes: a.nodes.map((n) => ({
      kind: n.kind,
      depth: n.depth,
      title: n.headingIndex !== undefined ? (a.segments[n.headingIndex]?.src ?? n.title) : n.title,
      ...(n.numberLabel ? { numberLabel: n.numberLabel } : {}),
      skip: n.skip,
      pages: [n.pageStart, n.pageEnd],
      segments: a.segments.filter((s) => s.nodeKey === n.key).map((s) => [s.type, s.src] as [string, string]),
    })),
    stats: {
      mergedContinuations: a.report.stats.mergedContinuations,
      dehyphenated: a.report.stats.dehyphenated,
      removedHeaderFooterLines: a.report.stats.removedHeaderFooterLines,
      suspectedBreaks: a.report.stats.suspectedBreaks,
    },
  };
}
