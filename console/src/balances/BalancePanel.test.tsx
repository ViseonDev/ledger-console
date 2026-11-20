import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Balance } from '@/contract/schemas';
import { BalancePanel } from './BalancePanel';
import { compare } from './useBalancePair';

function balance(amount: bigint, authoritative: boolean): Balance {
  return {
    account_id: '6b0b5d2e-1c3a-5f4e-8d9b-2a7c6e5f4d3b',
    currency: 'EUR',
    debits: 0n,
    credits: amount,
    balance: amount,
    authoritative,
  };
}

describe('compare', () => {
  it('agrees when all three numbers match', () => {
    expect(compare(balance(500n, false), balance(500n, true)).state).toBe('agreed');
  });

  it('signs the difference as cached minus authoritative', () => {
    const result = compare(balance(1_734n, false), balance(500n, true));

    expect(result).toMatchObject({ state: 'differs', difference: 1_234n });
  });

  it('flags a difference in debits/credits even when the net is equal', () => {
    const cached = { ...balance(500n, false), debits: 100n, credits: 600n };

    expect(compare(cached, balance(500n, true)).state).toBe('differs');
  });
});

describe('BalancePanel', () => {
  it('shows the cached balance as not checked until asked', async () => {
    const onCheck = vi.fn();
    render(<BalancePanel agreement={{ state: 'unchecked', cached: balance(25_000n, false), checking: false }} onCheck={onCheck} />);

    expect(screen.getByTestId('cached-balance')).toHaveTextContent('€250.00');
    expect(screen.queryByTestId('authoritative-balance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agreed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('check-balance'));
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it('shows a status when they agree', () => {
    render(<BalancePanel agreement={compare(balance(500n, false), balance(500n, true))} onCheck={() => {}} />);

    expect(screen.getByTestId('agreed')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('authoritative-balance')).toHaveTextContent('€5.00');
  });

  it('raises an alert with the direction and size when they differ', () => {
    render(<BalancePanel agreement={compare(balance(1_734n, false), balance(500n, true))} onCheck={() => {}} />);

    const alert = screen.getByTestId('differs');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('€12.34 higher');
    expect(alert).toHaveTextContent(/make reconcile/);
  });

  it('says lower when the cache is under', () => {
    render(<BalancePanel agreement={compare(balance(500n, false), balance(1_734n, true))} onCheck={() => {}} />);

    expect(screen.getByTestId('differs')).toHaveTextContent('€12.34 lower');
  });

  it('shows a balance past 2^53 to the cent', () => {
    render(
      <BalancePanel
        agreement={{ state: 'unchecked', cached: balance(9_007_199_254_740_993n, false), checking: false }}
        onCheck={() => {}}
      />,
    );

    expect(screen.getByTestId('cached-balance')).toHaveTextContent('€90,071,992,547,409.93');
  });
});
