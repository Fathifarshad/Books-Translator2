import { describe, expect, it } from 'vitest';
import { piecesOf } from './ReadAloud';

describe('«بخوان» pieces', () => {
  it('keeps paragraphs whole and groups them up to the limit', () => {
    expect(piecesOf(['aaaa', 'bbbb', 'cccc'], 9)).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  it('never splits a paragraph longer than the limit', () => {
    expect(piecesOf(['x'.repeat(20), 'y'], 9)).toEqual(['x'.repeat(20), 'y']);
  });

  it('returns nothing for an empty section', () => {
    expect(piecesOf([])).toEqual([]);
  });
});
