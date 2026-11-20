import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { LedgerProvider } from '@/client/context';
import { ContractViolation, LedgerClient, LedgerProblem, Unsupported } from '@/client/ledger';
import { config } from '@/config';
import { router } from '@/routes/router';
import './styles.css';

const client = new LedgerClient({ baseUrl: config.ledgerUrl });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // retrying won't fix a 404, a schema mismatch or a missing endpoint
      retry: (count, error) =>
        !(error instanceof ContractViolation || error instanceof Unsupported || isClientError(error)) &&
        count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function isClientError(error: unknown): boolean {
  return error instanceof LedgerProblem && error.httpStatus >= 400 && error.httpStatus < 500;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LedgerProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LedgerProvider>
  </StrictMode>,
);
