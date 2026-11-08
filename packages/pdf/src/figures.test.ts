import { createCanvas } from '@napi-rs/canvas';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { openPdf } from './extract';
import { drawnWords, extractFigures, inkOf, renderPage, symbolBullets } from './figure-images';
import {
  captionStart,
  detectFigures,
  type FigurePage,
  figureTokens,
  groupLabels,
  type InkComponent,
  inkComponents,
  joinPieces,
  type TextPiece,
} from './figures';
import { outlinePages } from './outline';

const piece = (text: string, x: number, y: number, size = 8, width = text.length * size * 0.5): TextPiece => ({
  text,
  x,
  y,
  width,
  height: size * 1.1,
  size,
  angle: 0,
});
const ink = (x: number, y: number, width: number, height: number, fill = 0.2): InkComponent => ({
  x,
  y,
  width,
  height,
  fill,
});

/** A page with two columns of 10-point body text, so 8-point labels read as small text. */
function body(): TextPiece[] {
  const lines: TextPiece[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(piece('Body text of the chapter runs across the column here.', 50, 560 + i * 12, 10, 240));
  }
  return lines;
}

describe('figures: geometry (ADR-046)', () => {
  it('finds connected ink, joining strokes that nearly touch', () => {
    const cols = 10;
    const mask = new Uint8Array(cols * 6);
    // A box (cells 1–3 × 1–2) and, one empty cell away, an arrow; and a dot far off.
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [3, 2],
      [5, 2],
      [9, 5],
    ] as const)
      mask[y * cols + x] = 1;
    const comps = inkComponents(mask, cols, 6, 2, 1);
    expect(comps.map((c) => [c.x, c.y, c.width, c.height])).toEqual([
      [2, 2, 6, 4],
      [10, 4, 2, 2],
      [18, 10, 2, 2],
    ]);
    // With a gap of two cells the arrow joins the box.
    expect(inkComponents(mask, cols, 6, 2, 2)).toHaveLength(2);
  });

  it('reads caption words and numbers from the language registry', () => {
    expect(captionStart('Fig. 45.7 This algorithm for diagnosing', 'en')).toEqual({
      kind: 'figure',
      number: '45.7',
      end: 9,
    });
    expect(captionStart('Table 45.1', 'en')).toEqual({ kind: 'table', number: '45.1', end: 10 });
    expect(captionStart('Figure 3-2: Flow', 'en')).toEqual({ kind: 'figure', number: '3-2', end: 10 });
    expect(captionStart('جدول ۴-۱ مقایسه', 'fa')).toEqual({ kind: 'table', number: '4-1', end: 8 });
    expect(captionStart('Tablet computers are common', 'en')).toBeNull();
    expect(captionStart('see Fig. 3', 'en')).toBeNull();
  });

  it('keeps table columns apart and joins the words of one cell', () => {
    const joined = joinPieces([
      piece('Human', 10, 100),
      piece('immunodeficiency', 32, 100),
      piece('1:1,476,000', 120, 100),
    ]);
    expect(joined.map((p) => p.text)).toEqual(['Human immunodeficiency', '1:1,476,000']);
    // A bullet drawn as two glyphs, each read as a bullet, is one.
    expect(joinPieces([piece('•', 10, 100), piece('•', 13, 100), piece('Acute distress', 20, 100)])[0]?.text).toBe(
      '• Acute distress',
    );
  });

  it('groups the stacked lines of one label and positions them in the figure', () => {
    const labels = groupLabels(
      [
        piece('Indication', 100, 200),
        piece('for immediate', 96, 209),
        piece('transfusion', 98, 218),
        piece('NO', 160, 200),
        piece('Leukocyte-', 300, 200),
        piece('poor', 305, 209),
      ],
      { x: 90, y: 190 },
    );
    expect(labels.map((l) => [l.text, l.lines])).toEqual([
      ['Indication for immediate transfusion', 3],
      ['NO', 1],
      ['Leukocyte-poor', 2],
    ]);
    expect(labels[0]).toMatchObject({ x: 6, y: 10 });
  });

  it('claims the flowchart above a figure caption, with its labels', () => {
    const page: FigurePage = {
      index: 4,
      width: 595,
      height: 842,
      pieces: [
        ...body(),
        piece('Blood to lab', 80, 120),
        piece('YES', 90, 200),
        piece('Give 2 units', 80, 260),
        piece('Fig. 12.3 Massive transfusion algorithm.', 60, 322, 8, 200),
      ],
      ink: [ink(0, 0, 595, 40, 1), ink(60, 110, 200, 200)],
    };
    const [region, ...rest] = detectFigures(page, 'en');
    expect(rest).toHaveLength(0);
    expect(region).toMatchObject({ kind: 'figure', number: '12.3', page: 4 });
    expect(region?.caption).toBe('Fig. 12.3 Massive transfusion algorithm.');
    expect(region?.labels.map((l) => l.text)).toEqual(['Blood to lab', 'YES', 'Give 2 units']);
    // The crop stops above the caption and leaves the running head out.
    expect((region?.box.y ?? 0) + (region?.box.height ?? 0)).toBeLessThan(323);
    expect(region?.box.y).toBeGreaterThan(100);
  });

  it('claims the shaded table under a table caption', () => {
    const page: FigurePage = {
      index: 2,
      width: 595,
      height: 842,
      pieces: [
        ...body(),
        piece('Table 45.1 Percentage Risk', 310, 290, 9, 140),
        piece('Infection', 315, 320),
        piece('Risk', 420, 320),
        piece('Hepatitis C virus (HCV)', 315, 340),
        piece('1:1,149,000', 420, 340),
      ],
      ink: [ink(305, 285, 250, 120, 1)],
    };
    const [region] = detectFigures(page, 'en');
    expect(region).toMatchObject({ kind: 'table', number: '45.1' });
    expect(region?.labels.map((l) => l.text)).toEqual(['Infection', 'Risk', 'Hepatitis C virus (HCV)', '1:1,149,000']);
    expect(region?.box.y).toBeGreaterThan(290);
  });

  it('ignores a sentence that only begins like a caption', () => {
    const page: FigurePage = {
      index: 1,
      width: 595,
      height: 842,
      pieces: [...body(), piece('Table 45.18 lists some of the less common risks.', 50, 300, 10, 240)],
      ink: [],
    };
    expect(detectFigures(page, 'en')).toEqual([]);
  });

  it('does not take a body line that opens with a figure reference for a caption', () => {
    // «Fig. 58.3 details …» begins a line of running text right under a shaded box drawn in the other column.
    const page: FigurePage = {
      index: 9,
      width: 595,
      height: 842,
      pieces: [
        ...body(),
        piece('are defined by gestational age of the fetus.', 320, 300, 10, 240),
        piece('Fig. 58.3 details FHR tracing deceleration character-', 320, 312, 10, 240),
        piece('istics. Late decelerations are a result of uteroplacental', 320, 324, 10, 240),
      ],
      ink: [ink(60, 60, 240, 420, 1)],
    };
    expect(detectFigures(page, 'en')).toEqual([]);
    // Alone at the head of a column it is still running text: it goes on in lower case.
    const alone: FigurePage = {
      ...page,
      pieces: [...body(), piece('Fig. 58.3 details FHR tracing deceleration character-', 320, 312, 10, 240)],
    };
    expect(detectFigures(alone, 'en')).toEqual([]);
  });

  it('keeps the next column out of a caption printed on the same line', () => {
    // The left column's body text shares the baseline of the table's title in the right column.
    const page: FigurePage = {
      index: 3,
      width: 595,
      height: 842,
      pieces: [
        ...body(),
        piece('neuraxial or general anesthetic techniques impairs the', 58, 62, 10, 243),
        piece('compensatory increase in vascular resistance and exacer-', 58, 74, 10, 243),
        piece('Table 58.2', 327, 62, 9.5, 46),
        piece('Changes in the Respiratory System at Term', 377, 62, 9.5, 160),
        piece('Pulmonary Parameter', 327, 86),
        piece('Minute ventilation', 327, 102),
        piece('Increased 45%–50%', 450, 102),
      ],
      ink: [ink(320, 58, 245, 70, 1)],
    };
    const [region, ...rest] = detectFigures(page, 'en');
    expect(rest).toHaveLength(0);
    expect(region?.caption).toBe('Table 58.2 Changes in the Respiratory System at Term');
    expect(region?.box.x).toBeGreaterThan(300);
    expect(region?.labels.map((l) => l.text)).toEqual([
      'Pulmonary Parameter',
      'Minute ventilation',
      'Increased 45%–50%',
    ]);
  });

  it('joins small capitals with larger initials into one label, but not a heading with the row under it', () => {
    const labels = groupLabels(
      [
        piece('LIKELY LOW RISK TO', 100, 200, 8),
        piece('PROCEED WITH NEURAXIAL', 96, 209.2, 10.9),
        piece('LUNG VOLUMES', 300, 200),
        piece('Inspiratory reserve volume', 300, 209),
      ],
      { x: 0, y: 0 },
    );
    expect(labels.map((l) => l.text)).toEqual([
      'LIKELY LOW RISK TO PROCEED WITH NEURAXIAL',
      'LUNG VOLUMES',
      'Inspiratory reserve volume',
    ]);
  });

  it('keeps a picture no caption claimed as a figure of its own', () => {
    const page: FigurePage = {
      index: 0,
      width: 595,
      height: 842,
      pieces: body(),
      ink: [ink(100, 100, 300, 200, 1)],
      images: [{ x: 100, y: 100, width: 300, height: 200 }],
    };
    expect(detectFigures(page, 'en')).toMatchObject([{ kind: 'image', box: { x: 100, y: 100 } }]);
  });

  it('turns text into comparable words', () => {
    expect(figureTokens('Hct <30%? ۴۵.۷ Fibrinogen')).toEqual(['hct', '30', '45', '7', 'fibrinogen']);
  });
});

