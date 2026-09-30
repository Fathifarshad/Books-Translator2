export type DiffOp = { type: 'equal' | 'insert' | 'delete'; text: string };

function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/gu) ?? [];
}

/** Word-level diff (LCS) used by the translation editor and the review queue. */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i] as string);
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      push('delete', a[i++] as string);
    } else {
      push('insert', b[j++] as string);
    }
  }
  while (i < n) push('delete', a[i++] as string);
  while (j < m) push('insert', b[j++] as string);
  return ops;
}
