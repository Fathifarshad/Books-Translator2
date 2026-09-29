import { useEffect, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export type Layout = 'desktop' | 'tablet' | 'mobile';

/** Breakpoints from SPEC §11.1: desktop ≥ 1280, tablet 768–1279, mobile < 768. */
export function useLayout(): Layout {
  const desktop = useMediaQuery('(min-width: 1280px)');
  const tablet = useMediaQuery('(min-width: 768px)');
  return desktop ? 'desktop' : tablet ? 'tablet' : 'mobile';
}

/** True when the reader is wide enough for the two aligned text columns. */
export function useTwoColumns(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
