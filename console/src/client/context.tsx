import { createContext, useContext, type ReactNode } from 'react';

import { LedgerClient } from './ledger';

const LedgerContext = createContext<LedgerClient | null>(null);

export function LedgerProvider({ client, children }: { client: LedgerClient; children: ReactNode }) {
  return <LedgerContext value={client}>{children}</LedgerContext>;
}

export function useLedger(): LedgerClient {
  const client = useContext(LedgerContext);
  if (!client) throw new Error('useLedger outside <LedgerProvider>');
  return client;
}
