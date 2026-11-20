import { useQuery } from '@tanstack/react-query';

import type { LedgerClient } from '@/client/ledger';
import type { Balance } from '@/contract/schemas';

export type Agreement =
  | { state: 'loading' }
  | { state: 'error'; error: Error }
  | { state: 'unchecked'; cached: Balance; checking: boolean }
  | { state: 'agreed'; cached: Balance; authoritative: Balance }
  /** difference = cached - authoritative. Positive: the cache claims more money than the entries add up to. */
  | { state: 'differs'; cached: Balance; authoritative: Balance; difference: bigint };

interface Options {
  client: LedgerClient;
  accountId: string;
  /** the recompute is a scan of every entry, so it only runs when asked */
  checkAuthoritative: boolean;
}

export function useBalancePair({ client, accountId, checkAuthoritative }: Options): Agreement {
  const cached = useQuery({
    queryKey: ['balance', accountId, 'cached'],
    queryFn: () => client.balance(accountId, false),
    refetchInterval: 5_000,
  });

  const authoritative = useQuery({
    queryKey: ['balance', accountId, 'authoritative'],
    queryFn: () => client.balance(accountId, true),
    enabled: checkAuthoritative,
    // no timer, it's a full scan
    refetchInterval: false,
    staleTime: 30_000,
  });

  if (cached.error) return { state: 'error', error: cached.error };
  if (!cached.data) return { state: 'loading' };

  if (!checkAuthoritative || !authoritative.data) {
    return { state: 'unchecked', cached: cached.data, checking: authoritative.isFetching };
  }

  return compare(cached.data, authoritative.data);
}

export function compare(cached: Balance, authoritative: Balance): Agreement {
  const same =
    cached.balance === authoritative.balance &&
    cached.debits === authoritative.debits &&
    cached.credits === authoritative.credits;

  if (same) return { state: 'agreed', cached, authoritative };

  return {
    state: 'differs',
    cached,
    authoritative,
    difference: cached.balance - authoritative.balance,
  };
}
