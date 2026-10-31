/**
 * Pause and continue for a recording that is being made. The worker and the routes live in one process, so a plain
 * map is enough: the recording checks it between short pieces and waits while it is set.
 */
const paused = new Set<string>();
const cancelled = new Set<string>();

export const audioKey = (bookId: string, lang: string, kind: string): string => `${bookId}:${lang}:${kind}`;

export const audioControl = {
  isPaused: (key: string): boolean => paused.has(key),
  pause: (key: string): void => void paused.add(key),
  resume: (key: string): void => void paused.delete(key),
  cancel: (key: string): void => void cancelled.add(key),
  isCancelled: (key: string): boolean => cancelled.has(key),
  /** A new recording is not held back by a cancel meant for an earlier one. */
  uncancel: (key: string): void => void cancelled.delete(key),
  /** Everything about a recording is forgotten once it ends. */
  clear: (key: string): void => {
    paused.delete(key);
    cancelled.delete(key);
  },

  /** Resolves when the recording may go on; calls `beat` now and then so a long pause does not lose its lease. */
  async whilePaused(key: string, beat: () => void, signal?: AbortSignal, pollMs = 500): Promise<void> {
    let last = 0;
    while (paused.has(key) && !cancelled.has(key) && !signal?.aborted) {
      if (Date.now() - last > 5_000) {
        last = Date.now();
        beat();
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  },
};
