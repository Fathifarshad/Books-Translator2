/** Normalization for title matching: lower-case, letters/digits only, single spaces. */
export function normTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const CHAPTER_PREFIX =
  /^(?:chapter|ch|part|section|appendix)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|[a-z])\s*/i;
const NUMBER_PREFIX = /^(?:\d+(?:\s\d+)*|[ivxlcdm]+)\s+/i;

/** Title without "Chapter 3", "3.2", "IV" prefixes (for matching outline titles with printed headings). */
export function stripNumbering(norm: string): string {
  return norm.replace(CHAPTER_PREFIX, '').replace(NUMBER_PREFIX, '').trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams (0…1). */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

/** Best similarity between an outline/contents title and printed heading text. */
export function titleSimilarity(title: string, heading: string): number {
  const a = normTitle(title);
  const b = normTitle(heading);
  if (!a || !b) return 0;
  const sa = stripNumbering(a);
  const sb = stripNumbering(b);
  return Math.max(dice(a, b), sa && sb ? dice(sa, sb) : 0, sa && sa === sb ? 1 : 0);
}
