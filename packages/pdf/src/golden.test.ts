import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { summarize } from './golden';
import { ingestPdf } from './pipeline';

const DIR = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/**
 * Golden tests (SPEC §8.9): each synthetic fixture must produce exactly the reviewed structure JSON.
 * After an intentional change: `UPDATE_GOLDEN=1 pnpm test`, then review the diff of fixtures/pdf/*.expected.json.
 */
describe.each(['outline-book', 'two-column', 'no-outline'])('fixture %s', (name) => {
  it('matches its golden structure', async () => {
    const data = new Uint8Array(readFileSync(`${DIR}${name}.pdf`));
    const actual = summarize(await ingestPdf(data));
    const file = `${DIR}${name}.expected.json`;
    if (UPDATE || !existsSync(file)) writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });
});
