import type { BookBundle } from '../domain';
import { buildBundle } from './builder';
import { SAMPLE_BOOK_ID, sampleBookSpec } from './content';

export { SAMPLE_BOOK_ID };

/** The original sample book as in-memory records (Phase 1 reader data; seeds the DB in Phase 2). */
export const sampleBook: BookBundle = buildBundle(sampleBookSpec);
