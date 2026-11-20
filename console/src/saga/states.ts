import type { PaymentStatus, PaymentStep, StepStatus } from '@/contract/extensions';

export type Tone = 'neutral' | 'progress' | 'good' | 'warning' | 'bad';

export interface StateRendering {
  label: string;
  tone: Tone;
  meaning: string;
  terminal: boolean;
}

// Record keyed by the contract enum, so a new status without a rendering
// fails tsc instead of falling through to a default.

/** From ledger-core's internal/domain/payment/status.go. */
export const PAYMENT_STATES: Record<PaymentStatus, StateRendering> = {
  PENDING: {
    label: 'Pending',
    tone: 'neutral',
    meaning: 'Created, no worker has picked it up yet.',
    terminal: false,
  },
  IN_PROGRESS: {
    label: 'In progress',
    tone: 'progress',
    meaning: 'A worker holds the lease and is running the steps in order.',
    terminal: false,
  },
  SETTLED: {
    label: 'Settled',
    tone: 'good',
    meaning: 'Every step completed.',
    terminal: true,
  },
  COMPENSATING: {
    label: 'Unwinding',
    tone: 'warning',
    meaning: 'A step failed for good. Completed steps are being undone, newest first.',
    terminal: false,
  },
  COMPENSATED: {
    label: 'Unwound',
    tone: 'neutral',
    meaning: 'Failed, and everything it did has been undone. Balances are as they were before it started.',
    terminal: true,
  },
  COMPENSATION_FAILED: {
    label: 'Unwind failed',
    tone: 'bad',
    meaning:
      'Undoing a step failed, so money is sitting somewhere it should not be. A person has to ' +
      'sort this out; ledger-core alerts on this state.',
    terminal: true,
  },
};

/** ledger-core's payment_step_status. */
export const STEP_STATES: Record<StepStatus, StateRendering> = {
  PENDING: { label: 'Not run', tone: 'neutral', meaning: 'Has not run yet.', terminal: false },
  DONE: { label: 'Done', tone: 'good', meaning: 'Completed, and would need undoing if the payment fails.', terminal: false },
  FAILED: { label: 'Failed', tone: 'bad', meaning: 'Failed to execute. Nothing to undo.', terminal: true },
  COMPENSATED: { label: 'Undone', tone: 'neutral', meaning: 'Its effect has been reversed.', terminal: true },
};

/**
 * Steps still to undo, in the order the saga undoes them: DONE steps, last
 * first. PENDING never ran and FAILED left nothing behind.
 */
export function compensationOrder<T extends Pick<PaymentStep, 'status' | 'seq'>>(steps: T[]): T[] {
  return steps.filter((step) => step.status === 'DONE').sort((a, b) => b.seq - a.seq);
}

export function isUnwinding(status: PaymentStatus): boolean {
  return status === 'COMPENSATING' || status === 'COMPENSATION_FAILED';
}
