import { describe, expect, it } from 'vitest';
import { compareMarkup, stripMarkup, tokenize, tokenSignature } from './markup';

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
