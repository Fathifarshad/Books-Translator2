import { dirOf, localizeDigits } from '@dozabaneh/text';
import type { ReactNode } from 'react';

interface LangTextProps {
  lang: string;
  children: string;
  className?: string;
  /** Localize digits to the run's own numbering system (English runs keep Latin digits). */
  digits?: boolean;
}

/**
 * An isolated run of text in one content language: `<bdi lang dir>` so neutral characters at its edges
 * (a final «?», «.», «)» or «:») stay inside the run. Fixes prototype bugs §4.2-1 and §4.2-7.
 */
export function LangText({ lang, children, className, digits = true }: LangTextProps) {
  return (
    <bdi lang={lang} dir={dirOf(lang)} className={className}>
      {digits ? localizeDigits(children, lang) : children}
    </bdi>
  );
}

/** Isolates arbitrary content whose direction is not known in advance. */
export function Isolate({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}
