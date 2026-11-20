import { Unsupported } from '@/client/ledger';
import type { EntryPage, JournalEntry } from '@/contract/extensions';

export type FeedStatus = 'loading' | 'live' | 'idle' | 'error' | 'unsupported';

export interface FeedSnapshot {
  entries: JournalEntry[];
  /** dropped off the front of the buffer so far */
  discarded: number;
  cursor: number | null;
  status: FeedStatus;
  error: Error | null;
  intervalMs: number;
}

export interface FeedOptions {
  fetchPage: (after: number | null, limit: number) => Promise<EntryPage>;
  pageSize?: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  bufferSize?: number;
  quietAfterMs?: number;
  now?: () => number;
}

/**
 * Keyset pagination used as a live feed: keep the id of the last entry we
 * have and ask for everything after it. No server-side subscription, nothing
 * to resume after a disconnect - the cursor is the whole state.
 *
 * A class and not hook state: with the cursor in state the poll effect
 * restarted its timer on every page.
 */
export class JournalFeed {
  private readonly fetchPage: FeedOptions['fetchPage'];
  private readonly pageSize: number;
  private readonly baseInterval: number;
  private readonly maxInterval: number;
  private readonly bufferSize: number;
  private readonly quietAfter: number;
  private readonly now: () => number;

  private snapshot: FeedSnapshot;
  private readonly listeners = new Set<() => void>();

  private lastArrival: number;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  // bumped on stop() so a request that was in flight can't reschedule
  private generation = 0;
  private running = false;

  constructor(options: FeedOptions) {
    this.fetchPage = options.fetchPage;
    this.pageSize = options.pageSize ?? 200;
    this.baseInterval = options.intervalMs ?? 2_000;
    this.maxInterval = options.maxIntervalMs ?? 10_000;
    this.bufferSize = options.bufferSize ?? 5_000;
    this.quietAfter = options.quietAfterMs ?? 60_000;
    this.now = options.now ?? Date.now;

    this.lastArrival = this.now();
    this.snapshot = {
      entries: [],
      discarded: 0,
      cursor: null,
      status: 'loading',
      error: null,
      intervalMs: this.baseInterval,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FeedSnapshot => this.snapshot;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    clearTimeout(this.timer);
  }

  /** One request. Returns whether the page was full (i.e. there's probably more). */
  async poll(): Promise<boolean> {
    if (this.inFlight || this.snapshot.status === 'unsupported') return false;
    this.inFlight = true;

    try {
      const page = await this.fetchPage(this.snapshot.cursor, this.pageSize);

      if (page.entries.length > 0) {
        this.lastArrival = this.now();
        this.append(page.entries);
        return page.entries.length >= this.pageSize;
      }

      // An empty page leaves the cursor alone. Taking next_cursor from it
      // (null) would restart the feed from the beginning.
      const quiet = this.now() - this.lastArrival > this.quietAfter;
      const intervalMs = quiet ? this.maxInterval : this.snapshot.intervalMs;
      this.set({ status: quiet ? 'idle' : 'live', error: null, intervalMs });
      return false;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      // keep whatever we already have; a blip shouldn't empty the journal
      this.set({ status: error instanceof Unsupported ? 'unsupported' : 'error', error });
      return false;
    } finally {
      this.inFlight = false;
    }
  }

  private async tick(generation: number): Promise<void> {
    const full = await this.poll();

    if (!this.running || generation !== this.generation) return;
    if (this.snapshot.status === 'unsupported') return;

    // a full page means we're behind: catch up straight away
    this.timer = setTimeout(() => void this.tick(generation), full ? 0 : this.snapshot.intervalMs);
  }

  private append(incoming: JournalEntry[]): void {
    let entries = this.snapshot.entries.concat(incoming);
    let { discarded } = this.snapshot;

    const overflow = entries.length - this.bufferSize;
    if (overflow > 0) {
      entries = entries.slice(overflow);
      discarded += overflow;
    }

    this.set({
      entries,
      discarded,
      cursor: incoming.at(-1)!.id,
      status: 'live',
      error: null,
      // first new entry after a quiet spell drops straight back to the fast
      // interval; easing back would make the first burst show up late
      intervalMs: this.baseInterval,
    });
  }

  private set(patch: Partial<FeedSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
