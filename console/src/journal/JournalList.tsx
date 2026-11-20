import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';

import { formatMinor, signedAmount } from '@/client/money';
import type { JournalEntry } from '@/contract/extensions';
import type { Account } from '@/contract/schemas';

// fixed row height, so the trim correction is a multiplication
export const ROW_HEIGHT = 40;
const VIEWPORT = 520;

interface Props {
  entries: JournalEntry[];
  account: Account;
  discarded: number;
}

export function JournalList({ entries, account, discarded }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef({ discarded, count: entries.length });

  // no React Compiler in this project, so nothing to skip
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // key by id so rows don't remount when the buffer trims
    getItemKey: (index) => entries[index]?.id ?? index,
  });

  // trimming the front shifts rows up under the reader. Correct by the
  // discard count, the length doesn't change once the buffer is full.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previous = seen.current;
    seen.current = { discarded, count: entries.length };
    if (!element) return;

    const trimmed = discarded - previous.discarded;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT / 2;

    if (trimmed > 0) {
      element.scrollTop = Math.max(0, element.scrollTop - trimmed * ROW_HEIGHT);
    }

    // follow the tail if the reader was already there
    if (atBottom && entries.length > previous.count && previous.count > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [discarded, entries.length, virtualizer]);

  return (
    <section aria-labelledby="journal-heading" className="panel">
      <header className="panel-header">
        <h2 id="journal-heading">Journal</h2>
        <span className="muted" data-testid="journal-count">
          {entries.length.toLocaleString('en-GB')} entries
        </span>
      </header>

      {discarded > 0 && (
        <p role="status" className="notice" data-testid="discarded">
          {discarded.toLocaleString('en-GB')} older entries dropped out of the buffer. Reload to see
          them again.
        </p>
      )}

      <div className="journal-head" aria-hidden="true">
        <span>Posted</span>
        <span>Transaction</span>
        <span>Side</span>
        <span className="num">Amount</span>
      </div>

      <div
        ref={scrollRef}
        className="journal-scroll"
        style={{ height: VIEWPORT }}
        data-testid="journal-scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            if (!entry) return null;

            const signed = signedAmount(entry.amount, entry.direction, account.type);

            return (
              <div
                key={item.key}
                className="journal-row"
                data-testid="journal-row"
                data-entry-id={entry.id}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <time dateTime={entry.posted_at}>{formatTime(entry.posted_at)}</time>
                <Link to={`/transactions/${entry.transaction_id}`} className="mono">
                  {entry.transaction_id.slice(0, 8)}
                </Link>
                <span className="muted">{entry.direction === 'DEBIT' ? 'Dr' : 'Cr'}</span>
                <span className={signed < 0n ? 'num negative' : 'num'}>
                  {formatMinor(signed, entry.currency)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
