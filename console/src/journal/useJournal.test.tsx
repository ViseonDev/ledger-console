import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { LedgerClient } from '@/client/ledger';
import { useJournal } from './useJournal';

function clientWith(ids: number[]) {
  const entries = vi.fn(async (accountId: string, { after }: { after?: number | null }) => {
    const page = ids
      .filter((id) => id > (after ?? 0))
      .map((id) => ({
        id,
        transaction_id: '00000000-0000-4000-8000-000000000001',
        account_id: accountId,
        direction: 'CREDIT' as const,
        amount: 100n,
        currency: 'EUR',
        posted_at: '2026-11-20T10:00:00.000Z',
      }));
    return { entries: page, next_cursor: page.at(-1)?.id ?? null };
  });

  return { client: { entries } as unknown as LedgerClient, entries };
}

describe('useJournal', () => {
  it('starts a fresh feed when the account changes', async () => {
    const { client, entries } = clientWith([1, 2, 3]);

    const { result, rerender } = renderHook(
      ({ accountId }) => useJournal({ client, accountId, intervalMs: 60_000 }),
      { initialProps: { accountId: 'a' } },
    );

    await waitFor(() => expect(result.current.entries).toHaveLength(3));

    rerender({ accountId: 'b' });

    expect(result.current.cursor).toBeNull();
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(entries.mock.calls.at(-1)).toEqual(['b', { after: null, limit: 200 }]);
  });

  it('polls once on mount under StrictMode, not twice', async () => {
    const { client, entries } = clientWith([1]);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

    const { result } = renderHook(() => useJournal({ client, accountId: 'a', intervalMs: 60_000 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('live'));
    // the second effect run starts while the first request is still in
    // flight, so it gets skipped
    expect(entries).toHaveBeenCalledTimes(1);
  });

  it('does nothing until enabled', async () => {
    const { client, entries } = clientWith([1]);

    renderHook(() => useJournal({ client, accountId: 'a', enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(entries).not.toHaveBeenCalled();
  });
});
