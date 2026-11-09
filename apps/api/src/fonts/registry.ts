import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { CoverFont } from '@dozabaneh/shared';
import * as fontkit from 'fontkit';

const require = createRequire(import.meta.url);

/**
 * Typefaces for book covers (ADR-048): a shelf of free (OFL) Persian faces shipped with the app, so a design opens
 * the same on any computer, and the Persian faces installed on this computer (B Titr, IranNastaliq, …). Only files
 * this registry found can be served — a font is asked for by id and file name, never by path.
 */
export interface FontFace {
  /** File name the browser asks for (unique within the font). */
  name: string;
  file: string;
  /** CSS `font-weight`: one weight, or a range for a variable face. */
  weight: string;
  format: 'woff2' | 'truetype' | 'opentype';
  unicodeRange?: string;
}

export interface FontEntry extends CoverFont {
  faces: FontFace[];
}

interface BundledSpec {
  id: string;
  pkg: string;
  family: string;
  category: CoverFont['category'];
  weights: number[];
  /** CSS files of the package to read the faces from. */
  css: string[];
}

const VAR = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const MID = [400, 500, 600, 700];

export const BUNDLED: BundledSpec[] = [
  {
    id: 'vazirmatn',
    pkg: '@fontsource-variable/vazirmatn',
    family: 'Vazirmatn',
    category: 'sans',
    weights: VAR,
    css: ['index.css'],
  },
  {
    id: 'estedad',
    pkg: '@fontsource-variable/estedad',
    family: 'Estedad',
    category: 'sans',
    weights: VAR,
    css: ['index.css'],
  },
  {
    id: 'noto-kufi',
    pkg: '@fontsource-variable/noto-kufi-arabic',
    family: 'Noto Kufi Arabic',
    category: 'sans',
    weights: VAR,
    css: ['index.css'],
  },
  {
    id: 'noto-naskh',
    pkg: '@fontsource/noto-naskh-arabic',
    family: 'Noto Naskh Arabic',
    category: 'serif',
    weights: MID,
    css: MID.map((w) => `${w}.css`),
  },
  {
    id: 'markazi',
    pkg: '@fontsource-variable/markazi-text',
    family: 'Markazi Text',
    category: 'serif',
    weights: MID,
    css: ['index.css'],
  },
  {
    id: 'amiri',
    pkg: '@fontsource/amiri',
    family: 'Amiri',
    category: 'serif',
    weights: [400, 700],
    css: ['400.css', '700.css'],
  },
  {
    id: 'nastaliq',
    pkg: '@fontsource/noto-nastaliq-urdu',
    family: 'Noto Nastaliq Urdu',
    category: 'nastaliq',
    weights: MID,
    css: MID.map((w) => `${w}.css`),
  },
  {
    id: 'lalezar',
    pkg: '@fontsource/lalezar',
    family: 'Lalezar',
    category: 'display',
    weights: [400],
    css: ['400.css'],
  },
  {
    id: 'reem-kufi',
    pkg: '@fontsource-variable/reem-kufi',
    family: 'Reem Kufi',
    category: 'display',
    weights: MID,
    css: ['index.css'],
  },
  {
    id: 'el-messiri',
    pkg: '@fontsource-variable/el-messiri',
    family: 'El Messiri',
    category: 'display',
    weights: MID,
    css: ['index.css'],
  },
  {
    id: 'aref-ruqaa',
    pkg: '@fontsource/aref-ruqaa',
    family: 'Aref Ruqaa',
    category: 'display',
    weights: [400, 700],
    css: ['400.css', '700.css'],
  },
];

/** Subsets a Persian cover needs: Arabic script (with Persian letters and digits) and Latin for original titles. */
const SUBSETS = /-(arabic|latin|latin-ext)-/;

/** The faces of a fontsource package, from its own CSS (file and unicode-range per subset). */
function bundledFaces(spec: BundledSpec): FontFace[] {
  let dir: string;
  try {
    dir = dirname(require.resolve(`${spec.pkg}/package.json`));
  } catch {
    return [];
  }
  const faces: FontFace[] = [];
  for (const css of spec.css) {
    const path = join(dir, css);
    if (!existsSync(path)) continue;
    for (const block of readFileSync(path, 'utf8').matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const body = block[1] ?? '';
      const url = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(body)?.[1];
      if (!url || !SUBSETS.test(url) || /italic/.test(url)) continue;
      const weight = /font-weight:\s*([0-9 ]+);/.exec(body)?.[1]?.trim() ?? '400';
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
      faces.push({
        name: url,
        file: join(dir, 'files', url),
        weight,
        format: 'woff2',
        ...(range ? { unicodeRange: range } : {}),
      });
    }
  }
  return faces;
}

// ── Fonts installed on this computer ───────────────────────────────────────────────────────────────────────────

/** Where the operating system keeps fonts (the user's own folder included). */
export function systemFontDirs(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    return [
      join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'),
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : []),
    ];
  }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.local', 'share', 'fonts'), join(home, '.fonts')];
}

function fontFiles(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4) return out;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (/\.(ttf|otf)$/i.test(name)) out.push(path);
    else if (!name.includes('.')) {
      try {
        if (statSync(path).isDirectory()) fontFiles(path, depth + 1, out);
      } catch {
        // unreadable entry
      }
    }
  }
  return out;
}

