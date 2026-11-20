import { ContractViolation, LedgerProblem } from '@/client/ledger';

/** Shows the ledger's own title/detail rather than rewording it. */
export function ErrorNote({ error }: { error: Error }) {
  if (error instanceof LedgerProblem) {
    return (
      <div role="alert" className="notice notice-bad">
        <strong>{error.problem.title}</strong>
        {error.problem.detail && <p>{error.problem.detail}</p>}
        {error.problem.request_id && <p className="muted small mono">request {error.problem.request_id}</p>}
      </div>
    );
  }

  if (error instanceof ContractViolation) {
    return (
      <div role="alert" className="notice notice-bad">
        <strong>The ledger sent something this console doesn't understand.</strong>
        <p className="mono small">{error.path}</p>
        <ul className="mono small">
          {error.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div role="alert" className="notice notice-bad">
      {error.message}
    </div>
  );
}
