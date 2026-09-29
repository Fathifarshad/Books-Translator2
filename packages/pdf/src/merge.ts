import { endsWithTerminalPunctuation, startsWithListMarker, stripMarkup } from '@dozabaneh/text';
import { type DocStats, dehyphenate } from './blocks';
import type { Block } from './types';

const CONTINUABLE = new Set<Block['type']>(['paragraph', 'list_item', 'quote']);
/** Blocks that may sit between the two halves of a broken paragraph and are skipped over. */
const INTERRUPTING = new Set<Block['type']>(['footnote', 'figure', 'caption']);

function isBreak(a: Block, b: Block): boolean {
  return b.page !== a.pageEnd || b.column !== a.column;
}

/**
 * Continuation across column and page breaks (SPEC §8.4, fixes prototype bug §4.2-6): when a block ends
 * without terminal punctuation (or with a hyphen) and the next body block after a break is not indented,
 * not a heading and not a new list item, the two are merged — list items included.
 */
export function mergeContinuations(blocks: Block[], stats: DocStats): Block[] {
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    const a = out[i] as Block;
    if (!CONTINUABLE.has(a.type)) continue;
    let j = i + 1;
    while (j < out.length && INTERRUPTING.has((out[j] as Block).type)) j++;
    const b = out[j];
    if (!b || !isBreak(a, b)) continue;
    const plainA = stripMarkup(a.text).trimEnd();
    const hyphenEnd = /\p{L}[-‐]$/u.test(plainA);
    if (!hyphenEnd && endsWithTerminalPunctuation(plainA, stats.lang)) continue;
    const typeOk = b.type === 'paragraph' || (b.type === 'quote' && (a.type === 'quote' || a.type === 'list_item'));
    if (!typeOk || Math.abs(a.size - b.size) > 0.6) continue;
    if (startsWithListMarker(stripMarkup(b.text))) continue;
    const hanging = a.type === 'list_item' && a.textX !== undefined && Math.abs(b.x0 - a.textX) < b.size * 1.2;
    if (b.indent > b.size * 0.5 && !hanging && b.type !== 'quote') continue;

    const merged: Block = {
      ...a,
      pageEnd: b.pageEnd,
      lines: [...a.lines, ...b.lines],
      text: joinText(a.text, b.text, stats),
      merged: (a.merged ?? 0) + 1 + (b.merged ?? 0),
      dehyphenated: (a.dehyphenated ?? 0) + (b.dehyphenated ?? 0) + (hyphenEnd ? 1 : 0),
    };
    out[i] = merged;
    out.splice(j, 1);
    i--; // the merged block may continue again on the next page
  }
  return out;
}

function joinText(a: string, b: string, stats: DocStats): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  const m = /(\p{L}+)[-‐]$/u.exec(left);
  const nextWord = right.match(/^[\p{L}\p{M}'’]+/u)?.[0];
  if (m && nextWord) {
    return dehyphenate(m[1] as string, nextWord, stats.words) === 'join' ? left.slice(0, -1) + right : left + right;
  }
  if (/[—–]$/.test(left)) return left + right;
  return `${left} ${right}`;
}
