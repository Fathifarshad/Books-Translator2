import { describe, expect, it } from 'vitest';
import { endsWithTerminalPunctuation, mergeContinuations, suspectedBreaks, type TextBlock } from './continuation';

describe('continuation merging (bug §4.2-6)', () => {
  it('merges a list item continued on the next page', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', text: 'A good recipe does two things:', page: 3 },
      { type: 'list_item', text: '• it names every ingredient before', page: 3 },
      { type: 'paragraph', text: 'the cooking starts, and', page: 4 },
      { type: 'list_item', text: '• it orders the steps.', page: 4 },
    ];
    const merged = mergeContinuations(blocks, 'en');
    expect(merged).toHaveLength(3);
    expect(merged[1]).toMatchObject({
      type: 'list_item',
      text: '• it names every ingredient before the cooking starts, and',
      page: 3,
      pageEnd: 4,
    });
  });

  it('de-hyphenates words split across lines', () => {
    const merged = mergeContinuations(
      [
        { type: 'paragraph', text: 'Every compu-' },
        { type: 'paragraph', text: 'tation has a cost.' },
      ],
      'en',
    );
    expect(merged).toEqual([{ type: 'paragraph', text: 'Every computation has a cost.' }]);
  });

  it('does not merge after terminal punctuation, into headings, or indented paragraphs', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', text: 'First paragraph ends here.' },
      { type: 'paragraph', text: 'Second paragraph' },
      { type: 'heading', text: 'A Heading' },
      { type: 'paragraph', text: 'indented start', indent: 12 },
    ];
    expect(mergeContinuations(blocks, 'en')).toHaveLength(4);
  });

  it('knows terminal punctuation per language', () => {
    expect(endsWithTerminalPunctuation('Why?', 'en')).toBe(true);
    expect(endsWithTerminalPunctuation('چرا؟', 'fa')).toBe(true);
    expect(endsWithTerminalPunctuation('a sentence that', 'en')).toBe(false);
    expect(endsWithTerminalPunctuation('an encoding.[^1]', 'en')).toBe(true);
    expect(endsWithTerminalPunctuation('see the figure [[fig:1.1]]', 'en')).toBe(false);
  });

  it('reports suspected mid-sentence breaks', () => {
    const blocks: TextBlock[] = [
      { type: 'paragraph', text: 'Complete.' },
      { type: 'paragraph', text: 'Broken off in the' },
    ];
    expect(suspectedBreaks(blocks, 'en')).toHaveLength(1);
  });
});
