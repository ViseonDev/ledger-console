import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { BalancePanel } from '@/balances/BalancePanel';
import { useBalancePair } from '@/balances/useBalancePair';
import { useLedger } from '@/client/context';
import { ErrorNote } from '@/components/ErrorNote';
import { journalSettings } from '@/config';
import type { Account } from '@/contract/schemas';
import { JournalList } from '@/journal/JournalList';
import { MovementChart } from '@/journal/MovementChart';
import { useJournal } from '@/journal/useJournal';

export function AccountPage() {
  const { code = '' } = useParams();
  const client = useLedger();

  const account = useQuery({
    queryKey: ['account', code],
    queryFn: () => client.accountByCode(code),
  });

  if (account.error) return <ErrorNote error={account.error} />;
  if (!account.data) return <p role="status">Loading {code}…</p>;

  // keyed so a different account gets fresh state all the way down
  return <AccountView key={account.data.id} account={account.data} />;
}

function AccountView({ account }: { account: Account }) {
  const client = useLedger();
  const [search] = useSearchParams();
  const [settings] = useState(() => journalSettings(search));
  const [checkAuthoritative, setCheckAuthoritative] = useState(false);

  const agreement = useBalancePair({ client, accountId: account.id, checkAuthoritative });
  const journal = useJournal({ client, accountId: account.id, ...settings });

  useRecheckOnNewEntries(account.id, journal.cursor);

  return (
    <>
      <header className="page-header">
        <h1 className="mono">{account.code}</h1>
        <p className="muted">
          {account.name} · {account.type.toLowerCase()} · {account.currency}
          {account.status === 'CLOSED' && <span className="chip tone-warning">closed</span>}
        </p>
      </header>

      <BalancePanel agreement={agreement} onCheck={() => setCheckAuthoritative(true)} />

      {journal.status === 'unsupported' ? (
        <p className="notice">
          This ledger doesn't expose an entries feed, so there's no journal to show. ledger-core
          stores entries per account (<code>entries_account_id_idx</code>) but has no endpoint for
          them yet.
        </p>
      ) : (
        <>
          <JournalStatus status={journal.status} error={journal.error} intervalMs={journal.intervalMs} />
          <MovementChart entries={journal.entries} type={account.type} />
          <JournalList entries={journal.entries} account={account} discarded={journal.discarded} />
        </>
      )}
    </>
  );
}

/** New entries make both balances stale. Debounced; a disabled query isn't refetched. */
function useRecheckOnNewEntries(accountId: string, cursor: number | null) {
  const queryClient = useQueryClient();
  const initial = useRef(cursor);

  useEffect(() => {
    if (cursor === null || cursor === initial.current) return;

    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['balance', accountId] });
    }, 1_500);
    return () => clearTimeout(timer);
  }, [accountId, cursor, queryClient]);
}

function JournalStatus({ status, error, intervalMs }: { status: string; error: Error | null; intervalMs: number }) {
  if (status === 'error' && error) {
    return (
      <p role="status" className="notice notice-bad" data-testid="journal-status">
        Polling failed: {error.message}. Retrying every {intervalMs / 1000}s.
      </p>
    );
  }

  const label =
    status === 'loading' ? 'loading…' : status === 'idle' ? `quiet, checking every ${intervalMs / 1000}s` : `live, every ${intervalMs / 1000}s`;

  return (
    <p className="muted small" data-testid="journal-status" data-status={status}>
      <span className={`dot dot-${status}`} aria-hidden="true" /> {label}
    </p>
  );
}
