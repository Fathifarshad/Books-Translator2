import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage, STORAGE_PREFIX } from '../lib/storage';

export type Theme = 'light' | 'sepia' | 'dark' | 'system';
export type UnderlineMode = 'all' | 'firstPerParagraph' | 'off';
export type TocTitleMode = 'target' | 'source' | 'both';
export type LineHeight = 'compact' | 'normal' | 'relaxed';

export const FONT_SIZES = [15, 17, 19, 21] as const;

export interface DisplaySettings {
  theme: Theme;
  /** Index into FONT_SIZES. */
  fontSize: number;
  lineHeight: LineHeight;
  justify: boolean;
  underline: UnderlineMode;
  tocTitles: TocTitleMode;
  showNotes: boolean;
  /** «پیش از ارسال بتوانم سؤال را ویرایش کنم» */
  editBeforeSend: boolean;
}

interface SettingsState extends DisplaySettings {
  set: (patch: Partial<DisplaySettings>) => void;
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  theme: 'light',
  fontSize: 1,
  lineHeight: 'normal',
  justify: false,
  underline: 'firstPerParagraph',
  tocTitles: 'both',
  showNotes: true,
  editBeforeSend: false,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
    }),
    { name: `${STORAGE_PREFIX}settings`, storage: persistStorage, version: 1 },
  ),
);

const LINE_HEIGHTS: Record<LineHeight, { fa: number; en: number }> = {
  compact: { fa: 1.8, en: 1.55 },
  normal: { fa: 2, en: 1.75 },
  relaxed: { fa: 2.25, en: 1.95 },
};

export function readerCssVars(s: DisplaySettings): Record<string, string> {
  const lh = LINE_HEIGHTS[s.lineHeight];
  return {
    '--reader-font-size': `${FONT_SIZES[s.fontSize] ?? 17}px`,
    '--reader-line-height-fa': String(lh.fa),
    '--reader-line-height-en': String(lh.en),
  };
}
