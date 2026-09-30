import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { applyStructureOp, documentOrder, type Structure, StructureError } from './structure-edit';

const base: Structure = { nodes: sampleBook.nodes, segments: sampleBook.segments };
const ids = (s: Structure) => documentOrder(s.nodes).map((n) => n.id.replace('nd_sample_', ''));
const segIds = (s: Structure) => new Set(s.segments.map((x) => x.id));
const node = (s: Structure, key: string) => s.nodes.find((n) => n.id === `nd_sample_${key}`);

describe('structure review operations (SPEC §8.8)', () => {
  it('renames through the heading segment, or the node title when there is none', () => {
    const s = applyStructureOp(base, { op: 'rename', nodeId: 'nd_sample_ch1-speed', title: 'Speed' });
    expect(s.segments.find((x) => x.id === 'sg_sample_ch1-speed_00')?.src).toBe('Speed');
    expect(() => applyStructureOp(base, { op: 'rename', nodeId: 'nd_sample_ch1', title: '  ' })).toThrow(
      StructureError,
    );
  });

  it('skips a whole subtree', () => {
    const s = applyStructureOp(base, { op: 'skip', nodeId: 'nd_sample_ch2', skip: true });
    expect(s.nodes.filter((n) => n.id.startsWith('nd_sample_ch2')).every((n) => n.skip)).toBe(true);
    expect(node(s, 'ch1')?.skip).toBe(false);
  });

  it('demotes under the previous sibling and promotes back without changing order', () => {
    const demoted = applyStructureOp(base, { op: 'demote', nodeId: 'nd_sample_ch1-speed' });
    expect(node(demoted, 'ch1-speed')).toMatchObject({
      parentId: 'nd_sample_ch1-precision',
      depth: 2,
      kind: 'subsection',
    });
    expect(ids(demoted)).toEqual(ids(base));
    const promoted = applyStructureOp(demoted, { op: 'promote', nodeId: 'nd_sample_ch1-speed' });
    expect(node(promoted, 'ch1-speed')).toMatchObject({ parentId: 'nd_sample_ch1', depth: 1, kind: 'section' });
    expect(ids(promoted)).toEqual(ids(base));
  });

  it('promoting a section to the top level makes it a numbered chapter', () => {
    const s = applyStructureOp(base, { op: 'promote', nodeId: 'nd_sample_ch1-speed' });
    expect(node(s, 'ch1-speed')).toMatchObject({ parentId: null, depth: 0, kind: 'chapter', numberLabel: '2' });
    expect(ids(s)).toEqual(ids(base));
  });

  it('merges with the previous node keeping every segment id', () => {
    const s = applyStructureOp(base, { op: 'merge', nodeId: 'nd_sample_ch1-speed', with: 'prev' });
    expect(node(s, 'ch1-speed')).toBeUndefined();
    expect(segIds(s)).toEqual(segIds(base));
    const merged = s.segments.filter((x) => x.nodeId === 'nd_sample_ch1-precision').sort((a, b) => a.ord - b.ord);
    expect(merged.at(-1)?.id).toBe('sg_sample_ch1-speed_07');
    expect(merged.map((x) => x.ord)).toEqual(merged.map((_, i) => i));
  });

  it('splits at a paragraph into a new node after the current one', () => {
    const s = applyStructureOp(base, {
      op: 'split',
      nodeId: 'nd_sample_ch1-speed',
      segmentId: 'sg_sample_ch1-speed_05',
      newNodeId: 'nd_new',
    });
    expect(ids(s)).toContain('nd_new');
    const order = documentOrder(s.nodes).map((n) => n.id);
    expect(order.indexOf('nd_new')).toBe(order.indexOf('nd_sample_ch1-speed') + 1);
    expect(s.segments.filter((x) => x.nodeId === 'nd_new').map((x) => x.id)[0]).toBe('sg_sample_ch1-speed_05');
    expect(segIds(s)).toEqual(segIds(base));
    expect(() =>
      applyStructureOp(base, {
        op: 'split',
        nodeId: 'nd_sample_ch1-speed',
        segmentId: 'sg_sample_ch1-speed_00',
        newNodeId: 'x',
      }),
    ).toThrow(StructureError);
  });

  it('rejects impossible moves', () => {
    expect(() => applyStructureOp(base, { op: 'promote', nodeId: 'nd_sample_ch1' })).toThrow(StructureError);
    expect(() => applyStructureOp(base, { op: 'demote', nodeId: 'nd_sample_preface' })).toThrow(StructureError);
    expect(() => applyStructureOp(base, { op: 'skip', nodeId: 'nope', skip: true })).toThrow(StructureError);
  });
});
