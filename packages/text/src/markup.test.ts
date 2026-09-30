import { describe, expect, it } from 'vitest';
import { compareMarkup, markupToHtml, serializeMarkup, stripMarkup, tokenize, tokenSignature } from './markup';

describe('markup tokenizer', () => {
  it('parses emphasis, strong, code, refs and URLs', () => {
    const tokens = tokenize('A *bold* idea, **very** `x = 1` see [^3] and [[fig:1.2]] at https://example.org/a.');
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'em',
      'text',
      'strong',
      'text',
      'code',
      'text',
      'fnref',
      'text',
      'ref',
      'text',
      'url',
      'text',
    ]);
    expect(tokens[11]).toEqual({ type: 'url', url: 'https://example.org/a' });
  });

  it('keeps lone asterisks as text', () => {
    expect(stripMarkup('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(stripMarkup('a* b *c')).toBe('a* b *c');
  });

  it('supports escapes', () => {
    expect(stripMarkup('\\*not emphasis\\*')).toBe('*not emphasis*');
  });

  it('strips markers for plain text', () => {
    expect(stripMarkup('The *step*[^1] in [[fig:2.1]].')).toBe('The step in .');
  });

  it('works for Persian text', () => {
    const tokens = tokenize('*الگوریتم* یعنی دستور کار [^1]');
    expect(tokens[0]).toEqual({ type: 'em', children: [{ type: 'text', text: 'الگوریتم' }] });
    expect(tokenSignature('*الگوریتم* یعنی دستور کار [^1]')).toEqual(['fn:1']);
  });
});

describe('markup validation', () => {
  it('accepts identical token multisets', () => {
    expect(compareMarkup('Run `sort()` [^2] (see [[fig:1.1]])', 'اجرای `sort()` [^2] ([[fig:1.1]])')).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('reports missing and extra tokens', () => {
    expect(compareMarkup('a [^1] `x`', 'الف [^2]')).toEqual({ missing: ['code:x', 'fn:1'], extra: ['fn:2'] });
  });
});

describe('serializeMarkup', () => {
  it.each([
    'Plain text.',
    'An *emphasized* and **strong** word.',
    'Call `run()` and see[^3] in [[fig:2.1]] or [[tab:1]].',
    'Visit https://example.org/a.',
    'Nested **bold *and italic* text**.',
    'A literal \\* star.',
  ])('round-trips %s', (src) => {
    expect(serializeMarkup(tokenize(src))).toBe(src);
  });
});

describe('markupToHtml', () => {
  it('renders emphasis, code, footnote markers, references and links', () => {
    expect(markupToHtml('A *soft* and **bold** `x<y` note[^3] see [[fig:2]] at https://example.org/a.')).toBe(
      'A <em>soft</em> and <strong>bold</strong> <code>x&lt;y</code> note<sup class="fn">3</sup> see Fig. 2 at <a href="https://example.org/a" rel="noopener noreferrer" target="_blank">https://example.org/a</a>.',
    );
  });

  it('escapes everything that comes from the book', () => {
    const html = markupToHtml('<script>alert("x")</script> & *<img onerror=1>*');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <em>&lt;img onerror=1&gt;</em>');
  });

  it('uses the language labels for figure and table references', () => {
    expect(markupToHtml('[[tab:4]]', { fig: 'شکل', tab: 'جدول' })).toBe('جدول 4');
  });
});
