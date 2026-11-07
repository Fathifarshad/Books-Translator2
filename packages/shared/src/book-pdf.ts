import { z } from 'zod';

/**
 * «کتاب PDF» (ADR-046): a finished book typeset as a real PDF on this computer — cover, title page, imprint, a
 * table of contents with page numbers, running heads, page numbers, figures and tables translated in place, and the
 * glossary. These shapes are shared by the page that starts it and the job that builds it.
 */
export const BOOK_PAGE_SIZES = ['a4', 'vaziri', 'roqee'] as const;
export type BookPageSize = (typeof BOOK_PAGE_SIZES)[number];

/** Page sizes in millimetres: A4, «وزیری» (17×24 cm) and «رقعی» (14.5×21 cm). */
export const BOOK_PAGE_MM: Record<BookPageSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  vaziri: { width: 170, height: 240 },
  roqee: { width: 145, height: 210 },
};

/** Body typeface: a book Naskh, or the app's own Vazirmatn. */
export const BOOK_FONTS = ['naskh', 'vazir'] as const;
export type BookFont = (typeof BOOK_FONTS)[number];

export const COVER_SOURCES = ['generated', 'uploaded', 'none'] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

export const COVER_THEMES = ['navy', 'emerald', 'burgundy', 'ivory'] as const;
export type CoverTheme = (typeof COVER_THEMES)[number];

/** Who prepared the book, printed on the cover, the title page and the imprint. */
export const PreparerSchema = z.object({
  role: z.string().trim().max(60).default(''),
  name: z.string().trim().max(120).default(''),
  title: z.string().trim().max(240).default(''),
});
export type Preparer = z.infer<typeof PreparerSchema>;

export const BookPdfOptionsSchema = z.object({
  /** What the pages carry: the translation (or the edited text), or each paragraph followed by its original. */
  mode: z.enum(['target', 'bilingual']).default('target'),
  pageSize: z.enum(BOOK_PAGE_SIZES).default('a4'),
  font: z.enum(BOOK_FONTS).default('naskh'),
  cover: z.enum(COVER_SOURCES).default('generated'),
  theme: z.enum(COVER_THEMES).default('navy'),
  /** On an uploaded cover image, also print the title and the preparer on a band at its foot. */
  coverText: z.boolean().default(true),
  backCover: z.boolean().default(true),
  /** Cut the figures and tables out of the original PDF and set their labels in the target language. */
  figures: z.boolean().default(true),
  preparer: PreparerSchema.default({ role: '', name: '', title: '' }),
});
export type BookPdfOptions = z.infer<typeof BookPdfOptionsSchema>;

export const BookPdfRequestSchema = BookPdfOptionsSchema.extend({ lang: z.string().min(2).max(12).optional() });
export type BookPdfRequest = z.input<typeof BookPdfRequestSchema>;

export const BOOK_PDF_STEPS = ['figures', 'labels', 'layout', 'print'] as const;
export type BookPdfStep = (typeof BOOK_PDF_STEPS)[number];

export interface BookPdfFile {
  bytes: number;
  pages: number;
  builtAt: string;
  /** Figures and tables placed in the book, and how many of them carry translated labels. */
  figures: number;
  translatedFigures: number;
}

export interface BookPdfStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  step?: BookPdfStep;
  done: number;
  total: number;
  /** 0…1 over the whole build. */
  fraction: number;
  /** Error code of the last failed build (BROWSER_NOT_FOUND, SOURCE_PDF_MISSING, …). */
  error?: string;
  message?: string;
  file?: BookPdfFile;
  /** The options of the last build, or the defaults with the preparer last used. */
  options: BookPdfOptions;
  /** An image was uploaded as this book's cover. */
  coverUploaded: boolean;
  /** A browser that can write the PDF was found on this computer. */
  browser: boolean;
  /** The book is edited in its own language: its figures keep their words. */
  editOnly: boolean;
  /** The original PDF is available, so figures can be cut out of it. */
  sourcePdf: boolean;
}
