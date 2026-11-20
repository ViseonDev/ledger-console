import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PaymentStatus, type Payment, type PaymentStep } from '@/contract/extensions';
import { SagaDiagram } from './SagaDiagram';

const step = (seq: number, name: string, status: PaymentStep['status'], extra: Partial<PaymentStep> = {}): PaymentStep => ({
  seq,
  name,
  status,
  attempts: status === 'PENDING' ? 0 : 1,
  last_error: null,
  ...extra,
});

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
    reference: 'pay_demo_0001',
    customer_ref: 'cus_demo_0001',
    merchant_ref: 'mer_demo_01',
    amount: 25_000n,
    fee_amount: 500n,
    currency: 'EUR',
    status: 'SETTLED',
    attempts: 4,
    last_error: null,
    steps: [
      step(1, 'reserve', 'DONE'),
      step(2, 'authorize', 'DONE'),
      step(3, 'capture', 'DONE', { attempts: 2 }),
      step(4, 'settle', 'DONE'),
    ],
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:01:30Z',
    ...overrides,
  };
}

const unwinding = [
  step(1, 'reserve', 'DONE'),
  step(2, 'authorize', 'DONE'),
  step(3, 'capture', 'FAILED', { attempts: 3, last_error: 'psp: card declined (do_not_honor)' }),
  step(4, 'settle', 'PENDING'),
];

describe('SagaDiagram', () => {
  it('draws every payment status in the contract', () => {
    // the Record type catches a missing key; this catches one that renders nothing
    for (const status of PaymentStatus.options) {
      const { unmount } = render(<SagaDiagram payment={payment({ status })} />);

      expect(screen.getByTestId('saga')).toHaveAttribute('data-status', status);
      expect(screen.getByTestId('payment-state')).not.toBeEmptyDOMElement();

      unmount();
    }
  });

  it('shows the amount from minor units', () => {
    render(<SagaDiagram payment={payment()} />);

    expect(screen.getByRole('heading', { name: /€250\.00/ })).toBeVisible();
  });

  it('marks the newest DONE step as next to undo', () => {
    render(<SagaDiagram payment={payment({ status: 'COMPENSATING', steps: unwinding })} />);

    const rows = screen.getAllByTestId('saga-step');
    // authorize, not reserve: two DONE steps so a missing reverse would show
    expect(rows[1]).toHaveAttribute('data-next-to-compensate', 'true');
    expect(rows[0]).not.toHaveAttribute('data-next-to-compensate');
  });

  it('moves on to the next step once one has been undone', () => {
    const steps = unwinding.map((s) => (s.name === 'authorize' ? { ...s, status: 'COMPENSATED' as const } : s));
    render(<SagaDiagram payment={payment({ status: 'COMPENSATING', steps })} />);

    expect(screen.getAllByTestId('saga-step')[0]).toHaveAttribute('data-next-to-compensate', 'true');
  });

  it('shows the error from the failed step', () => {
    render(<SagaDiagram payment={payment({ status: 'COMPENSATING', steps: unwinding })} />);

    expect(screen.getByTestId('step-error')).toHaveTextContent('card declined');
  });

  it('only shows attempts when there was more than one', () => {
    render(<SagaDiagram payment={payment()} />);

    expect(screen.getByText('2 attempts')).toBeVisible();
    expect(screen.queryByText('1 attempts')).not.toBeInTheDocument();
  });

  it('flags COMPENSATION_FAILED loudly and marks the steps it could not undo', () => {
    const steps = [
      step(1, 'reserve', 'DONE', { attempts: 5, last_error: 'ledger: account is closed' }),
      step(2, 'authorize', 'COMPENSATED'),
      step(3, 'capture', 'FAILED'),
      step(4, 'settle', 'PENDING'),
    ];
    render(<SagaDiagram payment={payment({ status: 'COMPENSATION_FAILED', steps })} />);

    expect(screen.getByTestId('payment-state')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('needs-a-human')).toBeVisible();
    expect(screen.getAllByTestId('saga-step')[0]).toHaveAttribute('data-stuck', 'true');
    expect(screen.getAllByTestId('saga-step')[1]).not.toHaveAttribute('data-stuck');
  });

  it('does not alert for SETTLED', () => {
    render(<SagaDiagram payment={payment()} />);

    expect(screen.getByTestId('payment-state')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('needs-a-human')).not.toBeInTheDocument();
  });
});
