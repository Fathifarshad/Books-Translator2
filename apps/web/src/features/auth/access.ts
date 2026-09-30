import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Who is using the app: the owner on the computer that runs it, or a reader signed in from another device (a phone
 * through `pnpm share`). Readers can read, download and ask the tutor; the server refuses changes (READ_ONLY), and
 * the UI hides them.
 */
export const accessKey = ['auth', 'me'] as const;

export function useAccess() {
  return useQuery({ queryKey: accessKey, queryFn: api.me, staleTime: 60_000, retry: false });
}

/** 'owner' unless a signed-in remote reader (also while loading or when the server is unreachable). */
export function useRole(): 'owner' | 'reader' {
  return useAccess().data?.role === 'reader' ? 'reader' : 'owner';
}

export const useIsOwner = () => useRole() === 'owner';
