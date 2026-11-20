import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { LedgerClient } from '@/client/ledger';
import { JournalFeed, type FeedSnapshot } from './feed';

interface Options {
  client: LedgerClient;
  accountId: string;
  pageSize?: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  bufferSize?: number;
  /** off = build the feed but don't start polling (tests drive it by hand) */
  enabled?: boolean;
}

export type Journal = FeedSnapshot & { poll: () => Promise<boolean> };

export function useJournal({
  client,
  accountId,
  pageSize,
  intervalMs,
  maxIntervalMs,
  bufferSize,
  enabled = true,
}: Options): Journal {
  // a new account (or new settings) is a new feed with its own cursor
  const feed = useMemo(
    () =>
      new JournalFeed({
        fetchPage: (after, limit) => client.entries(accountId, { after, limit }),
        pageSize,
        intervalMs,
        maxIntervalMs,
        bufferSize,
      }),
    [client, accountId, pageSize, intervalMs, maxIntervalMs, bufferSize],
  );

  useEffect(() => {
    if (!enabled) return;
    feed.start();
    return () => feed.stop();
  }, [feed, enabled]);

  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot);

  return useMemo(() => ({ ...snapshot, poll: () => feed.poll() }), [snapshot, feed]);
}
