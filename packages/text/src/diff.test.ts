import { describe, expect, it } from 'vitest';
import { diffWords } from './diff';

describe('diffWords', () => {
  it('returns equal/insert/delete runs', () => {
    expect(diffWords('این روش توسط پژوهشگران ارائه شد', 'پژوهشگران این روش را ارائه کردند')).toEqual([
      { type: 'insert', text: 'پژوهشگران ' },
      { type: 'equal', text: 'این روش ' },
      { type: 'delete', text: 'توسط پژوهشگران' },
      { type: 'insert', text: 'را' },
      { type: 'equal', text: ' ارائه ' },
      { type: 'delete', text: 'شد' },
      { type: 'insert', text: 'کردند' },
    ]);
  });

  it('handles identical and empty input', () => {
    expect(diffWords('a b', 'a b')).toEqual([{ type: 'equal', text: 'a b' }]);
    expect(diffWords('', 'x')).toEqual([{ type: 'insert', text: 'x' }]);
  });
});
