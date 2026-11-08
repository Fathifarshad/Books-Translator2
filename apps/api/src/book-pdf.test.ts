import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookPdfOptionsSchema } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { buildBookPdf, headingPages } from './export/book/build';
import {
  type BookFigure,
  LABELS_PER_REQUEST,
  LabelCache,
  matchSegments,
  needsTranslation,
  type TranslateTexts,
  translateLabels,
} from './export/book/figures';
import { buildBookHtml, captionBody, headingIds, labelBoxes, labelHtml } from './export/book/html';
import { brokenTitles, layoutBook } from './export/book/layout';
import { findBrowser } from './export/book/print';
import { type BookDocument, bookDocument, type DocSection } from './export/document';
import { bookStrings } from './export/strings';

const options = (o: Record<string, unknown> = {}) =>
  BookPdfOptionsSchema.parse({
    preparer: { role: '', name: 'دکتر فرشاد فتحی', title: 'متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی' },
    ...o,
  });

const row = (id: string, type: string, src: string, tgt: string, page = 0) => ({ id, type, src, tgt, page });
const section = (s: Partial<DocSection> & Pick<DocSection, 'id' | 'title' | 'titleSrc'>): DocSection => ({
  depth: 0,
  rows: [],
  ...s,
});

function doc(sections: DocSection[]): BookDocument {
  return {
    id: 'bk_t',
    title: 'کتاب آزمایشی',
    titleSrc: 'Test Book',
    authors: ['Jane Doe'],
    lang: { src: 'en', tgt: 'fa', srcDir: 'ltr', tgtDir: 'rtl', tgtLocale: 'fa-IR' },
    sections,
    glossary: [{ src: 'transfusion', tgt: 'تزریق خون' }],
    counts: { done: 1, total: 1 },
    exportedAt: new Date('2026-11-07T00:00:00Z'),
  };
}

const figure = (o: Partial<BookFigure> = {}): BookFigure => ({
  id: 'f001',
  kind: 'figure',
  number: '45.7',
  page: 3,
  file: 'f001.png',
  format: 'png',
  width: 400,
  height: 200,
  pixelWidth: 1200,
  pixelHeight: 600,
  mirrored: false,
  textRemoved: true,
  caption: 'Fig. 45.7 Massive transfusion algorithm.',
  labels: [{ text: 'Give 2 units PRBC', x: 20, y: 30, width: 70, height: 10, size: 8, angle: 0, lines: 1 }],
  hidden: ['s_lbl'],
  captionIds: ['s_cap'],
  ...o,
});

/** A chapter whose title ingestion printed in three pieces, a duplicated heading, and a flowchart read as text. */
function messyBook(): BookDocument {
  return doc([
    section({
      id: 'n1',
      kind: 'chapter',
      title: 'خون بیمار',
      titleSrc: 'Patient Blood',
      rows: [row('h1', 'heading', 'Patient Blood', 'خون بیمار')],
    }),
    section({
      id: 'n2',
      kind: 'chapter',
      title: 'مدیریت',
      titleSrc: 'Management:',
      rows: [row('h2', 'heading', 'Management:', 'مدیریت')],
    }),
    section({
      id: 'n3',
      kind: 'chapter_intro',
      title: 'Therapy',
      titleSrc: 'Therapy',
      chapter: 'درمان',
      chapterSrc: 'Therapy',
      chapterId: 'c3',
      chapterDepth: 0,
      depth: 1,
      rows: [
        row('s1', 'paragraph', 'KEY POINTS', 'نکات کلیدی'),
        row(
          's2',
          'paragraph',
          'Transfusion is safer now than at any other time in the',
          'تزریق خون امروز ایمن‌تر از هر زمان دیگری در',
          1,
        ),
        row('s3', 'quote', 'history of medicine.', 'تاریخ پزشکی است.', 1),
        row('s_lbl', 'paragraph', 'Give 2 units PRBC', 'دو واحد بدهید', 3),
        row('s_cap', 'caption', 'Fig. 45.7 Massive transfusion algorithm.', 'شکل ۴۵.۷ — الگوریتم تزریق گسترده.', 3),
        row('s4', 'heading', 'Complications', 'عوارض', 3),
      ],
    }),
    section({
      id: 'n4',
      kind: 'section',
      title: 'عوارض',
      titleSrc: 'Complications',
      chapter: 'درمان',
      chapterSrc: 'Therapy',
      chapterId: 'c3',
      chapterDepth: 0,
      depth: 1,
      rows: [row('s5', 'heading', 'Complications', 'عوارض', 4), row('s6', 'paragraph', 'Text.', 'متن.', 4)],
    }),
  ]);
}

