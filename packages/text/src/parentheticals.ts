import { createGlossaryMatcher } from './glossary-match';

/**
 * First-mention parentheticals (SPEC §9.5-5): for glossary entries with policy `first_in_chapter`, only the first
 * occurrence of the equivalent in a chapter carries «(Source Term)» — added when missing, removed from later
 * occurrences. Entries with policy `never` lose such parentheticals everywhere; `always` is left as written.
 * Headings are neither changed nor counted: a chapter's first mention belongs in its running text.
 */
export type ParentheticalPolicy = 'first_in_chapter' | 'always' | 'never';

export interface ParentheticalEntry {
  id: string;
  src: string;
  tgt: string;
  policy: ParentheticalPolicy;
}

export interface ChapterText {
  key: string;
  text: string;
  /** Segment type; `heading` / `h` items are skipped. */
  type?: string;
}

export interface FirstMentionResult {
  items: ChapterText[];
  /** Source terms that received (or already had) their first-mention parenthetical in these items. */
  introduced: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEADINGS = new Set(['heading', 'h']);

/** «(Term)» right after an occurrence, tolerant of case, plural -s/-es and emphasis markers. */
function parentheticalAfter(src: string): RegExp {
  const words = src.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp(`^\\s*\\(\\s*\\*{0,2}(?:${words})(?:s|es)?\\*{0,2}\\s*\\)`, 'iu');
}

export function applyFirstMentions(
  items: ChapterText[],
  entries: ParentheticalEntry[],
  tgtLang: string,
  alreadyIntroduced: string[] = [],
): FirstMentionResult {
  const managed = entries.filter((e) => e.policy !== 'always' && e.tgt.trim() && e.src.trim());
  if (managed.length === 0) return { items, introduced: [] };
  const byId = new Map(managed.map((e) => [e.id, e]));
  const matcher = createGlossaryMatcher(
    managed.map((e) => ({ id: e.id, text: e.tgt })),
    tgtLang,
  );
  const seen = new Set(alreadyIntroduced.map((s) => s.toLowerCase()));
  const introduced: string[] = [];

  const out = items.map((item) => {
    if (HEADINGS.has(item.type ?? '')) return item;
    const edits: { at: number; remove: number; insert: string }[] = [];
    for (const m of matcher.find(item.text)) {
      const entry = byId.get(m.termId);
      if (!entry) continue;
      const paren = parentheticalAfter(entry.src).exec(item.text.slice(m.end));
      const key = entry.src.toLowerCase();
      if (entry.policy === 'never') {
        if (paren) edits.push({ at: m.end, remove: paren[0].length, insert: '' });
        continue;
      }
      if (!seen.has(key)) {
        seen.add(key);
        introduced.push(entry.src);
        if (!paren) edits.push({ at: m.end, remove: 0, insert: ` (${entry.src})` });
      } else if (paren) {
        edits.push({ at: m.end, remove: paren[0].length, insert: '' });
      }
    }
    if (edits.length === 0) return item;
    let text = item.text;
    for (const e of edits.sort((a, b) => b.at - a.at))
      text = text.slice(0, e.at) + e.insert + text.slice(e.at + e.remove);
    return { ...item, text };
  });
  return { items: out, introduced };
}
