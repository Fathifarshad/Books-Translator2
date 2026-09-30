import { gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import type { BookEvent, EventBus } from '../events';

/** Notifier for processes other than the API (the agent CLI): events go through the `notifications` table. */
export function dbNotifier(db: Db): (bookId: string, event: BookEvent) => void {
  return (bookId, event) => {
    db.insert(notifications)
      .values({ bookId, event: event as unknown as Record<string, unknown> })
      .run();
  };
}

/**
 * Forwards events written by other processes to SSE subscribers (SPEC §10.3-7: the running app reflects imported
 * results within ~3 s). Polls once a second; old rows are purged.
 */
export class NotificationPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastId = 0;
  private ticks = 0;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly onChange?: (bookIds: Set<string>) => void,
  ) {}

  start(intervalMs = 1000): void {
    const row = this.db.$client.prepare('SELECT MAX(id) AS id FROM notifications').get() as { id: number | null };
    this.lastId = row.id ?? 0;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  tick(): void {
    const rows = this.db.select().from(notifications).where(gt(notifications.id, this.lastId)).limit(500).all();
    const books = new Set<string>();
    for (const r of rows) {
      this.lastId = Math.max(this.lastId, r.id);
      this.bus.publish(r.bookId, r.event as unknown as BookEvent);
      books.add(r.bookId);
    }
    if (books.size && this.onChange) this.onChange(books);
    if (++this.ticks % 600 === 0) {
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      this.db.delete(notifications).where(lt(notifications.createdAt, dayAgo)).run();
    }
  }
}
