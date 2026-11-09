import { useCallback, useState } from 'react';

/**
 * Undo and redo for the cover editor. A burst of changes with the same key (one drag, one slider moved, one word
 * typed after another) is one step, so «undo» takes back the whole gesture, not one pixel of it.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Key and time of the last change, for merging a burst. */
  lastKey?: string | undefined;
  lastAt: number;
}

const LIMIT = 100;
export const MERGE_MS = 900;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastAt: 0 };
}

export function pushHistory<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (Object.is(next, h.present)) return h;
  const merge = key !== undefined && key === h.lastKey && now - h.lastAt < MERGE_MS;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export function undoHistory<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastAt: 0 };
}

export function redoHistory<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), lastAt: 0 };
}

export function useHistory<T>(initial: T) {
  const [h, setH] = useState(() => startHistory(initial));
  const set = useCallback((next: T | ((prev: T) => T), key?: string) => {
    setH((cur) => pushHistory(cur, typeof next === 'function' ? (next as (p: T) => T)(cur.present) : next, key));
  }, []);
  const undo = useCallback(() => setH(undoHistory), []);
  const redo = useCallback(() => setH(redoHistory), []);
  /** Replaces everything (a design loaded from the server): nothing to undo. */
  const reset = useCallback((value: T) => setH(startHistory(value)), []);
  return {
    value: h.present,
    set,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
