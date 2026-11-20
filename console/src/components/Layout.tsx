import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from 'react-router';

import { useLedger } from '@/client/context';
import { config } from '@/config';

export function Layout() {
  const client = useLedger();
  const readiness = useQuery({
    queryKey: ['readiness'],
    queryFn: () => client.readiness(),
    refetchInterval: 15_000,
  });

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Ledger Console
        </Link>
        <span className="muted small mono">{config.ledgerUrl || location.origin}</span>
        <span className="spacer" />
        {readiness.data?.implementation === 'fixture' && (
          <span className="badge badge-fixture" data-testid="fixture-badge" title="Invented data from the fixture server, not a real ledger">
            fixture
          </span>
        )}
        {readiness.isError ? (
          <span className="badge badge-bad">ledger unreachable</span>
        ) : (
          readiness.data && <span className="badge badge-good">{readiness.data.status}</span>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
