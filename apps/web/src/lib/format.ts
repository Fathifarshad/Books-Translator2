import { formatNumber, formatPercent, localizeDigits } from '@dozabaneh/text';
import i18next from 'i18next';
import { uiLocale } from '../i18n';

/** Numbers are formatted with Intl before interpolation into UI strings (SPEC Appendix F). */
export const fmtNum = (n: number) => formatNumber(n, uiLocale());
export const fmtPct = (ratio: number) => formatPercent(ratio, uiLocale());
/** Localizes digits of a label (page labels, figure ids) for the UI language. */
export const uiDigits = (text: string) => localizeDigits(text, i18next.language);

const displayNames = new Map<string, Intl.DisplayNames>();

/** Language names come from Intl.DisplayNames, never hard-coded, so new languages work automatically. */
export function languageName(code: string): string {
  const ui = i18next.language;
  let dn = displayNames.get(ui);
  if (!dn) {
    dn = new Intl.DisplayNames([ui], { type: 'language' });
    displayNames.set(ui, dn);
  }
  return dn.of(code) ?? code;
}
