import { formatMinor } from '@/client/money';
import type { Payment, PaymentStep } from '@/contract/extensions';
import { PAYMENT_STATES, STEP_STATES, compensationOrder, isUnwinding } from './states';

export function SagaDiagram({ payment }: { payment: Payment }) {
  const state = PAYMENT_STATES[payment.status];
  const steps = [...payment.steps].sort((a, b) => a.seq - b.seq);

  const toUndo = isUnwinding(payment.status) ? compensationOrder(steps) : [];
  // while unwinding, the head of the list is what the worker does next; once
  // it has given up, every DONE step left is one it couldn't undo
  const nextSeq = payment.status === 'COMPENSATING' ? toUndo[0]?.seq : undefined;
  const stuck = new Set(payment.status === 'COMPENSATION_FAILED' ? toUndo.map((s) => s.seq) : []);

  return (
    <section aria-labelledby="saga-heading" className="panel" data-testid="saga" data-status={payment.status}>
      <header className="panel-header">
        <h2 id="saga-heading">
          {payment.reference} · {formatMinor(payment.amount, payment.currency)}
        </h2>
        <span className="muted small">
          {payment.customer_ref} → {payment.merchant_ref}, fee {formatMinor(payment.fee_amount, payment.currency)}
        </span>
      </header>

      <p
        className={`state tone-${state.tone}`}
        data-testid="payment-state"
        // a payment that needs a human interrupts a screen reader; the rest wait
        role={state.tone === 'bad' ? 'alert' : 'status'}
      >
        <strong>{state.label}.</strong> {state.meaning}
      </p>

      <ol className="steps">
        {steps.map((step) => (
          <Step key={step.seq} step={step} next={step.seq === nextSeq} stuck={stuck.has(step.seq)} />
        ))}
      </ol>

      {payment.status === 'COMPENSATION_FAILED' && (
        <div role="alert" className="notice notice-bad" data-testid="needs-a-human">
          <p>
            The saga gave up undoing this payment. Steps still marked <em>Done</em> above have effects
            that were never reversed.
          </p>
          <p>
            This console is read-only and can't retry it. Follow the ledger's runbook for{' '}
            <code>COMPENSATION_FAILED</code>.
          </p>
        </div>
      )}
    </section>
  );
}

function Step({ step, next, stuck }: { step: PaymentStep; next: boolean; stuck: boolean }) {
  const rendering = STEP_STATES[step.status];

  return (
    <li
      className={`step${next ? ' step-next' : ''}${stuck ? ' step-stuck' : ''}`}
      data-testid="saga-step"
      data-step-status={step.status}
      data-next-to-compensate={next ? 'true' : undefined}
      data-stuck={stuck ? 'true' : undefined}
    >
      <span className="ordinal">{step.seq}</span>
      <span className="name">{step.name}</span>
      <span className={`chip tone-${stuck ? 'bad' : rendering.tone}`} title={rendering.meaning}>
        {stuck ? 'Undo failed' : rendering.label}
      </span>
      {step.attempts > 1 && <span className="muted small">{step.attempts} attempts</span>}
      {next && <span className="next">undoing next</span>}
      {step.last_error && (
        <p className="step-error" data-testid="step-error">
          {step.last_error}
        </p>
      )}
    </li>
  );
}
