/** pnpm db:seed — inserts the original sample book (idempotent). */
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { loadEnvFiles, readConfig } from '../config';
import { openDb } from '../db/client';
import { ensureLocalUser, seedBundle } from '../db/repo';

loadEnvFiles();
const config = readConfig();
const db = openDb(config.dataDir);
const owner = ensureLocalUser(db);
console.log(seedBundle(db, sampleBook, owner) ? 'sample book seeded' : 'sample book already present');
db.$client.close();
