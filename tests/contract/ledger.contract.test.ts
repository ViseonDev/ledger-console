import { beforeAll, describe, expect, it, type TestContext } from 'vitest';

import { LedgerClient, Unsupported } from '@/client/ledger';
import { PaymentStatus } from '@/contract/extensions';

// LEDGER_URL picks the fixture or a real ledger-core. Extension tests skip
// when the endpoint is missing. ledger-core can't list, so set:
//   CONTRACT_ACCOUNT_CODE     an account with some history (default assets:cash:operating)
//   CONTRACT_TRANSACTION_ID   any posted transaction

const baseUrl = process.env.LEDGER_URL ?? 'http://localhost:8022';
const client = new LedgerClient({ baseUrl });

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let accountCode = process.env.CONTRACT_ACCOUNT_CODE ?? 'assets:cash:operating';
let accountId: string;
let transactionId: string | undefined = process.env.CONTRACT_TRANSACTION_ID;
let hasEntries = true;
let hasPayments = true;
let paymentId: string | undefined;

async function supported<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof Unsupported) return undefined;
    throw error;
  }
}

beforeAll(async () => {
  const listed = await supported(() => client.accounts({ limit: 50 }));

  // prefer an account the ledger can show us entries for
  if (listed) {
    for (const account of listed.accounts) {
      const page = await supported(() => client.entries(account.id, { limit: 1 }));
      if (page === undefined) hasEntries = false;
      if (page === undefined || page.entries.length > 0) {
        accountCode = account.code;
        break;
      }
    }
  }

  accountId = (await client.accountByCode(accountCode)).id;

  const page = await supported(() => client.entries(accountId, { limit: 1 }));
  hasEntries = page !== undefined;
  transactionId ??= page?.entries[0]?.transaction_id;

  const payments = await supported(() => client.payments({ limit: 5 }));
  hasPayments = payments !== undefined;
  paymentId = payments?.payments[0]?.id;
}, 30_000);

function needs(ctx: TestContext, condition: unknown, why: string) {
  if (!condition) ctx.skip(why);
}

describe(`ledger-core contract, against ${baseUrl}`, () => {
  it('reports ready', async () => {
    expect((await client.readiness()).status).toBe('ready');
  });

  it('serves an account by code', async () => {
    const account = await client.accountByCode(accountCode);

    expect(account.code).toBe(accountCode);
    expect(account.id).toBe(accountId);
  });

  it('serves a cached balance, marked as cached', async () => {
    const balance = await client.balance(accountId);

    expect(balance.account_id).toBe(accountId);
    expect(balance.authoritative).toBe(false);
    expect(typeof balance.balance).toBe('bigint');
  });

  it('serves a recomputed balance, marked as authoritative', async () => {
    expect((await client.balance(accountId, true)).authoritative).toBe(true);
  });

  it('keeps its own invariant: cached balance equals the journal', async () => {
    // needs a frozen ledger (FIXTURE_ENTRY_INTERVAL_MS=0) or it can race
    const [cached, recomputed] = await Promise.all([
      client.balance(accountId, false),
      client.balance(accountId, true),
    ]);

    expect({ ...cached, authoritative: true }).toEqual(recomputed);
  });

  it('signs balance to the normal side: debits - credits for an asset, the reverse otherwise', async () => {
    const account = await client.accountByCode(accountCode);
    const { debits, credits, balance } = await client.balance(accountId);
    const debitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';

    expect(balance).toBe(debitNormal ? debits - credits : credits - debits);
  });

  it('serves a transaction whose entries balance', async (ctx) => {
    needs(ctx, transactionId, 'no transaction id: set CONTRACT_TRANSACTION_ID');

    const transaction = await client.transaction(transactionId!);
    const total = (direction: string) =>
      transaction.entries.filter((e) => e.direction === direction).reduce((sum, e) => sum + e.amount, 0n);

    expect(transaction.entries.length).toBeGreaterThanOrEqual(2);
    expect(total('DEBIT')).toBe(total('CREDIT'));
  });

  it('answers an unknown account code with a 404 problem', async () => {
    await expect(client.accountByCode('liabilities:customer:wallet:cus_missing_0000')).rejects.toMatchObject({
      name: 'LedgerProblem',
      httpStatus: 404,
    });
  });

  it('answers an unknown transaction with a 404 problem', async () => {
    await expect(client.transaction(MISSING_ID)).rejects.toMatchObject({
      name: 'LedgerProblem',
      httpStatus: 404,
      problem: { title: 'Transaction not found' },
    });
  });

  it('answers a malformed id with a 400 problem', async () => {
    await expect(client.balance('not-a-uuid')).rejects.toMatchObject({
      name: 'LedgerProblem',
      httpStatus: 400,
    });
  });
});

describe(`extensions, against ${baseUrl}`, () => {
  it('pages entries by keyset with no overlap', async (ctx) => {
    needs(ctx, hasEntries, 'no entries endpoint');

    const first = await client.entries(accountId, { limit: 2 });
    needs(ctx, first.entries.length === 2, 'account has fewer than 3 entries');

    const second = await client.entries(accountId, { after: first.next_cursor, limit: 2 });
    const seen = new Set(first.entries.map((e) => e.id));

    for (const entry of second.entries) expect(seen.has(entry.id)).toBe(false);
  });

  it('returns entries in ascending id order, all for the right account', async (ctx) => {
    needs(ctx, hasEntries, 'no entries endpoint');

    const { entries } = await client.entries(accountId, { limit: 100 });
    const ids = entries.map((e) => e.id);

    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    for (const entry of entries) expect(entry.account_id).toBe(accountId);
  });

  it('returns an empty page, not an error, past the end', async (ctx) => {
    needs(ctx, hasEntries, 'no entries endpoint');

    let cursor: number | null = null;
    for (;;) {
      const page = await client.entries(accountId, { after: cursor, limit: 500 });
      if (page.entries.length === 0) break;
      cursor = page.next_cursor;
    }

    const past = await client.entries(accountId, { after: cursor, limit: 10 });
    expect(past).toEqual({ entries: [], next_cursor: null });
  });

  it('adds up to the authoritative balance, entry by entry', async (ctx) => {
    needs(ctx, hasEntries, 'no entries endpoint');

    let debits = 0n;
    let credits = 0n;
    let cursor: number | null = null;
    for (;;) {
      const page = await client.entries(accountId, { after: cursor, limit: 500 });
      if (page.entries.length === 0) break;
      for (const e of page.entries) {
        if (e.direction === 'DEBIT') debits += e.amount;
        else credits += e.amount;
      }
      cursor = page.next_cursor;
    }

    const recomputed = await client.balance(accountId, true);
    expect({ debits, credits }).toEqual({ debits: recomputed.debits, credits: recomputed.credits });
  });

  it('serves payments in a status the console can draw', async (ctx) => {
    needs(ctx, hasPayments, 'no payments endpoint');
    needs(ctx, paymentId, 'no payments on this ledger');

    const payment = await client.payment(paymentId!);

    expect(PaymentStatus.options).toContain(payment.status);
    expect(payment.steps.map((s) => s.seq)).toEqual([...payment.steps.map((s) => s.seq)].sort((a, b) => a - b));
    expect(payment.fee_amount <= payment.amount).toBe(true);
  });
});
