import type { NodeKind, SegmentRecord, TocNodeRecord } from '@dozabaneh/shared';

/**
 * Structure review operations (SPEC §8.8). Pure functions over a book's nodes and segments.
 * Segment IDs never change; only node membership, order and node records do.
 */
export type StructureOp =
  | { op: 'rename'; nodeId: string; title: string }
  | { op: 'skip'; nodeId: string; skip: boolean }
  | { op: 'promote'; nodeId: string }
  | { op: 'demote'; nodeId: string }
  | { op: 'merge'; nodeId: string; with: 'prev' | 'next' }
  | { op: 'split'; nodeId: string; segmentId: string; newNodeId: string };

export interface Structure {
  nodes: TocNodeRecord[];
  segments: SegmentRecord[];
}

export class StructureError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID',
    message: string,
  ) {
    super(message);
  }
}

const MATTER: ReadonlySet<NodeKind> = new Set(['front', 'back']);

/** Nodes in document (pre-)order. */
export function documentOrder(nodes: TocNodeRecord[]): TocNodeRecord[] {
  const kids = new Map<string | null, TocNodeRecord[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  for (const list of kids.values()) list.sort((a, b) => a.ord - b.ord);
  const out: TocNodeRecord[] = [];
  const walk = (parent: string | null) => {
    for (const n of kids.get(parent) ?? []) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

function kindForDepth(node: TocNodeRecord, depth: number): NodeKind {
  if (node.kind === 'chapter_intro') return node.kind;
  if (depth === 0) return MATTER.has(node.kind) || node.kind === 'part' ? node.kind : 'chapter';
  if (depth === 1) return node.kind === 'part' ? 'chapter' : 'section';
  return 'subsection';
}

function renumber(nodes: TocNodeRecord[]): TocNodeRecord[] {
  const byParent = new Map<string | null, TocNodeRecord[]>();
  for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const next: TocNodeRecord[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = (byParent.get(parent) ?? []).sort((a, b) => a.ord - b.ord);
    list.forEach((n, i) => {
      const kind = kindForDepth(n, depth);
      const rec: TocNodeRecord = { ...n, ord: i, depth, kind };
      if (kind !== 'chapter' && kind !== 'part') delete rec.numberLabel;
      next.push(rec);
      walk(n.id, depth + 1);
    });
  };
  walk(null, 0);
  // Chapters that just became chapters get the next sequential number.
  let counter = 0;
  for (const n of documentOrder(next)) {
    if (n.kind !== 'chapter') continue;
    counter = n.numberLabel && /^\d+$/.test(n.numberLabel) ? Number(n.numberLabel) : counter + 1;
    if (!n.numberLabel) n.numberLabel = String(counter);
  }
  return next;
}

function reorderSegments(segments: SegmentRecord[], nodeId: string, list: SegmentRecord[]): SegmentRecord[] {
  const ids = new Set(list.map((s) => s.id));
  const rest = segments.filter((s) => !ids.has(s.id));
  return [...rest, ...list.map((s, i) => ({ ...s, nodeId, ord: i }))];
}

function segmentsOf(segments: SegmentRecord[], nodeId: string): SegmentRecord[] {
  return segments.filter((s) => s.nodeId === nodeId).sort((a, b) => a.ord - b.ord);
}

export function applyStructureOp(structure: Structure, op: StructureOp): Structure {
  const nodes = structure.nodes.map((n) => ({ ...n }));
  let segments = structure.segments.map((s) => ({ ...s }));
  const node = nodes.find((n) => n.id === op.nodeId);
  if (!node) throw new StructureError('NOT_FOUND', `node ${op.nodeId} not found`);
  const siblings = () => nodes.filter((n) => n.parentId === node.parentId).sort((a, b) => a.ord - b.ord);

  switch (op.op) {
    case 'rename': {
      const title = op.title.trim();
      if (!title) throw new StructureError('INVALID', 'empty title');
      const heading = node.headingSegmentId ? segments.find((s) => s.id === node.headingSegmentId) : undefined;
      if (heading) heading.src = title;
      else node.title = title;
      return { nodes, segments };
    }
    case 'skip': {
      // Skipping a node skips its whole subtree.
      const ids = new Set([node.id]);
      for (const n of documentOrder(nodes)) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
      for (const n of nodes) if (ids.has(n.id)) n.skip = op.skip;
      return { nodes, segments };
    }
    case 'demote': {
      const sib = siblings();
      const prev = sib[sib.indexOf(node) - 1];
      if (!prev) throw new StructureError('INVALID', 'no previous sibling to nest under');
      const lastChildOrd = Math.max(-1, ...nodes.filter((n) => n.parentId === prev.id).map((n) => n.ord));
      node.parentId = prev.id;
      node.ord = lastChildOrd + 1;
      return { nodes: renumber(nodes), segments };
    }
    case 'promote': {
      if (!node.parentId) throw new StructureError('INVALID', 'already at the top level');
      const parent = nodes.find((n) => n.id === node.parentId) as TocNodeRecord;
      // Later siblings become children of the promoted node, so document order is preserved.
      for (const s of siblings().filter((s) => s.ord > node.ord)) {
        s.parentId = node.id;
        s.ord += 1000;
      }
      for (const n of nodes) if (n.parentId === parent.parentId && n.ord > parent.ord) n.ord += 1;
      node.parentId = parent.parentId;
      node.ord = parent.ord + 1;
      return { nodes: renumber(nodes), segments };
    }
    case 'merge': {
      const order = documentOrder(nodes);
      const i = order.indexOf(node);
      const [into, from] = op.with === 'prev' ? [order[i - 1], node] : [node, order[i + 1]];
      if (!into || !from) throw new StructureError('INVALID', `no ${op.with} node to merge with`);
      const moved = [...segmentsOf(segments, into.id), ...segmentsOf(segments, from.id)];
      segments = reorderSegments(segments, into.id, moved);
      for (const n of nodes) if (n.parentId === from.id) n.parentId = into.id;
      into.pageEnd = Math.max(into.pageEnd, from.pageEnd);
      if (!into.headingSegmentId && from.headingSegmentId) into.headingSegmentId = from.headingSegmentId;
      const remaining = nodes.filter((n) => n !== from);
      return { nodes: renumber(remaining), segments };
    }
    case 'split': {
      const own = segmentsOf(segments, node.id);
      const at = own.findIndex((s) => s.id === op.segmentId);
      if (at <= 0) throw new StructureError('INVALID', 'split point must be inside the node, after its first segment');
      const head = own.slice(0, at);
      const tail = own.slice(at);
      const first = tail[0] as SegmentRecord;
      for (const n of nodes) if (n.parentId === node.parentId && n.ord > node.ord) n.ord += 1;
      const created: TocNodeRecord = {
        id: op.newNodeId,
        bookId: node.bookId,
        parentId: node.parentId,
        ord: node.ord + 1,
        depth: node.depth,
        kind: node.kind === 'chapter_intro' ? 'section' : node.kind,
        pageStart: first.page,
        pageEnd: node.pageEnd,
        skip: node.skip,
        origin: 'manual',
        ...(first.type === 'heading' ? { headingSegmentId: first.id } : { title: first.src.slice(0, 60) }),
      };
      node.pageEnd = head.at(-1)?.pageEnd ?? node.pageEnd;
      segments = reorderSegments(segments, node.id, head);
      segments = reorderSegments(segments, created.id, tail);
      return { nodes: renumber([...nodes, created]), segments };
    }
  }
}
