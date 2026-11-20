import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Unsupported } from '@/client/ledger';
import type { JournalEntry } from '@/contract/extensions';
import { JournalFeed, type FeedOptions } from './feed';

const ACCOUNT = '6b0b5d2e-1c3a-5f4e-8d9b-2a7c6e5f4d3b';

function entry(id: number): JournalEntry {
  return {
    id,
    transaction_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    account_id: ACCOUNT,
    direction: id % 2 ? 'CREDIT' : 'DEBIT',
    amount: BigInt(id * 100),
    currency: 'EUR',
    posted_at: new Date(1_800_000_000_000 + id * 1000).toISOString(),
  };
}

/** A fake ledger with `total` entries; records the cursor of every request. */
function ledgerWith(total: number) {
  const all = Array.from({ length: total }, (_, i) => entry(i + 1));
  const asked: (number | null)[] = [];

  const fetchPage = vi.fn(async (after: number | null, limit: number) => {
    asked.push(after);
    const page = all.filter((e) => e.id > (after ?? 0)).slice(0, limit);
    return { entries: page, next_cursor: page.at(-1)?.id ?? null };
  });

  return { all, asked, fetchPage, add: (n: number) => all.push(...Array.from({ length: n }, (_, i) => entry(all.length + i + 1))) };
}

function feed(fetchPage: FeedOptions['fetchPage'], options: Partial<FeedOptions> = {}) {
  return new JournalFeed({ fetchPage, intervalMs: 1_000, ...options });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the poller asks only for what it has not seen', () => {
  it('sends no cursor on the first request', async () => {
    const { fetchPage, asked } = ledgerWith(3);

    await feed(fetchPage).poll();

    expect(asked).toEqual([null]);
  });

  it('sends the id of the last entry it received, every time, across ten polls', async () => {
    const ledger = ledgerWith(0);
    const f = feed(ledger.fetchPage, { pageSize: 3 });

    for (let i = 0; i < 10; i += 1) {
      ledger.add(2);
      await f.poll();
    }

    // 2 new entries per poll: cursor goes null, 2, 4, ... 18
    expect(ledger.asked).toEqual([null, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(f.getSnapshot().entries.map((e) => e.id)).toEqual(ledger.all.map((e) => e.id));
  });

  it('never holds the same entry twice', async () => {
    const ledger = ledgerWith(25);
    const f = feed(ledger.fetchPage, { pageSize: 5 });

    f.start();
    await vi.advanceTimersByTimeAsync(5_000);
    f.stop();

    const ids = f.getSnapshot().entries.map((e) => e.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('keeps the cursor where it was when a page comes back empty', async () => {
    const ledger = ledgerWith(2);
    const f = feed(ledger.fetchPage);

    await f.poll();
    await f.poll();
    await f.poll();

    expect(ledger.asked).toEqual([null, 2, 2]);
    expect(f.getSnapshot().cursor).toBe(2);
  });
});

describe('scheduling', () => {
  it('waits the interval between polls when caught up', async () => {
    const ledger = ledgerWith(1);
    const f = feed(ledger.fetchPage, { intervalMs: 1_000 });

    f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ledger.fetchPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(ledger.fetchPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(ledger.fetchPage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(ledger.fetchPage).toHaveBeenCalledTimes(12);
    f.stop();
  });

  it('catches up without waiting while pages come back full', async () => {
    const ledger = ledgerWith(1_000);
    const f = feed(ledger.fetchPage, { pageSize: 100, intervalMs: 1_000 });

    f.start();
    await vi.advanceTimersByTimeAsync(10);
    f.stop();

    expect(f.getSnapshot().entries).toHaveLength(1_000);
  });

  it('never has two requests in flight', async () => {
    let concurrent = 0;
    let peak = 0;
    const slow = vi.fn(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      concurrent -= 1;
      return { entries: [], next_cursor: null };
    });

    const f = feed(slow, { intervalMs: 100 });
    f.start();
    void f.poll();
    void f.poll();
    await vi.advanceTimersByTimeAsync(30_000);
    f.stop();

    expect(peak).toBe(1);
  });

  it('stops for good after stop(), even with a request in flight', async () => {
    const ledger = ledgerWith(1);
    const f = feed(ledger.fetchPage);

    f.start();
    f.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(ledger.fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('the buffer', () => {
  it('keeps the newest entries and counts what it dropped', async () => {
    const ledger = ledgerWith(30);
    const f = feed(ledger.fetchPage, { pageSize: 10, bufferSize: 12 });

    await f.poll();
    await f.poll();
    await f.poll();

    const { entries, discarded } = f.getSnapshot();
    // the last twelve of thirty - checking ids, not just the length, catches
    // a slice that keeps the oldest instead
    expect(entries[0]!.id).toBe(19);
    expect(entries.at(-1)!.id).toBe(30);
    expect(entries).toHaveLength(12);
    expect(discarded).toBe(18);
  });

  it('stays bounded with ten thousand entries pushed through it', async () => {
    const ledger = ledgerWith(10_000);
    const f = feed(ledger.fetchPage, { pageSize: 500, bufferSize: 1_000 });

    for (let i = 0; i < 20; i += 1) await f.poll();

    expect(f.getSnapshot().entries).toHaveLength(1_000);
    expect(f.getSnapshot().discarded).toBe(9_000);
  });
});

describe('backoff', () => {
  it('slows down after a quiet minute and snaps back on the next entry', async () => {
    let now = 0;
    const ledger = ledgerWith(1);
    const f = feed(ledger.fetchPage, { intervalMs: 2_000, maxIntervalMs: 10_000, now: () => now });

    await f.poll();
    now = 61_000;
    await f.poll();

    expect(f.getSnapshot().intervalMs).toBe(10_000);
    expect(f.getSnapshot().status).toBe('idle');

    ledger.add(1);
    await f.poll();

    expect(f.getSnapshot().intervalMs).toBe(2_000);
    expect(f.getSnapshot().status).toBe('live');
  });
});

describe('errors', () => {
  it('reports the error and keeps the entries it had', async () => {
    const ledger = ledgerWith(5);
    let broken = false;
    const f = feed(async (after, limit) => {
      if (broken) throw new Error('ledger unreachable');
      return ledger.fetchPage(after, limit);
    });

    await f.poll();
    broken = true;
    await f.poll();

    expect(f.getSnapshot().status).toBe('error');
    expect(f.getSnapshot().error?.message).toBe('ledger unreachable');
    expect(f.getSnapshot().entries).toHaveLength(5);
  });

  it('keeps retrying after an error', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('down'));
    const f = feed(fetchPage, { intervalMs: 1_000 });

    f.start();
    await vi.advanceTimersByTimeAsync(3_500);
    f.stop();

    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('gives up quietly when the ledger has no entries endpoint', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Unsupported('/v1/accounts/x/entries'));
    const f = feed(fetchPage);

    f.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(f.getSnapshot().status).toBe('unsupported');
  });
});
