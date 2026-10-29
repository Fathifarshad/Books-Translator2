import { getLanguage, type MarkupToken, tokenize } from '@dozabaneh/text';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  type IParagraphOptions,
  Packer,
  Paragraph,
  type ParagraphChild,
  TextRun,
} from 'docx';
import { type BookDocument, type DocRow, type ExportMode, rowText } from './document';
import { exportStrings, fill } from './strings';

/**
 * «خروجی ورد»: the finished book as a .docx. Word is where the owner's readers can change the text, print it or
 * save it as a PDF themselves, which is why this format exists next to Markdown.
 *
 * Direction is a property of each paragraph and run (`bidirectional`, `rightToLeft`), taken from the language
 * registry — never from a hard-coded «fa» (golden rule 2). A paragraph in the other language keeps its own
 * direction, so an English quotation inside a Persian book stays readable.
 */
const BODY_FONT = 'Arial';
const CODE_FONT = 'Courier New';

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

/** The book's inline markup as Word runs; a figure or table reference becomes a plain label. */
function runs(tokens: MarkupToken[], rtl: boolean, style: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const text = (value: string, s: RunStyle) => {
    if (!value) return;
    out.push(
      new TextRun({
        text: value,
        rightToLeft: rtl,
        ...(s.bold ? { bold: true } : {}),
        ...(s.italics ? { italics: true } : {}),
        ...(s.code ? { font: CODE_FONT } : {}),
      }),
    );
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        text(token.text, style);
        break;
      case 'em':
        out.push(...runs(token.children, rtl, { ...style, italics: true }));
        break;
      case 'strong':
        out.push(...runs(token.children, rtl, { ...style, bold: true }));
        break;
      case 'code':
        text(token.text, { ...style, code: true });
        break;
      case 'url':
        text(token.url, style);
        break;
      case 'fnref':
        text(`[${token.id}]`, style);
        break;
      case 'ref':
        text(`(${token.kind} ${token.id})`, style);
        break;
      default:
        break;
    }
  }
  return out;
}

function paragraph(text: string, lang: string, extra: IParagraphOptions = {}): Paragraph {
  const rtl = getLanguage(lang).dir === 'rtl';
  return new Paragraph({
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { after: 120 },
    children: runs(tokenize(text), rtl),
    ...extra,
  });
}

const HEADING_BY_DEPTH = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

function rowParagraphs(r: DocRow, text: string, lang: string): Paragraph[] {
  if (!text.trim()) return [];
  switch (r.type) {
    case 'heading':
      return [paragraph(text, lang, { heading: HeadingLevel.HEADING_4, spacing: { before: 200, after: 120 } })];
    case 'list_item':
      return [paragraph(text, lang, { bullet: { level: 0 } })];
    case 'quote':
    case 'caption':
    case 'footnote':
      return [paragraph(text, lang, { indent: { start: 420 } })];
    case 'code':
      return [paragraph(text, lang, { style: undefined })];
    default:
      return [paragraph(text, lang)];
  }
}

export async function toDocx(doc: BookDocument, mode: ExportMode = 'target'): Promise<Buffer> {
  const t = exportStrings();
  const tgt = doc.lang.tgt;
  const children: Paragraph[] = [paragraph(doc.title, tgt, { heading: HeadingLevel.TITLE, spacing: { after: 200 } })];
  if (doc.titleSrc && doc.titleSrc !== doc.title) children.push(paragraph(doc.titleSrc, doc.lang.src));
  if (doc.authors.length) children.push(paragraph(doc.authors.join(' · '), tgt));
  children.push(
    paragraph(
      fill(t.footer, {
        date: new Intl.DateTimeFormat(doc.lang.tgtLocale, { dateStyle: 'medium' }).format(doc.exportedAt),
      }),
      tgt,
      { spacing: { after: 400 } },
    ),
  );

  let chapter: string | undefined;
  for (const section of doc.sections) {
    if (section.chapter && section.chapter !== chapter) {
      chapter = section.chapter;
      children.push(
        paragraph(chapter, tgt, { heading: HEADING_BY_DEPTH[0], pageBreakBefore: true, spacing: { after: 200 } }),
      );
    }
    if (!section.chapter) chapter = undefined;
    const heading = mode === 'source' ? section.titleSrc : section.title;
    if (heading) {
      children.push(
        paragraph(heading, mode === 'source' ? doc.lang.src : tgt, {
          heading: HEADING_BY_DEPTH[Math.min(section.chapter ? 1 : 0, 2)],
          ...(section.chapter ? {} : { pageBreakBefore: children.length > 4 }),
          spacing: { before: 240, after: 140 },
        }),
      );
    }
    for (const r of section.rows) {
      if (mode === 'bilingual') {
        children.push(...rowParagraphs(r, r.tgt, tgt));
        children.push(...rowParagraphs({ ...r, type: 'quote' }, r.src, doc.lang.src));
      } else {
        children.push(...rowParagraphs(r, rowText(r, mode), mode === 'source' ? doc.lang.src : tgt));
      }
    }
  }

  if (doc.glossary.length) {
    children.push(paragraph(t.glossary, tgt, { heading: HEADING_BY_DEPTH[0], pageBreakBefore: true }));
    for (const g of doc.glossary) {
      children.push(
        paragraph(`**${g.src}** — ${g.tgt}${g.definition ? `: ${g.definition}` : ''}`, tgt, {
          bullet: { level: 0 },
        }),
      );
    }
  }

  const file = new Document({
    creator: 'Dozabaneh',
    title: doc.title,
    styles: { default: { document: { run: { font: BODY_FONT, size: 24 } } } },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(file) as Promise<Buffer>;
}
