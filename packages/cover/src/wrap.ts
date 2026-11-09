/**
 * The printer's wrap (ADR-048, stage 3): front, spine and back as one sheet with bleed. Pure maths, in millimetres:
 * spine width from the page count and the paper, the sheet's size, and an EAN-13 barcode for the ISBN.
 * Paper thicknesses are common estimates per leaf (two pages); the owner can override the value in the editor.
 */
export const PAPERS = {
  /** «تحریر» 70 g */
  tahrir70: { leaf: 0.09, grams: 70 },
  /** «بالک» 80 g — bulky, thicker for its weight */
  bulk80: { leaf: 0.12, grams: 80 },
  /** «گلاسه» 115 g */
  glossy115: { leaf: 0.1, grams: 115 },
} as const;
export type PaperId = keyof typeof PAPERS;
export const DEFAULT_PAPER: PaperId = 'tahrir70';
export const DEFAULT_BLEED_MM = 3;
/** Glue and the cover board's fold, added to the stack of leaves. */
const SPINE_ALLOWANCE_MM = 1;

/** Spine width: pages are printed on both sides of a leaf, so a book of N pages has ⌈N/2⌉ leaves. */
export function spineWidthMm(pages: number, leafMm: number): number {
  if (!(pages > 0) || !(leafMm > 0)) return 0;
  return Math.round((Math.ceil(pages / 2) * leafMm + SPINE_ALLOWANCE_MM) * 10) / 10;
}

export interface WrapLayout {
  /** Whole sheet including bleed. */
  width: number;
  height: number;
  /** Left edge of each panel, from the sheet's left. */
  back: { x: number; width: number };
  spine: { x: number; width: number };
  front: { x: number; width: number };
  bleed: number;
}

/**
 * Panels left to right. A right-to-left book (Persian) opens from the right, so its front cover is the right panel
 * and its back is the left one; a left-to-right book is the other way round.
 */
export function wrapLayout(
  page: { width: number; height: number },
  spine: number,
  bleed: number,
  rtl: boolean,
): WrapLayout {
  const first = { x: bleed, width: page.width };
  const mid = { x: bleed + page.width, width: spine };
  const last = { x: bleed + page.width + spine, width: page.width };
  return {
    width: 2 * page.width + spine + 2 * bleed,
    height: page.height + 2 * bleed,
    back: rtl ? first : last,
    spine: mid,
    front: rtl ? last : first,
    bleed,
  };
}

// ── EAN-13 ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Digits of an ISBN-13 (or EAN-13) typed with hyphens or spaces; null when it is not 12 or 13 digits. */
export function isbnDigits(input: string): string | null {
  const d = input.replace(/[\s-]/g, '');
  return /^\d{12,13}$/.test(d) ? d : null;
}

export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** True for 13 digits whose last digit is the right check digit. */
export function isValidEan13(digits: string): boolean {
  return /^\d{13}$/.test(digits) && ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12]);
}

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 95 modules of an EAN-13 as a string of 0 and 1 (guards included). Throws for a bad check digit. */
export function ean13Modules(digits: string): string {
  if (!isValidEan13(digits)) throw new Error('INVALID_EAN13');
  const parity = PARITY[Number(digits[0])] as string;
  const left = [...digits.slice(1, 7)].map((c, i) => (parity[i] === 'L' ? L : G)[Number(c)]).join('');
  const right = [...digits.slice(7)].map((c) => R[Number(c)]).join('');
  return `101${left}01010${right}101`;
}

/**
 * The barcode as SVG (`widthMm`; 37.29 mm is the nominal width, scalable 80–200 %), digits below in a monospace
 * face. Guard bars run lower than the rest, as printers expect.
 */
export function ean13Svg(digits: string, opts: { widthMm?: number; ink?: string; paper?: string } = {}): string {
  const modules = ean13Modules(digits);
  const w = opts.widthMm ?? 37.29;
  const quiet = 9;
  const total = 95 + 2 * quiet;
  const h = 69;
  const ink = /^#[0-9a-f]{6}$/i.test(opts.ink ?? '') ? (opts.ink as string) : '#000000';
  const paper = /^#[0-9a-f]{6}$/i.test(opts.paper ?? '') ? (opts.paper as string) : '#ffffff';
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  const bars = [...modules]
    .flatMap((m, i) => (m === '1' ? [`<rect x="${quiet + i}" y="4" width="1" height="${guard(i) ? 58 : 52}"/>`] : []))
    .join('');
  const text = (s: string, x: number) =>
    `<text x="${x}" y="66" font-family="monospace" font-size="9" text-anchor="middle">${s}</text>`;
  const height = Math.round(((w * h) / total) * 100) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${w}mm" height="${height}mm" role="img" aria-label="${digits}"><rect width="${total}" height="${h}" fill="${paper}"/><g fill="${ink}">${bars}${text(digits[0] as string, quiet - 4)}${text(digits.slice(1, 7), quiet + 24)}${text(digits.slice(7), quiet + 71)}</g></svg>`;
}
