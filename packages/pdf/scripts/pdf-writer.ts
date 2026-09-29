import PDFDocument from 'pdfkit';

/**
 * Tiny layout helper for synthetic fixtures (SPEC §8.9): explicit control over line breaks, page breaks,
 * indents, running heads, footnotes and page labels, so each fixture exercises one extraction rule.
 * Inline syntax in text: *italic*, **bold**, `code`, ^1 (superscript footnote marker).
 */
export type FontName = 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Courier' | 'Helvetica' | 'Helvetica-Bold';

interface Token {
  text: string;
  font: FontName;
  sup: boolean;
  /** Attached to the previous token without a space (punctuation after an italic span). */
  glue?: boolean;
}

export interface WriterOptions {
  width: number;
  height: number;
  margin: { top: number; left: number; right: number; bottom: number };
  size?: number;
  leading?: number;
}

export class Writer {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  y: number;
  readonly opts: Required<WriterOptions>;
  /** Per page: running head text (undefined = none) and printed number (undefined = none). */
  readonly heads: (string | undefined)[] = [];
  readonly numbers: (string | undefined)[] = [];

  constructor(opts: WriterOptions) {
    this.opts = { size: 10.5, leading: 14, ...opts };
    this.doc = new PDFDocument({ size: [opts.width, opts.height], margin: 0, bufferPages: true, autoFirstPage: true });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.y = opts.margin.top;
    this.heads.push(undefined);
    this.numbers.push(undefined);
  }

  get page(): number {
    return this.heads.length - 1;
  }

  get left(): number {
    return this.opts.margin.left;
  }

  get textWidth(): number {
    return this.opts.width - this.opts.margin.left - this.opts.margin.right;
  }

  newPage(): void {
    this.doc.addPage({ size: [this.opts.width, this.opts.height], margin: 0 });
    this.y = this.opts.margin.top;
    this.heads.push(undefined);
    this.numbers.push(undefined);
  }

  pageMeta(head: string | undefined, number: string | undefined): void {
    this.heads[this.page] = head;
    this.numbers[this.page] = number;
  }

  gap(points: number): void {
    this.y += points;
  }

  /** A single styled line at the current position (no wrapping). */
  heading(text: string, size: number, font: FontName = 'Times-Bold', after = 8): void {
    this.doc.font(font).fontSize(size).text(text, this.left, this.y, { lineBreak: false });
    this.y += size * 1.3 + after;
  }

