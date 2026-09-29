import { getLanguage } from '@dozabaneh/text';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './fa.json';

/** UI language (separate from content languages, SPEC §14). Persian is the default and only one for now. */
export const UI_LANG = 'fa';

void i18next.use(initReactI18next).init({
  lng: UI_LANG,
  fallbackLng: UI_LANG,
  resources: { fa: { translation: fa } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const uiDir = () => getLanguage(i18next.language || UI_LANG).dir;
export const uiLocale = () => getLanguage(i18next.language || UI_LANG).locale;

export default i18next;
