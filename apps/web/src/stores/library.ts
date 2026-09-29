import type { TranslationRecord, TranslationStatus } from '@dozabaneh/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage, STORAGE_PREFIX } from '../lib/storage';

export interface Revision {
  id: string;
  segmentId: string;
  lang: string;
  before: string;
  after: string;
  actor: 'user' | 'engine';
  reason?: string;
  createdAt: string;
}

export interface ReadingProgress {
  nodeId?: string;
  segmentId?: string;
  readNodeIds: string[];
  updatedAt?: string;
}

export interface Summary {
  markdown: string;
  engine: string;
  createdAt: string;
}

/**
 * Local, per-device library state for Phase 1 (moves to the API in Phase 2):
 * translation overrides (user edits and live pipeline updates), revisions, reading progress, summaries.
 */
interface LibraryState {
  /** bookId → overrides keyed by `${segmentId}|${lang}` */
  overrides: Record<string, Record<string, TranslationRecord>>;
  revisions: Record<string, Revision[]>;
  progress: Record<string, ReadingProgress>;
  /** `${bookId}|${nodeId}|${lang}` → summary */
  summaries: Record<string, Summary>;
  saveEdit: (
    bookId: string,
    base: TranslationRecord | undefined,
    segmentId: string,
    lang: string,
    text: string,
    reason?: string,
  ) => void;
  undoEdit: (bookId: string, segmentId: string, lang: string) => void;
  setStatus: (bookId: string, records: TranslationRecord[]) => void;
  setPosition: (bookId: string, nodeId: string, segmentId?: string) => void;
  markRead: (bookId: string, nodeId: string) => void;
  saveSummary: (key: string, summary: Summary) => void;
}

const key = (segmentId: string, lang: string) => `${segmentId}|${lang}`;
const now = () => new Date().toISOString();
let counter = 0;
const revId = () => `rv_${Date.now().toString(36)}${(counter++).toString(36)}`;

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      overrides: {},
      revisions: {},
      progress: {},
      summaries: {},

      saveEdit: (bookId, base, segmentId, lang, text, reason) => {
        const current = get().overrides[bookId]?.[key(segmentId, lang)] ?? base;
        const before = current?.text ?? '';
        if (before === text) return;
        const record: TranslationRecord = {
          segmentId,
          lang,
          text,
          status: 'user_edited' satisfies TranslationStatus,
          engine: 'user',
          flags: [],
          ...(current?.note ? { note: current.note } : {}),
          version: (current?.version ?? 0) + 1,
          updatedAt: now(),
        };
        const revision: Revision = {
          id: revId(),
          segmentId,
          lang,
          before,
          after: text,
          actor: 'user',
          ...(reason ? { reason } : {}),
          createdAt: now(),
        };
        set((s) => ({
          overrides: { ...s.overrides, [bookId]: { ...s.overrides[bookId], [key(segmentId, lang)]: record } },
          revisions: { ...s.revisions, [bookId]: [...(s.revisions[bookId] ?? []), revision] },
        }));
      },

      undoEdit: (bookId, segmentId, lang) => {
        const revs = get().revisions[bookId] ?? [];
        const last = [...revs].reverse().find((r) => r.segmentId === segmentId && r.lang === lang);
        if (!last) return;
        const remaining = revs.filter((r) => r !== last);
        const stillEdited = remaining.some((r) => r.segmentId === segmentId && r.lang === lang);
        set((s) => {
          const bookOverrides = { ...s.overrides[bookId] };
          const current = bookOverrides[key(segmentId, lang)];
          if (stillEdited && current) {
            bookOverrides[key(segmentId, lang)] = {
              ...current,
              text: last.before,
              version: current.version + 1,
              updatedAt: now(),
            };
          } else {
            delete bookOverrides[key(segmentId, lang)];
          }
          return {
            overrides: { ...s.overrides, [bookId]: bookOverrides },
            revisions: { ...s.revisions, [bookId]: remaining },
          };
        });
      },

      setStatus: (bookId, records) =>
        set((s) => {
          const next = { ...s.overrides[bookId] };
          for (const r of records) {
            // Automation never overwrites a user edit (SPEC §3.6).
            if (next[key(r.segmentId, r.lang)]?.status === 'user_edited') continue;
            next[key(r.segmentId, r.lang)] = r;
          }
          return { overrides: { ...s.overrides, [bookId]: next } };
        }),

      setPosition: (bookId, nodeId, segmentId) =>
        set((s) => {
          const prev = s.progress[bookId] ?? { readNodeIds: [] };
          if (prev.nodeId === nodeId && prev.segmentId === segmentId) return s;
          return {
            progress: {
              ...s.progress,
              [bookId]: { ...prev, nodeId, ...(segmentId ? { segmentId } : {}), updatedAt: now() },
            },
          };
        }),

      markRead: (bookId, nodeId) =>
        set((s) => {
          const prev = s.progress[bookId] ?? { readNodeIds: [] };
          if (prev.readNodeIds.includes(nodeId)) return s;
          return { progress: { ...s.progress, [bookId]: { ...prev, readNodeIds: [...prev.readNodeIds, nodeId] } } };
        }),

      saveSummary: (k, summary) => set((s) => ({ summaries: { ...s.summaries, [k]: summary } })),
    }),
    { name: `${STORAGE_PREFIX}library`, storage: persistStorage, version: 1 },
  ),
);

export function lastRevision(revisions: Revision[] | undefined, segmentId: string, lang: string): Revision | undefined {
  return [...(revisions ?? [])].reverse().find((r) => r.segmentId === segmentId && r.lang === lang);
}