/** A one-page PDF with a flowchart (two boxes, an arrow, labels) and its caption; text in Helvetica. */
function flowchartPdf(): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: [595, 842], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.lineWidth(1).rect(100, 200, 140, 50).fillAndStroke('#dfe8f5', '#3366aa');
    doc.rect(360, 200, 140, 50).fillAndStroke('#dfe8f5', '#3366aa');
    doc.moveTo(240, 225).lineTo(360, 225).stroke('#000');
    doc.fillColor('#000').font('Helvetica').fontSize(8);
    doc.text('Give 2 units PRBC', 120, 222, { lineBreak: false });
    doc.text('Review lab results', 380, 222, { lineBreak: false });
    doc.text('Fig. 7.1 Transfusion steps.', 100, 258, { lineBreak: false });
    doc.fontSize(10);
    for (let i = 0; i < 12; i++)
      doc.text('Body text runs across the page in this synthetic chapter.', 60, 400 + i * 13, { lineBreak: false });
    doc.outline.addItem('Chapter 7');
    doc.end();
  });
}

describe('figures: rendering and cutting out (ADR-046)', () => {
  it('draws a page without its text, leaving the drawing', async () => {
    const task = openPdf(await flowchartPdf());
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const plain = await renderPage(page, 1, false);
    const stripped = await renderPage(page, 1, true);
    expect(stripped.stripped).toBe(true);
    const dark = (c: typeof plain.canvas, x: number, y: number, w: number, h: number) => {
      const { data } = c.getContext('2d').getImageData(x, y, w, h);
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (Math.min(data[i] ?? 255, data[i + 1] ?? 255, data[i + 2] ?? 255) < 236) n++;
      return n;
    };
    // The body text area: ink with text, nothing without it. The box border stays in both.
    expect(dark(plain.canvas, 60, 395, 400, 150)).toBeGreaterThan(0);
    expect(dark(stripped.canvas, 60, 395, 400, 150)).toBe(0);
    expect(dark(stripped.canvas, 98, 198, 145, 55)).toBeGreaterThan(0);
    expect(inkOf(stripped.canvas, 1).some((c) => c.x <= 100 && c.x + c.width >= 500)).toBe(true);
    await task.destroy();
  });

  it('cuts out the flowchart with its labels and leaves the body text alone', async () => {
    const [figure, ...rest] = await extractFigures(await flowchartPdf(), { lang: 'en', pages: [0], scale: 1 });
    expect(rest).toHaveLength(0);
    expect(figure).toMatchObject({ kind: 'figure', number: '7.1', textRemoved: true, mirrored: false, format: 'png' });
    expect(figure?.labels.map((l) => l.text).sort()).toEqual(['Give 2 units PRBC', 'Review lab results']);
    expect(figure?.pixelWidth).toBeGreaterThan(380);
    expect(
      Buffer.from(figure?.image ?? [])
        .subarray(1, 4)
        .toString('latin1'),
    ).toBe('PNG');
  });

  it('reads a printed PDF’s outline with the page of every entry', async () => {
    const { pages, entries } = await outlinePages(await flowchartPdf());
    expect(pages).toBe(1);
    expect(entries).toEqual([{ title: 'Chapter 7', page: 1 }]);
  });
});

