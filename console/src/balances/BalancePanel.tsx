import { formatMinor } from '@/client/money';
import type { Balance } from '@/contract/schemas';
import type { Agreement } from './useBalancePair';

interface Props {
  agreement: Agreement;
  onCheck: () => void;
}

export function BalancePanel({ agreement, onCheck }: Props) {
  if (agreement.state === 'loading') {
    return <p role="status">Reading the balance…</p>;
  }

  if (agreement.state === 'error') {
    return (
      <p role="alert" className="notice notice-bad">
        Couldn't read the balance: {agreement.error.message}
      </p>
    );
  }

  const { cached } = agreement;
  const authoritative = 'authoritative' in agreement ? agreement.authoritative : null;

  return (
    <section
      aria-labelledby="balance-heading"
      className="panel"
      data-testid="balances"
      data-state={agreement.state}
    >
      <header className="panel-header">
        <h2 id="balance-heading">Balance</h2>
      </header>

      <div className="balances">
        <BalanceFigure label="Cached" balance={cached} testId="cached-balance" />
        {authoritative ? (
          <BalanceFigure
            label="Recomputed from the journal"
            balance={authoritative}
            testId="authoritative-balance"
          />
        ) : (
          <div className="figure figure-pending">
            <span className="label">Recomputed from the journal</span>
            <button type="button" onClick={onCheck} disabled={agreement.state === 'unchecked' && agreement.checking} data-testid="check-balance">
              {agreement.state === 'unchecked' && agreement.checking ? 'Recomputing…' : 'Recompute'}
            </button>
            <span className="muted small">Sums every entry on the account. Not checked yet.</span>
          </div>
        )}
      </div>

      {agreement.state === 'agreed' && (
        <p role="status" className="notice notice-good" data-testid="agreed">
          Cache and journal agree.
        </p>
      )}

      {agreement.state === 'differs' && (
        <div role="alert" className="notice notice-bad" data-testid="differs">
          <p>
            <strong>These don't match.</strong> The cache is{' '}
            {formatMinor(abs(agreement.difference), cached.currency)}{' '}
            {agreement.difference > 0n ? 'higher' : 'lower'} than the entries add up to.
          </p>
          <p>
            ledger-core writes the cache and the entries in one transaction, so something wrote one
            without the other. Run <code>make reconcile</code> on the ledger.
          </p>
        </div>
      )}
    </section>
  );
}

function BalanceFigure({ label, balance, testId }: { label: string; balance: Balance; testId: string }) {
  return (
    <div className="figure">
      <span className="label">{label}</span>
      <span className="amount" data-testid={testId}>
        {formatMinor(balance.balance, balance.currency)}
      </span>
      <span className="muted small">
        Dr {formatMinor(balance.debits, balance.currency)} · Cr{' '}
        {formatMinor(balance.credits, balance.currency)}
      </span>
    </div>
  );
}

const abs = (value: bigint) => (value < 0n ? -value : value);
