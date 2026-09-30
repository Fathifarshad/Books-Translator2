import { EventEmitter } from 'node:events';

/** Events pushed to open pages over SSE (`GET /books/:id/events`, SPEC §17). */
export type BookEvent =
  | { type: 'progress'; stage: string; done: number; total: number; ocrPages?: number }
  | { type: 'job'; jobId: string; stage: string; status: string; error?: string }
  | { type: 'book'; status: string }
  /** Translations of these segments changed (reader refreshes progressively). */
  | { type: 'segment'; lang: string; ids: string[] }
  /** Pipeline state, counters or log changed (dashboard refresh). */
  | { type: 'pipeline'; lang: string }
  /** Agent batches were created, leased or imported. */
  | { type: 'agent'; pending: number; leased: number }
  | { type: 'glossary'; lang: string };

/** In-process pub/sub per book. (Phase 6 with several API instances swaps this for a shared broker.) */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(bookId: string, event: BookEvent): void {
    this.emitter.emit(bookId, event);
  }

  subscribe(bookId: string, listener: (event: BookEvent) => void): () => void {
    this.emitter.on(bookId, listener);
    return () => this.emitter.off(bookId, listener);
  }
}
