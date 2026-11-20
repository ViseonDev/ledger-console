import { z } from 'zod';

import { Account, Direction, Money } from './schemas';

// Endpoints ledger-core doesn't have yet, served by the fixture. Against a
// real ledger they 404/405 and the client throws Unsupported.

export const AccountList = z.object({
  accounts: z.array(Account),
});
export type AccountList = z.infer<typeof AccountList>;

// bigint in ledger-core, fine as a JSON number for now
const EntryId = z.number().int().positive().refine(Number.isSafeInteger);

export const JournalEntry = z.object({
  id: EntryId,
  transaction_id: z.uuid(),
  account_id: z.uuid(),
  direction: Direction,
  amount: Money,
  currency: z.string().length(3),
  posted_at: z.iso.datetime({ offset: true }),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

/** Keyset: `?after=<id>` returns entries with a larger id, ascending. */
export const EntryPage = z.object({
  entries: z.array(JournalEntry),
  next_cursor: EntryId.nullable(),
});
export type EntryPage = z.infer<typeof EntryPage>;

// Same values as ledger-core's payment_status and payment_step_status enums.
export const PaymentStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'SETTLED',
  'COMPENSATING',
  'COMPENSATED',
  'COMPENSATION_FAILED',
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const StepStatus = z.enum(['PENDING', 'DONE', 'COMPENSATED', 'FAILED']);
export type StepStatus = z.infer<typeof StepStatus>;

export const PaymentStep = z.object({
  seq: z.number().int().nonnegative(),
  name: z.string(),
  status: StepStatus,
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
});
export type PaymentStep = z.infer<typeof PaymentStep>;

export const Payment = z.object({
  id: z.uuid(),
  reference: z.string(),
  customer_ref: z.string(),
  merchant_ref: z.string(),
  amount: Money,
  fee_amount: Money,
  currency: z.string().length(3),
  status: PaymentStatus,
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  steps: z.array(PaymentStep),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Payment = z.infer<typeof Payment>;

export const PaymentList = z.object({
  payments: z.array(Payment),
});
export type PaymentList = z.infer<typeof PaymentList>;
