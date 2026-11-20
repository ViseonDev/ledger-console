import type { PaymentStatus } from '@/contract/extensions';
import { PAYMENT_STATES } from '@/saga/states';

export function PaymentChip({ status }: { status: PaymentStatus }) {
  const state = PAYMENT_STATES[status];
  return <span className={`chip tone-${state.tone}`}>{state.label}</span>;
}
