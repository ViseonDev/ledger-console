import type { Ledger } from './ledger.ts';

export type Result =
  | { status: 200; body: string }
  | { status: 400 | 404 | 405; problem: { type: string; title: string; detail?: string } };

// Same problem types ledger-core uses (internal/adapters/httpapi/problem.go).
const PROBLEMS = 'https://ledger.local/problems/';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function route(ledger: Ledger, url: URL): Result | null {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const query = url.searchParams;

  if (parts.length === 1 && parts[0] === 'readyz') {
    return ok({
      status: 'ready',
      implementation: 'fixture',
      accounts: ledger.accounts.length,
      entries: ledger.entryCount,
    });
  }

  if (parts[0] !== 'v1') return null;

  const [, collection, key, sub] = parts;

  if (collection === 'accounts') {
    // extension: ledger-core only has POST here
    if (key === undefined) {
      return ok({ accounts: ledger.accounts.slice(0, limit(query, 100, 500)) });
    }

    if (sub === undefined) {
      const account = ledger.accountByCode(key);
      return account ? ok(account) : notFound('account', `ledger: account not found: ${key}`);
    }

    if (!UUID.test(key)) return invalid(`ledger: invalid account id: ${key}`);
    const account = ledger.account(key);
    if (!account) return notFound('account', 'ledger: account not found');

    if (sub === 'balance' && parts.length === 4) {
      return ok(ledger.balance(account, query.get('authoritative') === 'true'));
    }

    // extension
    if (sub === 'entries' && parts.length === 4) {
      const after = query.get('after') ?? '0';
      if (!/^\d+$/.test(after)) return invalid(`after must be an entry id, got ${after}`);

      const entries = ledger.entriesAfter(account, Number(after), limit(query, 100, 500));
      return ok({ entries, next_cursor: entries.at(-1)?.id ?? null });
    }

    return null;
  }

  if (collection === 'transactions' && key !== undefined && sub === undefined) {
    if (!UUID.test(key)) return invalid(`ledger: invalid transaction id: ${key}`);
    const transaction = ledger.transaction(key);
    return transaction ? ok(transaction) : notFound('transaction', 'ledger: transaction not found');
  }

  // extension
  if (collection === 'payments' && sub === undefined) {
    if (key === undefined) {
      return ok({ payments: ledger.payments.slice(0, limit(query, 50, 200)) });
    }
    const payment = UUID.test(key) ? ledger.payment(key) : undefined;
    return payment ? ok(payment) : notFound('payment', 'payment not found');
  }

  return null;
}

function limit(query: URLSearchParams, fallback: number, max: number): number {
  const value = Number(query.get('limit') ?? fallback);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function ok(value: unknown): Result {
  return { status: 200, body: serialise(value) };
}

function notFound(thing: string, detail: string): Result {
  const title = `${thing[0]!.toUpperCase()}${thing.slice(1)} not found`;
  return { status: 404, problem: { type: `${PROBLEMS}${thing}-not-found`, title, detail } };
}

function invalid(detail: string): Result {
  return { status: 400, problem: { type: `${PROBLEMS}invalid-request`, title: 'Invalid request', detail } };
}

// JSON.stringify can't do bigint. Go writes int64 as a bare number at any
// size, so swap bigints for a marker string and strip its quotes after.
export function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? `__int64__${item}` : item,
  ).replace(/"__int64__(-?\d+)"/g, '$1');
}
