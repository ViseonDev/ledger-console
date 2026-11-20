import { z } from 'zod';

// ledger-core's REST views (internal/app/ledger.go)

/** int64 minor units, quoted by client/money.ts. A bare number is accepted only while exact. */
export const Money = z.union([z.string(), z.number()]).transform((value, ctx) => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${value} was parsed as a double and has lost precision`,
      });
      return z.NEVER;
    }
    return BigInt(value);
  }

  if (!/^-?\d+$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: `${JSON.stringify(value)} is not an integer` });
    return z.NEVER;
  }
  return BigInt(value);
});

export const Direction = z.enum(['DEBIT', 'CREDIT']);
export type Direction = z.infer<typeof Direction>;

export const AccountType = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export type AccountType = z.infer<typeof AccountType>;

const Currency = z.string().regex(/^[A-Z]{3}$/);

export const Account = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string(),
  type: AccountType,
  currency: Currency,
  allow_negative: z.boolean(),
  status: z.enum(['ACTIVE', 'CLOSED']),
});
export type Account = z.infer<typeof Account>;

/** `balance` is already signed to the account's normal side. */
export const Balance = z.object({
  account_id: z.uuid(),
  currency: Currency,
  debits: Money,
  credits: Money,
  balance: Money,
  authoritative: z.boolean(),
});
export type Balance = z.infer<typeof Balance>;

export const TransactionEntry = z.object({
  account_id: z.uuid(),
  // only filled in on the response to a POST, never on a GET
  account_code: z.string().optional(),
  direction: Direction,
  amount: Money,
});
export type TransactionEntry = z.infer<typeof TransactionEntry>;

// Go's omitempty drops reference, reversal_of and metadata when empty.
export const Transaction = z.object({
  id: z.uuid(),
  reference: z.string().optional(),
  currency: Currency,
  posted_at: z.iso.datetime({ offset: true }),
  reversal_of: z.uuid().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  entries: z.array(TransactionEntry).min(2),
});
export type Transaction = z.infer<typeof Transaction>;

/** RFC 9457, plus ledger-core's request_id extension member. */
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

export const Readiness = z.object({
  status: z.string(),
  // only the fixture sends this
  implementation: z.literal('fixture').optional(),
});
export type Readiness = z.infer<typeof Readiness>;
