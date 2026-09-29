import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens (and migrates) the SQLite database: WAL so the agent CLI and the API can share it, a busy timeout
 * instead of immediate SQLITE_BUSY errors, and foreign keys on.
 */
export function openDb(dataDir: string, file = 'app.db'): Db {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(file === ':memory:' ? ':memory:' : join(dataDir, file));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

export { schema };
