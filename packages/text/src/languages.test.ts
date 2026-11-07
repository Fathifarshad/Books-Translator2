import { describe, expect, it } from 'vitest';
import { bookKinds, DEFAULT_TARGET_LANG, isEditOnly } from './languages';

describe('book kinds (ADR-045)', () => {
  it('treats a book in its own target language as editing, not translation', () => {
    expect(isEditOnly('fa', 'fa')).toBe(true);
    expect(isEditOnly('en', 'fa')).toBe(false);
  });

  it('offers translation from every other language, then editing in the target language', () => {
    const kinds = bookKinds();
    expect(kinds.at(-1)).toEqual({ sourceLang: DEFAULT_TARGET_LANG, targetLang: DEFAULT_TARGET_LANG, editOnly: true });
    expect(kinds.filter((k) => k.editOnly)).toHaveLength(1);
    expect(kinds.every((k) => k.targetLang === DEFAULT_TARGET_LANG)).toBe(true);
    expect(kinds.some((k) => k.sourceLang === 'en' && !k.editOnly)).toBe(true);
  });
});
