import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { useLedger } from '@/client/context';
import { Unsupported } from '@/client/ledger';
import { formatMinor } from '@/client/money';
import { PaymentChip } from '@/components/Chip';
import { ErrorNote } from '@/components/ErrorNote';
import type { Account } from '@/contract/schemas';

export function HomePage() {
  return (
    <>
      <AccountLookup />
      <Accounts />
      <Payments />
    </>
  );
}

/** Works against any ledger: ledger-core looks accounts up by code. */
function AccountLookup() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed) void navigate(`/accounts/${encodeURIComponent(trimmed)}`);
  };

  return (
    <form className="lookup" onSubmit={submit} role="search">
      <label htmlFor="account-code">Account code</label>
      <input
        id="account-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="liabilities:customer:wallet:cus_demo_0001"
        spellCheck={false}
        autoComplete="off"
      />
      <button type="submit">Open</button>
    </form>
  );
}

function Accounts() {
  const client = useLedger();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => client.accounts() });

  if (accounts.error instanceof Unsupported) {
    return (
      <p className="notice">
        This ledger has no account list endpoint (ledger-core only looks accounts up by code). Use the
        box above.
      </p>
    );
  }

  return (
    <section className="panel" aria-labelledby="accounts-heading">
      <header className="panel-header">
        <h2 id="accounts-heading">Accounts</h2>
      </header>
      {accounts.error && <ErrorNote error={accounts.error} />}
      {accounts.data && (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th className="num">Cached balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AccountRow({ account }: { account: Account }) {
  const client = useLedger();
  const balance = useQuery({
    queryKey: ['balance', account.id, 'cached'],
    queryFn: () => client.balance(account.id, false),
    refetchInterval: 10_000,
  });

  return (
    <tr data-testid="account-row">
      <td>
        <Link to={`/accounts/${encodeURIComponent(account.code)}`} className="mono">
          {account.code}
        </Link>
      </td>
      <td>{account.name}</td>
      <td className="muted">{account.type.toLowerCase()}</td>
      <td className="num">{balance.data ? formatMinor(balance.data.balance, balance.data.currency) : '…'}</td>
    </tr>
  );
}

function Payments() {
  const client = useLedger();
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => client.payments() });

  // nothing to say about a ledger without payments endpoints beyond the
  // account notice above
  if (payments.error instanceof Unsupported) return null;

  return (
    <section className="panel" aria-labelledby="payments-heading">
      <header className="panel-header">
        <h2 id="payments-heading">Payments</h2>
      </header>
      {payments.error && <ErrorNote error={payments.error} />}
      {payments.data && (
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer → merchant</th>
              <th>Status</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.data.payments.map((payment) => (
              <tr key={payment.id}>
                <td>
                  <Link to={`/payments/${payment.id}`} className="mono">
                    {payment.reference}
                  </Link>
                </td>
                <td className="muted">
                  {payment.customer_ref} → {payment.merchant_ref}
                </td>
                <td>
                  <PaymentChip status={payment.status} />
                </td>
                <td className="num">{formatMinor(payment.amount, payment.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