/** Letters a face must have to set Persian: پ چ ژ گ, and a yeh (Persian or Arabic). */
const PERSIAN = [0x67e, 0x686, 0x698, 0x6af];
export function setsPersian(font: { hasGlyphForCodePoint(c: number): boolean }): boolean {
  return (
    PERSIAN.every((c) => font.hasGlyphForCodePoint(c)) &&
    (font.hasGlyphForCodePoint(0x6cc) || font.hasGlyphForCodePoint(0x64a))
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function slug(family: string): string {
  return (
    family
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'font'
  );
}

interface Scanned {
  family: string;
  weight: number;
  file: string;
  format: 'truetype' | 'opentype';
}

function readFace(file: string): Scanned | undefined {
  let font: fontkit.Font;
  try {
    const opened = fontkit.openSync(file) as fontkit.Font | fontkit.FontCollection;
    if ('fonts' in opened) return undefined; // collections cannot be served as one face
    font = opened;
  } catch {
    return undefined;
  }
  const sub = font.subfamilyName ?? '';
  if (/italic|oblique/i.test(sub)) return undefined;
  if (!setsPersian(font)) return undefined;
  const preferred = (font as unknown as { getName?: (k: string) => string | null }).getName?.('preferredFamily');
  const family = (preferred || font.familyName || '').trim();
  if (!family) return undefined;
  const os2 = (font as unknown as { 'OS/2'?: { usWeightClass?: number } })['OS/2'];
  let weight = os2?.usWeightClass ?? 400;
  if (/bold/i.test(sub) && weight < 600) weight = 700;
  weight = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return { family, weight, file, format: extname(file).toLowerCase() === '.otf' ? 'opentype' : 'truetype' };
}

function category(family: string): CoverFont['category'] {
  return /nast[ae]?liq/i.test(family) ? 'nastaliq' : 'other';
}

/** Persian faces in the given folders, one font per family, a family the app ships left out. */
export function scanSystemFonts(dirs: string[]): FontEntry[] {
  const shipped = new Set(BUNDLED.map((b) => norm(b.family)));
  const byFamily = new Map<string, Scanned[]>();
  for (const dir of dirs) {
    for (const file of fontFiles(dir)) {
      const face = readFace(file);
      if (!face || shipped.has(norm(face.family))) continue;
      const list = byFamily.get(face.family) ?? [];
      if (!list.some((f) => f.weight === face.weight)) list.push(face);
      byFamily.set(face.family, list);
    }
  }
  const ids = new Set<string>(BUNDLED.map((b) => b.id));
  const out: FontEntry[] = [];
  for (const [family, faces] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
    let id = `sys-${slug(family)}`;
    for (let i = 2; ids.has(id); i++) id = `sys-${slug(family)}-${i}`;
    ids.add(id);
    faces.sort((a, b) => a.weight - b.weight);
    out.push({
      id,
      family,
      source: 'system',
      category: category(family),
      weights: faces.map((f) => f.weight),
      faces: faces.map((f, i) => ({
        name: `${i}-${f.weight}${f.format === 'opentype' ? '.otf' : '.ttf'}`,
        file: f.file,
        weight: String(f.weight),
        format: f.format,
      })),
    });
  }
  return out;
}

// ── The registry ───────────────────────────────────────────────────────────────────────────────────────────────

export class FontRegistry {
  private entries: FontEntry[] | undefined;
  constructor(private readonly dirs: () => string[] = systemFontDirs) {}

  /** Bundled first, then this computer's — read once (a few seconds on a computer with many fonts). */
  all(): FontEntry[] {
    if (!this.entries) {
      const bundled: FontEntry[] = BUNDLED.map((spec) => ({
        id: spec.id,
        family: spec.family,
        source: 'bundled' as const,
        category: spec.category,
        weights: spec.weights,
        faces: bundledFaces(spec),
      })).filter((f) => f.faces.length > 0);
      let system: FontEntry[] = [];
      try {
        system = scanSystemFonts(this.dirs());
      } catch {
        system = [];
      }
      this.entries = [...bundled, ...system];
    }
    return this.entries;
  }

  list(): CoverFont[] {
    return this.all().map(({ faces: _faces, ...font }) => font);
  }

  get(id: string): FontEntry | undefined {
    return this.all().find((f) => f.id === id);
  }

  face(id: string, name: string): FontFace | undefined {
    return this.get(id)?.faces.find((f) => f.name === name);
  }

  /** Drops the list, so fonts installed meanwhile are found on the next request. */
  refresh(): void {
    this.entries = undefined;
  }
}

export { coverFontFamily } from '@dozabaneh/cover';

const MIME: Record<FontFace['format'], string> = { woff2: 'font/woff2', truetype: 'font/ttf', opentype: 'font/otf' };
export const fontMime = (f: FontFace) => MIME[f.format];

/** `@font-face` rules for these fonts; `url` says where each face is loaded from. */
export function fontFaceCss(fonts: FontEntry[], url: (font: FontEntry, face: FontFace) => string): string {
  return fonts
    .flatMap((font) =>
      font.faces.map(
        (face) =>
          `@font-face{font-family:"cv-${font.id}";font-style:normal;font-display:swap;font-weight:${face.weight};src:url("${url(font, face)}") format("${face.format}")${
            face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : ''
          }}`,
      ),
    )
    .join('\n');
}

/** The same rules with the files inside (for the printed book, which must not depend on a server). */
export function embeddedFontCss(fonts: FontEntry[]): string {
  return fontFaceCss(fonts, (_font, face) => {
    try {
      return `data:${fontMime(face)};base64,${readFileSync(face.file).toString('base64')}`;
    } catch {
      return `data:,${encodeURIComponent(basename(face.file))}`;
    }
  });
}
