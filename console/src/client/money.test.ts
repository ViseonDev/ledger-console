import { describe, expect, it } from 'vitest';

import { formatMinor, normalSide, parseLedgerJson, signedAmount } from './money';

type Loose = Record<string, unknown>;

describe('money survives the wire exactly', () => {
  it('keeps a value above Number.MAX_SAFE_INTEGER', () => {
    const parsed = parseLedgerJson('{"balance":9007199254740993}') as Loose;

    expect(parsed.balance).toBe('9007199254740993');
    expect(BigInt(parsed.balance as string)).toBe(9_007_199_254_740_993n);
  });

  it('is what plain JSON.parse gets wrong', () => {
    const naive = JSON.parse('{"balance":9007199254740993}') as { balance: number };

    expect(naive.balance).toBe(9_007_199_254_740_992);
  });

  it('keeps negative values', () => {
    const parsed = parseLedgerJson('{"amount":-9007199254740993}') as Loose;

    expect(parsed.amount).toBe('-9007199254740993');
  });

  it('quotes every money field, nested or not, with or without whitespace', () => {
    const text = `{
      "debits": 10, "credits" :20,
      "entries": [{"amount": 1}, {"amount":2}],
      "fee_amount":3
    }`;
    const parsed = parseLedgerJson(text) as Loose;

    expect(parsed.debits).toBe('10');
    expect(parsed.credits).toBe('20');
    expect(parsed.fee_amount).toBe('3');
    expect((parsed.entries as Loose[]).map((e) => e.amount)).toEqual(['1', '2']);
  });

  it('leaves non-money numbers alone', () => {
    const parsed = parseLedgerJson('{"attempts":3,"seq":1,"id":42,"next_cursor":42}') as Loose;

    expect(parsed).toEqual({ attempts: 3, seq: 1, id: 42, next_cursor: 42 });
  });

  it('does not match a key that only ends in a money field name', () => {
    const parsed = parseLedgerJson('{"max_amount":5}') as Loose;

    expect(parsed.max_amount).toBe(5);
  });

  it('does not touch text inside a string value', () => {
    const reference = 'memo "amount": 42';
    const parsed = parseLedgerJson(JSON.stringify({ reference })) as Loose;

    expect(parsed.reference).toBe(reference);
  });

  it('leaves a decimal as a number instead of producing broken JSON', () => {
    // the schema rejects this later; the parser just mustn't throw
    const parsed = parseLedgerJson('{"amount":12.5}') as Loose;

    expect(parsed.amount).toBe(12.5);
  });

  it('leaves already-quoted money alone', () => {
    const parsed = parseLedgerJson('{"amount":"500"}') as Loose;

    expect(parsed.amount).toBe('500');
  });
});

describe('formatMinor', () => {
  it('formats small amounts', () => {
    expect(formatMinor(1_250n, 'EUR')).toBe('€12.50');
    expect(formatMinor(5n, 'EUR')).toBe('€0.05');
    expect(formatMinor(0n, 'GBP')).toBe('£0.00');
  });

  it('groups thousands', () => {
    expect(formatMinor(123_456_789n, 'EUR')).toBe('€1,234,567.89');
  });

  it('formats past 2^53 without rounding', () => {
    expect(formatMinor(9_007_199_254_740_993n, 'EUR')).toBe('€90,071,992,547,409.93');
  });

  it('puts the sign in front of the symbol', () => {
    expect(formatMinor(-1_250n, 'EUR')).toBe('-€12.50');
  });

  it('falls back to the currency code', () => {
    expect(formatMinor(1_250n, 'CHF')).toBe('12.50 CHF');
  });
});

describe('signedAmount', () => {
  it('derives the normal side from the account type', () => {
    expect(normalSide('ASSET')).toBe('DEBIT');
    expect(normalSide('EXPENSE')).toBe('DEBIT');
    expect(normalSide('LIABILITY')).toBe('CREDIT');
    expect(normalSide('EQUITY')).toBe('CREDIT');
    expect(normalSide('REVENUE')).toBe('CREDIT');
  });

  it('adds on the normal side and subtracts on the other', () => {
    expect(signedAmount(100n, 'DEBIT', 'ASSET')).toBe(100n);
    expect(signedAmount(100n, 'CREDIT', 'ASSET')).toBe(-100n);
    expect(signedAmount(100n, 'CREDIT', 'LIABILITY')).toBe(100n);
    expect(signedAmount(100n, 'DEBIT', 'LIABILITY')).toBe(-100n);
  });
});
