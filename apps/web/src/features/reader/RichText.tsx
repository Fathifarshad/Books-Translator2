import { getLanguage, localizeDigits, type MarkupToken, tokenize } from '@dozabaneh/text';
import { Popover } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type UnderlineMode, useSettings } from '../../stores/settings';
import { useReader } from './context';

interface RichTextProps {
  text: string;
  lang: string;
  side: 'source' | 'target';
}

/**
 * Renders inline markup (never via innerHTML) and underlines approved glossary terms. Terms are
 * `<button data-term-id>`; a single reader-level popover handles hover/focus/tap (see GlossaryPopover).
 */
export function RichText({ text, lang, side }: RichTextProps) {
  const underline = useSettings((s) => s.underline);
  const { matchers } = useReader();
  const seen = new Set<string>();
  return <>{renderTokens(tokenize(text), { lang, side, underline, matcher: matchers[side], seen })}</>;
}

interface RenderCtx {
  lang: string;
  side: 'source' | 'target';
  underline: UnderlineMode;
  matcher: { find: (t: string) => { start: number; end: number; termId: string }[] };
  seen: Set<string>;
}

function renderTokens(tokens: MarkupToken[], ctx: RenderCtx): ReactNode[] {
  return tokens.map((t, i) => {
    const key = `${t.type}-${i}`;
    switch (t.type) {
      case 'text':
        return <TextWithTerms key={key} text={t.text} ctx={ctx} />;
      case 'em':
        return <em key={key}>{renderTokens(t.children, ctx)}</em>;
      case 'strong':
        return <strong key={key}>{renderTokens(t.children, ctx)}</strong>;
      case 'code':
        return (
          <code key={key} dir="ltr" className="rounded bg-panel px-1 font-mono text-[0.85em]">
            {t.text}
          </code>
        );
      case 'fnref':
        return <FootnoteRef key={key} id={t.id} lang={ctx.lang} />;
      case 'ref': {
        return (
          <span key={key} className="text-accent">
            ({getLanguage(ctx.lang).refLabels[t.kind]} {localizeDigits(t.id, ctx.lang)})
          </span>
        );
      }
      case 'url':
        return (
          <a
            key={key}
            href={t.url}
            dir="ltr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {t.url}
          </a>
        );
      default:
        return null;
    }
  });
}

function TextWithTerms({ text, ctx }: { text: string; ctx: RenderCtx }) {
  if (ctx.underline === 'off') return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of ctx.matcher.find(text)) {
    if (ctx.underline === 'firstPerParagraph' && ctx.seen.has(m.termId)) continue;
    ctx.seen.add(m.termId);
    if (m.start > last) out.push(text.slice(last, m.start));
    out.push(
      <button
        key={`${m.termId}-${m.start}`}
        type="button"
        className="term"
        data-term-id={m.termId}
        aria-haspopup="dialog"
        aria-expanded="false"
      >
        {text.slice(m.start, m.end)}
      </button>,
    );
    last = m.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Footnote marker → superscript button → popover with the note in both languages (SPEC §11.4). */
function FootnoteRef({ id, lang }: { id: string; lang: string }) {
  const { t } = useTranslation();
  const { index, targetLang, sourceLang } = useReader();
  const seg = [...index.segmentById.values()].find((s) => s.type === 'footnote' && s.meta.footnoteId === id);
  const tgt = seg ? index.translations.get(`${seg.id}|${targetLang}`) : undefined;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="mx-0.5 align-super text-[0.7em] font-semibold text-accent hover:underline"
          aria-label={t('reader.footnote', { n: localizeDigits(id, 'fa') })}
        >
          {localizeDigits(id, lang)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-sm rounded-xl border border-border bg-surface p-3 text-sm shadow-[var(--shadow-popover)]"
        >
          {tgt ? (
            <p lang={targetLang} dir={getLanguage(targetLang).dir} className="leading-7">
              {tgt.text}
            </p>
          ) : null}
          {seg ? (
            <p
              lang={sourceLang}
              dir={getLanguage(sourceLang).dir}
              className="mt-2 border-t border-border pt-2 text-muted"
            >
              {seg.src}
            </p>
          ) : null}
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
