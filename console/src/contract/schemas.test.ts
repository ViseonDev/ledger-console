import { describe, expect, it } from 'vitest';

import { Balance, Transaction } from './schemas';

const ACCOUNT_ID = '0c3f8a3e-5b1d-5e2a-9f4b-7d6e1a2b3c4d';

describe('Money', () => {
  const balance = (value: unknown) => ({
    account_id: ACCOUNT_ID,
    currency: 'EUR',
    debits: '0',
    credits: '0',
    balance: value,
    authoritative: false,
  });

  it('turns a quoted integer into a bigint', () => {
    expect(Balance.parse(balance('9007199254740993')).balance).toBe(9_007_199_254_740_993n);
  });

  it('accepts a small unquoted number', () => {
    expect(Balance.parse(balance(2500)).balance).toBe(2500n);
  });

  it('rejects an unquoted number past 2^53', () => {
    const result = Balance.safeParse(balance(2 ** 53 + 2));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/lost precision/);
  });

  it('rejects a decimal string', () => {
    expect(Balance.safeParse(balance('12.50')).success).toBe(false);
  });
});

describe('Transaction', () => {
  it('accepts what ledger-core sends for a GET, with omitempty fields missing', () => {
    const parsed = Transaction.parse({
      id: '1b4e28ba-2fa1-51d2-883f-0016d3cca427',
      currency: 'EUR',
      posted_at: '2026-08-17T00:01:00.123456789Z',
      entries: [
        { account_id: ACCOUNT_ID, direction: 'DEBIT', amount: '500' },
        { account_id: ACCOUNT_ID, direction: 'CREDIT', amount: '500' },
      ],
    });

    expect(parsed.reference).toBeUndefined();
    expect(parsed.entries[0]?.amount).toBe(500n);
  });

  it('refuses a transaction with a single entry', () => {
    const result = Transaction.safeParse({
      id: '1b4e28ba-2fa1-51d2-883f-0016d3cca427',
      currency: 'EUR',
      posted_at: '2026-08-17T00:01:00Z',
      entries: [{ account_id: ACCOUNT_ID, direction: 'DEBIT', amount: '500' }],
    });

    expect(result.success).toBe(false);
  });
});
