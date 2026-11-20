import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { useLedger } from '@/client/context';
import { formatMinor } from '@/client/money';
import { ErrorNote } from '@/components/ErrorNote';

export function TransactionPage() {
  const { id = '' } = useParams();
  const client = useLedger();
  const transaction = useQuery({ queryKey: ['transaction', id], queryFn: () => client.transaction(id) });

  if (transaction.error) return <ErrorNote error={transaction.error} />;
  if (!transaction.data) return <p role="status">Loading transaction…</p>;

  const tx = transaction.data;
  const total = (direction: 'DEBIT' | 'CREDIT') =>
    tx.entries.filter((e) => e.direction === direction).reduce((sum, e) => sum + e.amount, 0n);
  const debits = total('DEBIT');
  const credits = total('CREDIT');

  return (
    <>
      <header className="page-header">
        <h1 className="mono">{tx.id}</h1>
        <p className="muted">
          {tx.reference ?? 'no reference'} · posted {new Date(tx.posted_at).toLocaleString('en-GB')}
          {tx.reversal_of && (
            <>
              {' · reverses '}
              <Link to={`/transactions/${tx.reversal_of}`} className="mono">
                {tx.reversal_of.slice(0, 8)}
              </Link>
            </>
          )}
        </p>
      </header>

      <section className="panel" aria-labelledby="entries-heading">
        <header className="panel-header">
          <h2 id="entries-heading">Entries</h2>
          {debits === credits ? (
            <span className="chip tone-good" data-testid="balanced">balanced</span>
          ) : (
            <span className="chip tone-bad" role="alert" data-testid="unbalanced">
              does not balance
            </span>
          )}
        </header>
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tx.entries.map((entry, index) => (
              <tr key={index}>
                {/* GET responses carry the account id only */}
                <td className="mono">{entry.account_code ?? entry.account_id}</td>
                <td className="num">{entry.direction === 'DEBIT' ? formatMinor(entry.amount, tx.currency) : ''}</td>
                <td className="num">{entry.direction === 'CREDIT' ? formatMinor(entry.amount, tx.currency) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <td className="num">{formatMinor(debits, tx.currency)}</td>
              <td className="num">{formatMinor(credits, tx.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {tx.metadata && Object.keys(tx.metadata).length > 0 && (
        <section className="panel" aria-labelledby="metadata-heading">
          <header className="panel-header">
            <h2 id="metadata-heading">Metadata</h2>
          </header>
          <dl className="meta">
            {Object.entries(tx.metadata).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