describe('book PDF: layout (ADR-046)', () => {
  it('joins a chapter title printed in pieces and translates it whole', () => {
    const d = messyBook();
    expect(brokenTitles(d)).toEqual(['Patient Blood Management: Therapy']);
    const layout = layoutBook(d, [], {
      mode: 'target',
      titles: new Map([['Patient Blood Management: Therapy', 'مدیریت خون بیمار: درمان']]),
    });
    expect(layout.chapters.map((c) => c.title)).toEqual(['مدیریت خون بیمار: درمان']);
    expect(layout.toc[0]).toMatchObject({ level: 1, text: 'مدیریت خون بیمار: درمان' });
  });

  it('repairs the text: subheadings, joined paragraphs, one heading where ingestion printed two', () => {
    const blocks = layoutBook(messyBook(), [], { mode: 'target' }).chapters[0]?.blocks ?? [];
    expect(blocks[0]).toMatchObject({ kind: 'h', level: 4, text: 'نکات کلیدی' });
    expect(blocks[1]).toMatchObject({ kind: 'p', text: 'تزریق خون امروز ایمن‌تر از هر زمان دیگری در تاریخ پزشکی است.' });
    const headings = blocks.filter((b) => b.kind === 'h' && b.text === 'عوارض');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 2 });
  });

  it('sets a figure where its scattered labels were, with its caption, and lists it', () => {
    const layout = layoutBook(messyBook(), [figure()], { mode: 'target' });
    const blocks = layout.chapters[0]?.blocks ?? [];
    const texts = blocks.map((b) => (b.kind === 'figure' ? 'FIGURE' : b.kind === 'list' ? 'LIST' : b.text));
    expect(texts).not.toContain('دو واحد بدهید');
    expect(texts.indexOf('FIGURE')).toBe(
      texts.indexOf('تزریق خون امروز ایمن‌تر از هر زمان دیگری در تاریخ پزشکی است.') + 1,
    );
    expect(layout.figures[0]?.caption).toBe('شکل ۴۵.۷ — الگوریتم تزریق گسترده.');
  });

  it('keeps a figure whose first own segment is a section title or a piece of a chapter title', () => {
    // «Complications» opens section n4 (printed as its heading); a piece of the broken chapter title is another.
    for (const own of ['s5', 'h2']) {
      const layout = layoutBook(messyBook(), [figure({ hidden: [own], captionIds: [] })], { mode: 'target' });
      const blocks = layout.chapters.flatMap((c) => c.blocks);
      expect(blocks.filter((b) => b.kind === 'figure')).toHaveLength(1);
    }
  });

  it('places a figure no segment matched after the text of its page', () => {
    const layout = layoutBook(messyBook(), [figure({ hidden: [], captionIds: [], page: 1 })], { mode: 'target' });
    const blocks = layout.chapters[0]?.blocks ?? [];
    const at = blocks.findIndex((b) => b.kind === 'figure');
    expect(blocks[at - 1]).toMatchObject({ kind: 'p' });
    expect(layout.figures[0]?.caption).toBe('Fig. 45.7 Massive transfusion algorithm.');
  });
});

