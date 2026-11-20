import { describe, expect, it } from 'vitest';

import { PaymentStatus, StepStatus } from '@/contract/extensions';
import { PAYMENT_STATES, STEP_STATES, compensationOrder } from './states';

describe('every status the API can return has a rendering', () => {
  it('covers exactly the payment statuses in the contract', () => {
    expect(Object.keys(PAYMENT_STATES).sort()).toEqual([...PaymentStatus.options].sort());

    for (const status of PaymentStatus.options) {
      expect(PAYMENT_STATES[status].label).not.toBe('');
      expect(PAYMENT_STATES[status].meaning).not.toBe('');
    }
  });

  it('covers exactly the step statuses in the contract', () => {
    expect(Object.keys(STEP_STATES).sort()).toEqual([...StepStatus.options].sort());
  });

  it('marks the same terminal states as ledger-core', () => {
    // payment.Status.IsTerminal()
    const terminal = PaymentStatus.options.filter((s) => PAYMENT_STATES[s].terminal);

    expect(terminal.sort()).toEqual(['COMPENSATED', 'COMPENSATION_FAILED', 'SETTLED']);
  });

  it('gives COMPENSATION_FAILED the bad tone and says a person is needed', () => {
    expect(PAYMENT_STATES.COMPENSATION_FAILED.tone).toBe('bad');
    expect(PAYMENT_STATES.COMPENSATION_FAILED.meaning).toMatch(/person/);
  });
});

describe('compensationOrder', () => {
  const steps = [
    { seq: 1, name: 'reserve', status: 'DONE' as const },
    { seq: 2, name: 'authorize', status: 'DONE' as const },
    { seq: 3, name: 'capture', status: 'FAILED' as const },
    { seq: 4, name: 'settle', status: 'PENDING' as const },
  ];

  it('undoes the newest DONE step first', () => {
    expect(compensationOrder(steps).map((s) => s.name)).toEqual(['authorize', 'reserve']);
  });

  it('goes by seq, not array order', () => {
    expect(compensationOrder([...steps].reverse()).map((s) => s.name)).toEqual(['authorize', 'reserve']);
  });

  it('skips steps that never ran, failed, or were already undone', () => {
    const names = compensationOrder([...steps, { seq: 5, name: 'x', status: 'COMPENSATED' as const }]).map((s) => s.name);

    expect(names).not.toContain('capture');
    expect(names).not.toContain('settle');
    expect(names).not.toContain('x');
  });
});
