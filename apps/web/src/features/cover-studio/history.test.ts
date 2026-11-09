import { describe, expect, it } from 'vitest';
import { MERGE_MS, pushHistory, redoHistory, startHistory, undoHistory } from './history';

describe('cover editor history', () => {
  it('undoes and redoes', () => {
    let h = startHistory(1);
    h = pushHistory(h, 2, undefined, 0);
    h = pushHistory(h, 3, undefined, 10);
    expect(h.present).toBe(3);
    h = undoHistory(h);
    expect(h.present).toBe(2);
    h = undoHistory(undoHistory(h));
    expect(h.present).toBe(1);
    h = redoHistory(h);
    expect(h.present).toBe(2);
    // A new change drops what could be redone.
    h = pushHistory(h, 9, undefined, 20);
    expect(h.future).toEqual([]);
    expect(redoHistory(h)).toBe(h);
  });

  it('makes one step of a burst with the same key', () => {
    let h = startHistory('a');
    h = pushHistory(h, 'b', 'move:title', 1000);
    h = pushHistory(h, 'c', 'move:title', 1100);
    h = pushHistory(h, 'd', 'move:title', 1200);
    expect(h.past).toEqual(['a']);
    // Another key, or a pause, starts a new step.
    h = pushHistory(h, 'e', 'size:title', 1300);
    h = pushHistory(h, 'f', 'size:title', 1300 + MERGE_MS + 1);
    expect(h.past).toEqual(['a', 'd', 'e']);
    expect(undoHistory(h).present).toBe('e');
  });

  it('ignores a change to the same value', () => {
    const h = startHistory({ x: 1 });
    expect(pushHistory(h, h.present)).toBe(h);
  });
});