  private tokens(text: string, base: FontName): Token[] {
    const out: Token[] = [];
    const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\^(\d+)|([^\s*`^]+)/g;
    for (const m of text.matchAll(re)) {
      const glue = (m.index ?? 0) > 0 && !/\s/.test(text[(m.index ?? 0) - 1] ?? ' ');
      const push = (words: string[], font: FontName) => {
        for (const [i, w] of words.entries())
          out.push({ text: w, font, sup: false, ...(i === 0 && glue ? { glue } : {}) });
      };
      if (m[1]) push(m[1].split(' '), 'Times-Bold');
      else if (m[2]) push(m[2].split(' '), 'Times-Italic');
      else if (m[3]) push(m[3].split(' '), 'Courier');
      else if (m[4]) out.push({ text: m[4], font: base, sup: true });
      else if (m[5]) push([m[5]], base);
    }
    return out;
  }

  private width(t: Token, size: number): number {
    return this.doc
      .font(t.font)
      .fontSize(t.sup ? size * 0.65 : size)
      .widthOfString(t.text);
  }

  /** Greedy word wrap into lines of tokens. */
  wrap(text: string, width: number, base: FontName = 'Times-Roman', size = this.opts.size): Token[][] {
    const lines: Token[][] = [[]];
    let x = 0;
    const space = this.doc.font(base).fontSize(size).widthOfString(' ');
    for (const tok of this.tokens(text, base)) {
      // "compu~tation": a forced hyphenated line break (hyphenation fixtures).
      const parts = tok.text.includes('~') ? tok.text.split('~') : [tok.text];
      const t = { ...tok, text: parts.length > 1 ? `${parts[0]}-` : tok.text };
      const w = this.width(t, size);
      const line = lines[lines.length - 1] as Token[];
      const need = line.length && !t.sup && !t.glue ? space + w : w;
      if (line.length && x + need > width) {
        lines.push([t]);
        x = w;
      } else {
        line.push(t);
        x += need;
      }
      if (parts.length > 1) {
        const rest = { ...tok, text: parts.slice(1).join('') };
        lines.push([rest]);
        x = this.width(rest, size);
      }
    }
    return lines.filter((l) => l.length > 0);
  }

  private drawLine(tokens: Token[], x0: number, size: number): void {
    let x = x0;
    tokens.forEach((t, i) => {
      if (i > 0 && !t.sup && !t.glue) x += this.doc.font('Times-Roman').fontSize(size).widthOfString(' ');
      const s = t.sup ? size * 0.65 : size;
      this.doc
        .font(t.font)
        .fontSize(s)
        .text(t.text, x, t.sup ? this.y - size * 0.3 : this.y, { lineBreak: false });
      x += this.width(t, size);
    });
    this.y += this.opts.leading;
  }

  /** A paragraph; `breakAfter` forces a page break after that many lines (continuation fixtures). */
  para(
    text: string,
    o: {
      indent?: boolean;
      breakAfter?: number;
      font?: FontName;
      size?: number;
      x?: number;
      width?: number;
      after?: number;
    } = {},
  ): void {
    const size = o.size ?? this.opts.size;
    const x = o.x ?? this.left;
    const width = o.width ?? this.textWidth;
    const indent = o.indent ? size * 1.5 : 0;
    const lines = this.wrap(text, width - indent, o.font ?? 'Times-Roman', size);
    lines.forEach((l, i) => {
      if (o.breakAfter !== undefined && i === o.breakAfter) this.newPage();
      this.drawLine(l, x + (i === 0 ? indent : 0), size);
    });
    this.y += o.after ?? 4;
  }

  /** Explicit lines (hyphenation fixtures): every string is one printed line. */
  lines(lines: string[], o: { indentFirst?: boolean; x?: number; font?: FontName; after?: number } = {}): void {
    const size = this.opts.size;
    lines.forEach((l, i) => {
      const toks = this.tokens(l, o.font ?? 'Times-Roman');
      this.drawLine(toks, (o.x ?? this.left) + (i === 0 && o.indentFirst ? size * 1.5 : 0), size);
    });
    this.y += o.after ?? 4;
  }

  /** A list item with a hanging indent; `breakAfter` splits it across a page break. */
  listItem(marker: string, text: string, o: { breakAfter?: number } = {}): void {
    const size = this.opts.size;
    const hang = size * 1.6;
    const lines = this.wrap(text, this.textWidth - hang);
    lines.forEach((l, i) => {
      if (o.breakAfter !== undefined && i === o.breakAfter) this.newPage();
      if (i === 0) this.doc.font('Times-Roman').fontSize(size).text(marker, this.left, this.y, { lineBreak: false });
      this.drawLine(l, this.left + hang, size);
    });
    this.y += 2;
  }

  code(lines: string[], size = 9): void {
    for (const l of lines) {
      const indent = (l.match(/^ */)?.[0].length ?? 0) * size * 0.6;
      this.doc
        .font('Courier')
        .fontSize(size)
        .text(l.trimStart(), this.left + 12 + indent, this.y, { lineBreak: false });
      this.y += size * 1.35;
    }
    this.y += 6;
  }

  /** Footnote text in the small type area at the page bottom. */
  footnote(n: string, text: string, y: number): void {
    const size = 8;
    this.doc
      .moveTo(this.left, y - 4)
      .lineTo(this.left + 60, y - 4)
      .lineWidth(0.4)
      .stroke();
    const lines = this.wrap(text, this.textWidth - 10, 'Times-Roman', size);
    let yy = y;
    lines.forEach((l, i) => {
      if (i === 0) this.doc.font('Times-Roman').fontSize(size).text(n, this.left, yy, { lineBreak: false });
      const saveY = this.y;
      this.y = yy;
      let x = this.left + 10;
      l.forEach((t, k) => {
        if (k > 0) x += this.doc.font('Times-Roman').fontSize(size).widthOfString(' ');
        this.doc.font(t.font).fontSize(size).text(t.text, x, yy, { lineBreak: false });
        x += this.doc.font(t.font).fontSize(size).widthOfString(t.text);
      });
      this.y = saveY;
      yy += size * 1.3;
    });
  }

  /** Draws running heads and page numbers on every page, then page labels. */
  finish(pageLabels?: { start: number; style: 'r' | 'D'; first?: number }[]): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const head = this.heads[i];
      if (head)
        this.doc
          .font('Times-Italic')
          .fontSize(8.5)
          .text(head, this.left, 26, { lineBreak: false, width: this.textWidth, align: 'center' });
      const num = this.numbers[i];
      if (num)
        this.doc
          .font('Times-Roman')
          .fontSize(9)
          .text(num, this.left, this.opts.height - 36, { lineBreak: false, width: this.textWidth, align: 'center' });
    }
    if (pageLabels) {
      const nums: unknown[] = [];
      for (const pl of pageLabels) nums.push(pl.start, { S: pl.style, ...(pl.first ? { St: pl.first } : {}) });
      const ref = this.doc.ref({ Nums: nums });
      ref.end(undefined);
      (this.doc as unknown as { _root: { data: Record<string, unknown> } })._root.data.PageLabels = ref;
    }
    const done = new Promise<Buffer>((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))));
    this.doc.end();
    return done;
  }
}