describe('book PDF: page (ADR-046)', () => {
  const html = (o = options(), pages?: Map<string, number>) => {
    const d = messyBook();
    const layout = layoutBook(d, [figure()], { mode: o.mode });
    return {
      layout,
      html: buildBookHtml({
        doc: d,
        book: { publisher: 'Elsevier', year: 2025 },
        layout,
        options: o,
        strings: bookStrings(),
        figureSrc: (f) => `figures/${f.file}`,
        editOnly: false,
        pages,
      }),
    };
  };

  it('has a cover with the preparer, a title page, an imprint, contents and the glossary', () => {
    const { html: page } = html();
    expect(page).toContain('class="cover generated"');
    expect(page).toContain('دکتر فرشاد فتحی');
    expect(page).toContain('متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی');
    expect(page).toContain(bookStrings().defaultRole);
    expect(page).toContain('class="front titlepage"');
    expect(page).toContain(bookStrings().imprint);
    expect(page).toContain(bookStrings().toc);
    expect(page).toContain(bookStrings().glossary);
    expect(page).toContain('counter(page, persian)');
    expect(page).toContain('class="cover back"');
  });

  it('numbers the contents with the pages of the first print, in Persian digits', () => {
    const first = html();
    const ids = headingIds(first.html);
    expect(ids).toContain(first.layout.chapters[0]?.id);
    expect(ids).toContain('a-fig-f001');
    const pages = headingPages(
      ids,
      ids.map((_, i) => ({ title: '', page: i + 3 })),
    );
    const { html: second } = html(options(), pages);
    const chapterPage = pages.get(first.layout.chapters[0]?.id ?? '') ?? 0;
    expect(second).toContain(
      `<span class="n">${String(chapterPage).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d)}</span>`,
    );
    expect(second).not.toContain('<span class="n">۰۰۰</span>');
    // A mismatched outline gives no numbers rather than wrong ones.
    expect(headingPages(['a', 'b'], [{ title: '', page: 1 }]).size).toBe(0);
  });

  it('sets translated labels into the figure and mirrors a table', () => {
    const fig = figure({ labels: [{ ...figure().labels[0], tgt: 'دو واحد بدهید' } as BookFigure['labels'][number]] });
    expect(labelBoxes(fig)[0]).toMatchObject({ text: 'دو واحد بدهید', start: false });
    const table = figure({ kind: 'table', mirrored: true });
    const [cell] = labelBoxes(table);
    // x 20…90 of 400 becomes 310…380, and the cell keeps its right edge.
    expect((cell?.left ?? 0) + (cell?.width ?? 0)).toBeCloseTo((381 / 400) * 100, 1);
    expect(cell?.start).toBe(true);
  });

  it('keeps a label inside the room its drawing leaves', () => {
    const room = { x: 10, y: 20, width: 100, height: 30 };
    const [box] = labelBoxes(figure({ labels: [{ ...figure().labels[0], room } as BookFigure['labels'][number]] }));
    expect(box?.left).toBeCloseTo((11 / 400) * 100, 2);
    expect((box?.left ?? 0) + (box?.width ?? 0)).toBeCloseTo((109 / 400) * 100, 2);
  });

  it('puts the owner’s cover image first, with the title band when asked', () => {
    const d = messyBook();
    const layout = layoutBook(d, [], { mode: 'target' });
    const page = buildBookHtml({
      doc: d,
      book: {},
      layout,
      options: options({ cover: 'uploaded', coverText: true }),
      strings: bookStrings(),
      figureSrc: () => '',
      coverImage: 'cover.jpg',
      editOnly: false,
    });
    expect(page).toContain('<section class="cover image"><img src="cover.jpg"');
    expect(page).toContain('class="band"');
  });

  it('never lets book text become markup', () => {
    const d = messyBook();
    d.title = '</title><script>alert(1)</script>';
    const s3 = d.sections[2];
    if (s3?.rows[1]) s3.rows[1].tgt = '<img src=x onerror=alert(2)>';
    const page = buildBookHtml({
      doc: d,
      book: {},
      layout: layoutBook(d, [], { mode: 'target' }),
      options: options(),
      strings: bookStrings(),
      figureSrc: () => '',
      editOnly: false,
    });
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('<img src=x');
  });
});