describe('figures: words still drawn in the picture (ADR-046)', () => {
  const S = 3;
  const label = (text: string, x: number, y: number, width: number) => ({
    text,
    x,
    y,
    width,
    height: 9,
    size: 8,
    angle: 0,
    lines: 1,
  });

  it('tells letters drawn as outlines from rules, axes and chart marks', () => {
    const canvas = createCanvas(200 * S, 100 * S);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200 * S, 100 * S);
    const rect = (color: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, y * S, w * S, h * S);
    };
    // «Call for skilled» drawn as outlines, then the real word «help» (taken out of this drawing).
    for (const x of [84, 87, 90, 93, 96]) rect('#222222', x, 41.5, 1.5, 6);
    const help = label('help', 100, 40, 16);
    // A label beside a box's side and a coloured legend marker.
    rect('#222222', 95, 50, 0.6, 45);
    rect('#2a7fd4', 84, 72, 6, 4);
    const yes = label('Yes', 100, 70, 14);
    // A label whose words are still in the picture (a scanned figure).
    for (const x of [31, 34, 37, 40, 43]) rect('#111111', x, 11.5, 1.5, 6);
    const scanned = label('Aorta', 30, 10, 18);
    // An axis label beside the axis and a dashed grid line.
    rect('#222222', 165, 20, 0.6, 70);
    for (const x of [166, 172, 178]) rect('#222222', x, 44.2, 4, 0.6);
    const tick = label('100', 150, 40, 12);

    const { drawn, fragments } = drawnWords(canvas as unknown as Parameters<typeof drawnWords>[0], S, {
      kind: 'figure',
      page: 0,
      box: { x: 0, y: 0, width: 200, height: 100 },
      labels: [help, yes, scanned, tick],
    });
    expect([...fragments].map((l) => l.text)).toEqual(['help']);
    expect([...drawn].map((l) => l.text)).toEqual(['Aorta']);
  });
});

describe('figures: bullets of a symbol font (ADR-046)', () => {
  it('reads a run of unmapped symbol codes standing alone as a bullet', () => {
    expect(symbolBullets('within 6 hours: \u0003\u0004 Acute distress \u0003\u0004 Elevated BNP')).toBe(
      'within 6 hours: • Acute distress • Elevated BNP',
    );
    expect(symbolBullets('\u0003\u0004')).toBe('•');
    expect(symbolBullets('\uf0b7 Item')).toBe('• Item');
    // Inside a word it is not a bullet.
    expect(symbolBullets('ab\u0003\u0004cd')).toBe('ab\u0003\u0004cd');
  });
});
