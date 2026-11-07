import { buildErrata, createBookIndex, type Errata, type ErrataSource } from '@dozabaneh/core';
import type { BookBundle } from '@dozabaneh/shared';
import { getLanguage, localizeDigits } from '@dozabaneh/text';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { translations } from '../db/schema';
import { errataStrings, fill } from './strings';

/**
 * «فایل سوتی» (ADR-045): the corrections of the edit pass as a list an editor, author or publisher can check —
 * Word (a right-to-left table), CSV for Excel, or Markdown. Built from the database: the text before the edit
 * (`draft`: the original of an edit-only book, the translation draft otherwise), the text now, and the editor's
 * stated reasons.
 */
export type ErrataFormat = 'word' | 'csv' | 'markdown';

/** Statuses whose text is the result of an edit (or of a person's own correction). */
const EDITED: ('final' | 'flagged' | 'user_edited' | 'edited')[] = ['final', 'flagged', 'user_edited', 'edited'];

export function errataSources(db: Db, bundle: BookBundle, lang: string): ErrataSource[] {
  const ids = bundle.segments.map((s) => s.id);
  const src = new Map(bundle.segments.map((s) => [s.id, s.src]));
  const out: ErrataSource[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const found = db
      .select({
        segmentId: translations.segmentId,
        draft: translations.draft,
        final: translations.final,
        changes: translations.changes,
      })
      .from(translations)
      .where(
        and(
          eq(translations.lang, lang),
          inArray(translations.segmentId, ids.slice(i, i + 500)),
          inArray(translations.status, EDITED),
        ),
      )
      .all();
    for (const r of found) {
      const before = r.draft ?? src.get(r.segmentId);
      const after = r.final ?? r.draft;
      if (before == null || after == null) continue;
      out.push({ segmentId: r.segmentId, before, after, changes: r.changes ?? [] });
    }
  }
  return out;
}

export function bookErrata(db: Db, bundle: BookBundle, lang: string): Errata {
  return buildErrata(createBookIndex(bundle), lang, errataSources(db, bundle, lang));
}

interface Row {
  n: string;
  page: string;
  location: string;
  wrong: string;
  right: string;
  type: string;
  reason: string;
  context: string;
}

const COLUMNS: (keyof Row)[] = ['n', 'page', 'location', 'wrong', 'right', 'type', 'reason', 'context'];
/** The printed list leaves the context out: it is for finding a correction in a spreadsheet. */
const PRINTED_COLUMNS = COLUMNS.filter((c) => c !== 'context');

function rows(errata: Errata, lang: string): Row[] {
  const t = errataStrings();
  const digits = (s: string) => localizeDigits(s, lang);
  return errata.entries.map((e) => ({
    n: digits(String(e.n)),
    page: digits(e.page),
    location: [...e.location, e.paragraph ? fill(t.paragraph, { n: digits(String(e.paragraph)) }) : t.heading].join(
      ' › ',
    ),
    wrong: e.before || t.inserted,
    right: e.after || t.deleted,
    type: t.types[e.type] ?? e.type,
    reason: e.reason,
    context: e.context,
  }));
}

/** Book title, totals, the systematic corrections and the date: the lines above the table. */
function intro(errata: Errata, title: string, lang: string, date: Date): string[] {
  const t = errataStrings();
  const digits = (n: number) => localizeDigits(String(n), lang);
  const lines = [
    fill(t.subtitle, { book: title }),
    errata.entries.length
      ? fill(t.summary, { count: digits(errata.entries.length), segments: digits(errata.segments) })
      : t.none,
  ];
  for (const s of errata.systematic) lines.push(fill(t.systematic, { count: digits(s.count) }));
  lines.push(
    fill(t.exported, { date: new Intl.DateTimeFormat(getLanguage(lang).locale, { dateStyle: 'medium' }).format(date) }),
  );
  return lines;
}

/** CSV with a byte-order mark, so Excel opens Persian text as UTF-8. */
export function errataCsv(errata: Errata, lang: string): string {
  const t = errataStrings();
  const cell = (v: string) => (/[",\n\r]/u.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [COLUMNS.map((c) => cell(t.columns[c] ?? c)).join(',')];
  for (const r of rows(errata, lang)) lines.push(COLUMNS.map((c) => cell(r[c])).join(','));
  return `\u{FEFF}${lines.join('\r\n')}\r\n`;
}

export function errataMarkdown(errata: Errata, title: string, lang: string, date = new Date()): string {
  const t = errataStrings();
  const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const out = [`# ${t.title}`, '', ...intro(errata, title, lang, date).map((l) => `${l}  `), ''];
  if (errata.entries.length) {
    out.push(
      `| ${PRINTED_COLUMNS.map((c) => t.columns[c] ?? c).join(' | ')} |`,
      `|${PRINTED_COLUMNS.map(() => '---').join('|')}|`,
    );
    for (const r of rows(errata, lang)) out.push(`| ${PRINTED_COLUMNS.map((c) => cell(r[c])).join(' | ')} |`);
  }
  return `${out.join('\n')}\n`;
}

/** Share of the page width per column of the Word table. */
const WIDTHS: Record<string, number> = { n: 5, page: 6, location: 21, wrong: 17, right: 17, type: 10, reason: 24 };

export async function errataDocx(errata: Errata, title: string, lang: string, date = new Date()): Promise<Buffer> {
  const t = errataStrings();
  const rtl = getLanguage(lang).dir === 'rtl';
  const para = (text: string, bold = false, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 80 },
      ...(heading ? { heading } : {}),
      children: [new TextRun({ text, rightToLeft: rtl, ...(bold ? { bold: true } : {}) })],
    });
  const cell = (text: string, col: string, bold = false) =>
    new TableCell({ width: { size: WIDTHS[col] ?? 10, type: WidthType.PERCENTAGE }, children: [para(text, bold)] });
  const children: (Paragraph | Table)[] = [
    para(t.title, false, HeadingLevel.TITLE),
    ...intro(errata, title, lang, date).map((l) => para(l)),
  ];
  if (errata.entries.length) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: rtl,
        rows: [
          new TableRow({
            tableHeader: true,
            children: PRINTED_COLUMNS.map((c) => cell(t.columns[c] ?? c, c, true)),
          }),
          ...rows(errata, lang).map((r) => new TableRow({ children: PRINTED_COLUMNS.map((c) => cell(r[c], c)) })),
        ],
      }),
    );
  }
  const file = new Document({
    creator: 'Dozabaneh',
    title: t.title,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } }, children }],
  });
  return Packer.toBuffer(file) as Promise<Buffer>;
}