describe('book PDF: figure labels (ADR-046)', () => {
  it('matches the segments a figure printed as text', () => {
    const segs = [
      { id: 'a', type: 'paragraph', src: 'Give 2 units PRBC', page: 3, pageEnd: 3, bbox: null },
      { id: 'b', type: 'caption', src: 'Fig. 45.7 Massive transfusion algorithm.', page: 3, pageEnd: 3, bbox: null },
      {
        id: 'c',
        type: 'paragraph',
        src: 'Patients who are not hypotensive may tolerate units of blood.',
        page: 3,
        pageEnd: 3,
        bbox: null,
      },
      { id: 'd', type: 'paragraph', src: 'Give 2 units PRBC', page: 4, pageEnd: 4, bbox: null },
    ];
    const f = figure();
    expect(matchSegments({ ...f, box: { x: 0, y: 0, width: 400, height: 200 } }, segs)).toEqual({
      hidden: ['a'],
      captionIds: ['b'],
    });
  });

  it('leaves the page’s own headings and subheadings that only share words with a table', () => {
    const lbl = (text: string) => ({ text, x: 0, y: 0, width: 50, height: 9, size: 8, angle: 0, lines: 1 });
    const table = figure({
      kind: 'table',
      number: '58.1',
      caption: 'Table 58.1 Changes in the Cardiovascular System During Pregnancy',
      labels: [
        'Cardiovascular Parameter',
        'Intravascular fluid volume',
        'Increased 35%–45%',
        'Cardiac output',
        'Increased 40%–50%',
        'Low 2,3-DPG',
        '80',
        // Two boxes say the same (panels A and B).
        'LIKELY LOW RISK TO PROCEED WITH NEURAXIAL',
        'LIKELY LOW RISK TO PROCEED WITH NEURAXIAL',
      ].map(lbl),
    });
    const seg = (id: string, type: string, src: string) => ({ id, type, src, page: 3, pageEnd: 3, bbox: null });
    const segs = [
      seg('h', 'heading', 'Physiologic Changes During Pregnancy and Delivery'),
      seg('cap', 'paragraph', 'Table 58.1 Changes in the Cardiovascular System During Pregnancy'),
      seg('sub', 'paragraph', 'CARDIOVASCULAR CHANGES'),
      seg('iv', 'paragraph', 'Intravascular Volume'),
      seg('row1', 'paragraph', 'Intravascular fluid volume Increased 35%–45%'),
      seg('row2', 'paragraph', 'Cardiac output Increased 40%–50%'),
      seg('co', 'paragraph', 'Cardiac Output'),
      seg('dpg', 'paragraph', '90 Low 2,3-DPG'),
      seg('n', 'paragraph', '80'),
      seg('box', 'heading', 'LIKELY LOW RISK TO PROCEED WITH NEURAXIAL'),
      seg('part', 'paragraph', 'PROCEED WITH NEURAXIAL'),
    ];
    expect(matchSegments({ ...table, box: { x: 0, y: 0, width: 400, height: 200 } }, segs)).toEqual({
      // The flowchart box ingestion read as a heading goes (every word printed), and so does the other box, read in
      // a piece. «Cardiac Output» stays: the table's only «Cardiac output» is the row's.
      hidden: ['row1', 'row2', 'dpg', 'n', 'box', 'part'],
      // Words of the caption in another order are a heading of the text, not a piece of the caption.
      captionIds: ['cap'],
    });
  });

  it('translates words, keeps abbreviations and numbers', () => {
    expect(needsTranslation('Give 2 units PRBC')).toBe(true);
    expect(needsTranslation('YES')).toBe(true);
    expect(needsTranslation('PT, PTT')).toBe(false);
    expect(needsTranslation('1:1,476,000')).toBe(false);
    expect(needsTranslation('HCV')).toBe(false);
    // Capitals and small capitals are words too; so is a short capitalised word.
    expect(needsTranslation('UFH SQ LOW DOSE')).toBe(true);
    expect(needsTranslation('LIKELY LOW RISK TO PROCEED WITH NEURAXIAL')).toBe(true);
    expect(needsTranslation('NEURAXIAL')).toBe(true);
    expect(needsTranslation('No')).toBe(true);
    expect(needsTranslation('aPTT')).toBe(false);
    expect(needsTranslation('FEV1/FVC')).toBe(false);
    expect(needsTranslation('GA, SEH')).toBe(false);
  });

  it('keeps blood groups and markers with a sign left to right inside a Persian label', () => {
    expect(labelHtml('گلبول قرمز متراکم (O+) و Rh−')).toBe(
      'گلبول قرمز متراکم (<bdi dir="ltr">O+</bdi>) و <bdi dir="ltr">Rh−</bdi>',
    );
    expect(labelHtml('HIV-1 و ۲ < ۵')).toBe('HIV-1 و ۲ &lt; ۵');
  });

  it('sets a list inside a cell one item per line, also from the codes of a symbol font', () => {
    expect(labelHtml('موارد زیر: •• دیسترس تنفسی •• افزایش BNP')).toBe(
      'موارد زیر:<span class="li">•\u00a0دیسترس تنفسی</span><span class="li">•\u00a0افزایش BNP</span>',
    );
    expect(labelHtml('موارد زیر: \u0003\u0004 شواهد نارسایی')).toBe(
      'موارد زیر:<span class="li">•\u00a0شواهد نارسایی</span>',
    );
  });

  it('lets a table heading use the width of its column', () => {
    const lbl = (text: string, x: number, y: number, width: number, height = 9) => ({
      text,
      x,
      y,
      width,
      height,
      size: 8,
      angle: 0,
      lines: 1,
    });
    const table = figure({
      kind: 'table',
      mirrored: true,
      width: 252,
      height: 229,
      labels: [
        lbl('TACO', 10, 6, 20),
        lbl('TRALI', 126, 6, 21),
        lbl('New onset …', 10, 20, 105, 134),
        lbl('No evidence …', 126, 20, 116, 143),
      ],
    });
    const [taco] = labelBoxes(table);
    // Mirrored, the column of «TACO» runs from 252 − 10 − 105 = 137 to 242.
    expect(taco?.left).toBeCloseTo((137 / 252) * 100, 1);
  });

  it('sets the figure label itself, without the one in the translated caption', () => {
    expect(captionBody('B شکل ۵۸.۵ — (الف) ابزار تصمیم‌گیری', 'fa')).toBe('(الف) ابزار تصمیم‌گیری');
    expect(captionBody('جدول ۵۸.۲  تغییرات دستگاه تنفس', 'fa')).toBe('تغییرات دستگاه تنفس');
    expect(captionBody('فشردگی آئورت و ورید اجوف', 'fa')).toBe('فشردگی آئورت و ورید اجوف');
  });

  it('asks once per label, several figures per request, and remembers the answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-labels-'));
    try {
      const calls: number[] = [];
      const translate: TranslateTexts = async (items) => {
        calls.push(items.length);
        return new Map(items.map((i) => [i.key, `«${i.src}»`]));
      };
      const label = (text: string) => ({ text, x: 0, y: 0, width: 10, height: 10, size: 8, angle: 0, lines: 1 });
      const many = Array.from({ length: LABELS_PER_REQUEST + 5 }, (_, i) => label(`Label number ${i}`));
      const figs = [
        figure({ id: 'f1', labels: [label('Give blood'), label('NO'), label('1:1,000')] }),
        figure({ id: 'f2', labels: [label('Give blood'), label('Review lab results')] }),
        figure({ id: 'f3', labels: many }),
      ];
      const cache = new LabelCache({ dataDir: dir }, 'bk_t', 'fa');
      const result = await translateLabels(figs, { lang: 'fa', cache, translate, captionOf: () => undefined });
      // «Give blood» is asked once; the first two figures share a request, the big one fills its own.
      expect(calls.reduce((a, b) => a + b, 0)).toBe(3 + LABELS_PER_REQUEST + 5);
      expect(calls).toEqual([3, LABELS_PER_REQUEST, 5]);
      expect(figs[0]?.labels.map((l) => l.tgt)).toEqual(['«Give blood»', '«NO»', '۱:۱,۰۰۰']);
      expect(result).toEqual({ translated: 3, failed: 0 });
      // A second build asks nothing.
      const again = new LabelCache({ dataDir: dir }, 'bk_t', 'fa');
      await translateLabels(figs, { lang: 'fa', cache: again, translate, captionOf: () => undefined });
      expect(calls.length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the printed words of a figure whose request fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-labels-'));
    try {
      const translate: TranslateTexts = async () => {
        throw new Error('provider down');
      };
      const figs = [figure()];
      const result = await translateLabels(figs, {
        lang: 'fa',
        cache: new LabelCache({ dataDir: dir }, 'bk_t', 'fa'),
        translate,
        captionOf: () => undefined,
      });
      expect(result).toEqual({ translated: 0, failed: 1 });
      expect(labelBoxes(figs[0] as BookFigure)[0]?.text).toBe('Give 2 units PRBC');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('book PDF route', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-bookpdf-'));
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports what can be built, then queues a build with the chosen options and remembers the preparer', async () => {
    const app = await appPromise;
    const idle = (await app.inject({ url: '/api/v1/books/bk_sample/book-pdf?lang=fa' })).json();
    expect(idle).toMatchObject({ state: 'idle', coverUploaded: false, editOnly: false, sourcePdf: false });
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/book-pdf',
      payload: { lang: 'fa', theme: 'emerald', preparer: { name: 'دکتر فرشاد فتحی', title: 'متخصص طب اورژانس' } },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ state: 'running', options: { theme: 'emerald' } });
    const job = app.ctx.db.$client
      .prepare(`SELECT stage, target_lang AS lang, scope FROM jobs WHERE stage = 'book_pdf'`)
      .get() as { stage: string; lang: string; scope: string };
    expect(job.lang).toBe('fa');
    expect(JSON.parse(job.scope).options.preparer.name).toBe('دکتر فرشاد فتحی');
    // A second press while it runs starts nothing new.
    await app.inject({ method: 'POST', url: '/api/v1/books/bk_sample/book-pdf', payload: { lang: 'fa' } });
    expect(app.ctx.db.$client.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE stage = 'book_pdf'`).get()).toEqual({
      n: 1,
    });
    expect((await app.inject({ url: '/api/v1/books/nope/book-pdf' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/books/bk_sample/book-pdf/file?lang=fa' })).statusCode).toBe(404);
  });

  it('takes a cover image, refuses anything else, and previews the cover', async () => {
    const app = await appPromise;
    const form = (name: string, type: string, data: Buffer) => {
      const boundary = '----dozabaneh';
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body };
    };
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const fake = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/cover',
      ...form('x.png', 'image/png', Buffer.from('not an image at all')),
    });
    expect(fake.statusCode).toBe(415);
    const pdf = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/cover',
      ...form('x.pdf', 'application/pdf', png),
    });
    expect(pdf.statusCode).toBe(415);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/cover',
      ...form('c.png', 'image/png', png),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().coverUploaded).toBe(true);
    const image = await app.inject({ url: '/api/v1/books/bk_sample/cover' });
    expect(image.headers['content-type']).toBe('image/png');
    const preview = await app.inject({
      url: `/api/v1/books/bk_sample/book-pdf/cover-preview?theme=burgundy&name=${encodeURIComponent('دکتر فرشاد فتحی')}`,
    });
    expect(preview.headers['content-type']).toContain('text/html');
    expect(preview.body).toContain('دکتر فرشاد فتحی');
    expect(preview.body).toContain('#5a1628');
    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/books/bk_sample/cover' });
    expect(removed.json().coverUploaded).toBe(false);
  });
});

describe.skipIf(!findBrowser())('book PDF: a real print', () => {
  it('prints the sample book with a numbered table of contents and an outline', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-print-'));
    const app = await buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
    try {
      const file = await buildBookPdf(
        { db: app.ctx.db, config: { dataDir }, translate: async (items) => new Map(items.map((i) => [i.key, i.src])) },
        { bookId: 'bk_sample', lang: 'fa', options: options() },
      );
      expect(file.pages).toBeGreaterThan(5);
      expect(file.bytes).toBeGreaterThan(10_000);
      const d = bookDocument(sampleBook, 'fa');
      expect(d.sections.length).toBeGreaterThan(0);
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 120_000);
});
