import type { BookIndex, SectionPayload } from '@dozabaneh/core';
import type { GlossaryTermRecord } from '@dozabaneh/shared';
import type { GlossaryMatcher } from '@dozabaneh/text';
import { createContext, useContext } from 'react';

export interface ReaderContextValue {
  bookId: string;
  index: BookIndex;
  section: SectionPayload;
  sourceLang: string;
  targetLang: string;
  glossary: Map<string, GlossaryTermRecord>;
  matchers: { source: GlossaryMatcher; target: GlossaryMatcher };
  /** Opens the inline translation editor for a segment. */
  editSegment: (segmentId: string | undefined) => void;
  /** False for readers signed in from another device (read-only access). */
  canEdit: boolean;
}

export const ReaderContext = createContext<ReaderContextValue | null>(null);

export function useReader(): ReaderContextValue {
  const ctx = useContext(ReaderContext);
  if (!ctx) throw new Error('useReader outside ReaderContext');
  return ctx;
}
