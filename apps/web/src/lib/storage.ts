import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * localStorage that never throws (private windows, blocked storage). Used only for per-device state;
 * server-side persistence arrives with the API in Phase 2.
 */
const safeStorage: StateStorage = {
  getItem(name) {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Storage full or unavailable: keep working in memory.
    }
  },
  removeItem(name) {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export const persistStorage = createJSONStorage(() => safeStorage);

export const STORAGE_PREFIX = 'dozabaneh:';
