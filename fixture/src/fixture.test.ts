import { beforeAll, describe, expect, it } from 'vitest';

import { parseLedgerJson } from '@/client/money';
import { AccountList, EntryPage, PaymentList, PaymentStatus } from '@/contract/extensions';
import { Account, Balance, Transaction } from '@/contract/schemas';
import { Ledger, SPECIAL } from './ledger';
import { route, serialise } from './routes';

// The fixture is built against the contract's types, but types are erased.
// These check its actual output parses, the same way the console parses it.

let ledger: Ledger;

beforeAll(() => {
  ledger = new Ledger(20_260_914);
  ledger.generate();
});

function get(path: string): unknown {
  const result = route(ledger, new URL(path, 'http://fixture'));
  if (result?.status !== 200) throw new Error(`${path} -> ${JSON.stringify(result)}`);
  return parseLedgerJson(result.body);
}

describe('fixture output matches the contract', () => {
  it('serves accounts, balances, transactions, entries and payments', () => {
    const { accounts } = AccountList.parse(get('/v1/accounts?limit=500'));
    const first = accounts[0]!;

    expect(Account.parse(get(`/v1/accounts/${encodeURIComponent(first.code)}`)).id).toBe(first.id);
    expect(Balance.parse(get(`/v1/accounts/${first.id}/balance`)).authoritative).toBe(false);

    const page = EntryPage.parse(get(`/v1/accounts/${first.id}/entries?limit=5`));
    expect(page.entries.length).toBeGreaterThan(0);
    expect(Transaction.parse(get(`/v1/transactions/${page.entries[0]!.transaction_id}`))).toBeTruthy();

    const { payments } = PaymentList.parse(get('/v1/payments'));
    expect(new Set(payments.map((p) => p.status))).toEqual(new Set(PaymentStatus.options));
  });

  it('is deterministic for a seed', () => {
    const again = new Ledger(20_260_914);
    again.generate();

    expect(again.accounts.map((a) => a.id)).toEqual(ledger.accounts.map((a) => a.id));
    expect(again.entryCount).toBe(ledger.entryCount);
  });

  it('keeps every transaction balanced', () => {
    for (const account of ledger.accounts.slice(0, 5)) {
      const page = EntryPage.parse(get(`/v1/accounts/${account.id}/entries?limit=20`));

      for (const entry of page.entries) {
        const tx = Transaction.parse(get(`/v1/transactions/${entry.transaction_id}`));
        const sum = (d: string) =>
          tx.entries.filter((e) => e.direction === d).reduce((t, e) => t + e.amount, 0n);

        expect(sum('DEBIT')).toBe(sum('CREDIT'));
      }
    }
  });
});

describe('the special accounts', () => {
  const byCode = (code: string) => ledger.accountByCode(code)!;

  it('has ten thousand entries on the large account', () => {
    const large = byCode(SPECIAL.large);
    expect(ledger.entriesAfter(large, 0, 20_000)).toHaveLength(10_000);
  });

  it('has a cache that disagrees with the journal on the drifted account', () => {
    const drifted = byCode(SPECIAL.drifted);

    expect(ledger.balance(drifted, false).balance - ledger.balance(drifted, true).balance).toBe(1_234n);
  });

  it('agrees everywhere else', () => {
    for (const account of ledger.accounts.filter((a) => a.code !== SPECIAL.drifted)) {
      expect(ledger.balance(account, false)).toEqual({ ...ledger.balance(account, true), authoritative: false });
    }
  });

  it('writes the huge balance as a bare JSON number, like Go would', () => {
    const huge = byCode(SPECIAL.huge);
    const result = route(ledger, new URL(`http://fixture/v1/accounts/${huge.id}/balance`));

    expect(result?.status === 200 && result.body).toContain('"balance":9007199254740993');
  });
});

describe('keyset pagination', () => {
  it('returns only ids past the cursor, ascending', () => {
    const busy = ledger.accountByCode(SPECIAL.busy)!;
    const first = ledger.entriesAfter(busy, 0, 100);
    const second = ledger.entriesAfter(busy, first.at(-1)!.id, 100);

    expect(second[0]!.id).toBeGreaterThan(first.at(-1)!.id);
    expect(second.map((e) => e.id)).toEqual([...second.map((e) => e.id)].sort((a, b) => a - b));
  });

  it('returns an empty page past the end', () => {
    const quiet = ledger.accountByCode(SPECIAL.quiet)!;
    const all = ledger.entriesAfter(quiet, 0, 100);

    expect(ledger.entriesAfter(quiet, all.at(-1)!.id, 100)).toEqual([]);
  });

  it('rejects a cursor that is not an entry id', () => {
    const quiet = ledger.accountByCode(SPECIAL.quiet)!;
    const result = route(ledger, new URL(`http://fixture/v1/accounts/${quiet.id}/entries?after=abc`));

    expect(result?.status).toBe(400);
  });
});

describe('serialise', () => {
  it('writes bigints as bare numbers and leaves strings alone', () => {
    expect(serialise({ a: 9_007_199_254_740_993n, b: '__int64__ is just text', c: -5n })).toBe(
      '{"a":9007199254740993,"b":"__int64__ is just text","c":-5}',
    );
  });
});
