const env = import.meta.env;

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  // unset = the fixture; set but empty = same origin
  ledgerUrl: (env.VITE_LEDGER_URL as string | undefined) ?? 'http://localhost:8022',
  pollIntervalMs: int(env.VITE_POLL_INTERVAL_MS, 2_000),
  pollMaxIntervalMs: int(env.VITE_POLL_MAX_INTERVAL_MS, 10_000),
  journalBuffer: int(env.VITE_JOURNAL_BUFFER, 5_000),
  pageSize: int(env.VITE_PAGE_SIZE, 200),
};

export interface JournalSettings {
  intervalMs: number;
  maxIntervalMs: number;
  bufferSize: number;
  pageSize: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** ?interval=, ?buffer= and ?page= override journal settings (used by e2e), clamped. */
export function journalSettings(search: URLSearchParams): JournalSettings {
  const read = (key: string, fallback: number, min: number, max: number) =>
    search.has(key) ? clamp(int(search.get(key) ?? undefined, fallback), min, max) : fallback;

  return {
    intervalMs: read('interval', config.pollIntervalMs, 250, 60_000),
    maxIntervalMs: config.pollMaxIntervalMs,
    bufferSize: read('buffer', config.journalBuffer, 50, 50_000),
    pageSize: read('page', config.pageSize, 10, 500),
  };
}
