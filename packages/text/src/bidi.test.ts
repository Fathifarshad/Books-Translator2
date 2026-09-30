import { describe, expect, it } from 'vitest';
import { firstStrongDir, hasRtl, isolate } from './bidi';
import { dirOf, getLanguage, isKnownLanguage } from './languages';

describe('bidi helpers', () => {
  it('detects the first strong direction', () => {
    expect(firstStrongDir('«سلام» world')).toBe('rtl');
    expect(firstStrongDir('123 What is it?')).toBe('ltr');
    expect(firstStrongDir('123 ...', 'rtl')).toBe('rtl');
  });

  it('detects RTL characters', () => {
    expect(hasRtl('abc')).toBe(false);
    expect(hasRtl('abc فارسی')).toBe(true);
  });

  it('wraps plain-text runs in FSI/PDI isolates', () => {
    expect(isolate('What Is It?')).toBe('\u2068What Is It?\u2069');
  });
});

describe('language registry', () => {
  it('knows directions without hard-coding in callers', () => {
    expect(dirOf('fa')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(isKnownLanguage('de')).toBe(false);
    expect(getLanguage('de').dir).toBe('ltr');
  });
});
