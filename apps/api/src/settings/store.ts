import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { appSettings } from '../db/schema';

/** Small key → JSON store for application settings (one row per key). */
export function getSetting<T>(db: Db, key: string): T | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value as T | undefined;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const updatedAt = new Date().toISOString();
  db.insert(appSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } })
    .run();
}
