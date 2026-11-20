import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { useLedger } from '@/client/context';
import { Unsupported } from '@/client/ledger';
import { ErrorNote } from '@/components/ErrorNote';
import { SagaDiagram } from '@/saga/SagaDiagram';
import { PAYMENT_STATES } from '@/saga/states';

export function PaymentPage() {
  const { id = '' } = useParams();
  const client = useLedger();

  const payment = useQuery({
    queryKey: ['payment', id],
    queryFn: () => client.payment(id),
    // keep watching until it lands somewhere it can't leave
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && PAYMENT_STATES[status].terminal ? false : 2_000;
    },
  });

  if (payment.error instanceof Unsupported) {
    return <p className="notice">This ledger has no payments endpoint.</p>;
  }
  if (payment.error) return <ErrorNote error={payment.error} />;
  if (!payment.data) return <p role="status">Loading payment…</p>;

  return <SagaDiagram payment={payment.data} />;
}
