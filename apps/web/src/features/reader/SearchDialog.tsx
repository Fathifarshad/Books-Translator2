import { buildSection, type SearchHit, type SearchSide, searchBook } from '@dozabaneh/core';
import { dirOf } from '@dozabaneh/text';
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { fmtNum, languageName } from '../../lib/format';
import { useReaderUi } from '../../stores/reader';
import { useReader } from './context';

/** Search panel (TOC box or Ctrl/⌘+K): both languages, grouped by section, highlighted snippets (SPEC §11.9). */
export function SearchDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId, index, sourceLang, targetLang } = useReader();
  const open = useReaderUi((s) => s.searchOpen);
  const query = useReaderUi((s) => s.searchQuery);
  const set = useReaderUi((s) => s.set);
  const [sides, setSides] = useState<Record<SearchSide, boolean>>({ target: true, source: true });
  const [glossaryOn, setGlossaryOn] = useState(true);
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);

  const results = useMemo(
    () =>
      searchBook(index, deferred, {
        targetLang,
        sides: (Object.keys(sides) as SearchSide[]).filter((s) => sides[s]),
        glossary: glossaryOn,
        limit: 80,
      }),
    [index, deferred, targetLang, sides, glossaryOn],
  );
  const flat = results.groups.flatMap((g) => g.hits.map((h) => ({ nodeId: g.nodeId, hit: h })));

  const go = (nodeId: string, segmentId: string) => {
    set({ searchOpen: false });
    navigate(`/books/${bookId}/read/${nodeId}?seg=${segmentId}`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(flat.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') {
      const item = flat[active];
      if (item) go(item.nodeId, item.hit.segmentId);
    } else return;
    e.preventDefault();
  };

  let position = -1;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => set({ searchOpen: o })}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[8dvh] z-50 mx-auto flex max-h-[80dvh] max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-popover)]"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">{t('search.title')}</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Icon name="search" className="text-muted" />
            <input
              value={query}
              onChange={(e) => {
                set({ searchQuery: e.target.value });
                setActive(0);
              }}
              placeholder={t('search.placeholder')}
              aria-label={t('search.title')}
              dir="auto"
              className="flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted"
              data-testid="search-input"
              // biome-ignore lint/a11y/noAutofocus: search opens on an explicit user action
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
            {(['target', 'source'] as SearchSide[]).map((s) => (
              <Button
                key={s}
                variant="pill"
                className="px-3 py-0.5 text-xs"
                aria-pressed={sides[s]}
                onClick={() => setSides((v) => ({ ...v, [s]: !v[s] }))}
              >
                {languageName(s === 'target' ? targetLang : sourceLang)}
              </Button>
            ))}
            <Button
              variant="pill"
              className="px-3 py-0.5 text-xs"
              aria-pressed={glossaryOn}
              onClick={() => setGlossaryOn((v) => !v)}
            >
              {t('search.filterGlossary')}
            </Button>
            {deferred.trim().length >= 2 ? (
              <span className="ms-auto self-center text-xs text-muted">
                {t('search.results', { n: fmtNum(results.total) })}
              </span>
            ) : null}
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2" data-testid="search-results">
            {deferred.trim().length < 2 ? (
              <p className="p-4 text-sm text-muted">{t('search.hint')}</p>
            ) : results.total === 0 && results.glossary.length === 0 ? (
              <p className="p-4 text-sm text-muted">{t('search.empty')}</p>
            ) : null}

            {results.glossary.length > 0 ? (
              <section className="mb-2">
                <h3 className="px-2 py-1 text-xs font-bold text-muted">{t('search.glossaryHeading')}</h3>
                {results.glossary.map((g) => (
                  <div key={g.termId} className="rounded-lg px-3 py-2 text-sm">
                    <span className="font-bold">{g.tgt}</span>{' '}
                    <LangText lang={sourceLang} className="font-mono text-xs text-muted">
                      {g.src}
                    </LangText>
                    {g.definition ? <p className="text-muted">{g.definition}</p> : null}
                  </div>
                ))}
              </section>
            ) : null}

            {results.groups.map((group) => {
              const section = buildSection(index, group.nodeId, targetLang);
              const title =
                section?.node.kind === 'chapter_intro'
                  ? t('reader.chapterIntro')
                  : (section?.title.tgt ?? section?.title.src ?? '');
              return (
                <section key={group.nodeId} className="mb-2">
                  <h3 className="px-2 py-1 text-xs font-bold text-muted">{title}</h3>
                  {group.hits.map((hit) => {
                    position++;
                    const i = position;
                    return (
                      <button
                        key={`${hit.segmentId}-${hit.side}`}
                        type="button"
                        onClick={() => go(group.nodeId, hit.segmentId)}
                        onMouseEnter={() => setActive(i)}
                        className={`block w-full rounded-lg px-3 py-2 text-start text-sm leading-7 ${active === i ? 'bg-accent-soft' : 'hover:bg-row-hover'}`}
                        data-testid="search-hit"
                      >
                        <Snippet hit={hit} lang={hit.side === 'target' ? targetLang : sourceLang} />
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Snippet({ hit, lang }: { hit: SearchHit; lang: string }) {
  const first = hit.ranges[0];
  if (!first) return null;
  const from = Math.max(0, first.start - 70);
  const to = Math.min(hit.text.length, first.end + 90);
  // `at` (offset in the text) is a stable, unique key for each part.
  const parts: { text: string; mark: boolean; at: number }[] = [];
  let cursor = from;
  for (const r of hit.ranges) {
    if (r.start < from || r.end > to) continue;
    if (r.start > cursor) parts.push({ text: hit.text.slice(cursor, r.start), mark: false, at: cursor });
    parts.push({ text: hit.text.slice(r.start, r.end), mark: true, at: r.start });
    cursor = r.end;
  }
  if (cursor < to) parts.push({ text: hit.text.slice(cursor, to), mark: false, at: cursor });
  return (
    <span lang={lang} dir={dirOf(lang)} className="block">
      {from > 0 ? '…' : ''}
      {parts.map((p) =>
        p.mark ? (
          <mark key={p.at} className="rounded bg-accent-soft px-0.5 text-accent">
            {p.text}
          </mark>
        ) : (
          <span key={p.at}>{p.text}</span>
        ),
      )}
      {to < hit.text.length ? '…' : ''}
    </span>
  );
}
