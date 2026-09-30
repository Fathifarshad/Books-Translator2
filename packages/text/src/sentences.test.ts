import { describe, expect, it } from 'vitest';
import { countWords, splitSentences } from './sentences';

describe('sentences', () => {
  it('splits English and Persian sentences', () => {
    expect(splitSentences('One idea. Another one? Yes!', 'en')).toEqual(['One idea.', 'Another one?', 'Yes!']);
    expect(splitSentences('این یک جمله است. آیا این دومی است؟ بله.', 'fa')).toHaveLength(3);
  });

  it('counts words', () => {
    expect(countWords('Thinking in steps, one at a time.', 'en')).toBe(7);
  });
});
