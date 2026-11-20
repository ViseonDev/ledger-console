import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

import { formatMinor, signedAmount } from '@/client/money';
import type { JournalEntry } from '@/contract/extensions';
import type { AccountType } from '@/contract/schemas';

const POINTS = 300;

function runningTotals(entries: JournalEntry[], type: AccountType) {
  const points: { id: number; y: number; exact: bigint; currency: string }[] = [];
  let running = 0n;

  for (const entry of entries) {
    running += signedAmount(entry.amount, entry.direction, type);
    // recharts wants numbers. Close enough to draw a line; the tooltip
    // shows the exact bigint
    points.push({ id: entry.id, y: Number(running), exact: running, currency: entry.currency });
  }
  return points;
}

/**
 * Running net movement over whatever is in the buffer. Not a balance
 * history: it starts at zero at the oldest buffered entry.
 */
export function MovementChart({ entries, type }: { entries: JournalEntry[]; type: AccountType }) {
  const data = useMemo(() => runningTotals(entries.slice(-POINTS), type), [entries, type]);

  if (data.length < 2) return null;

  return (
    <figure className="panel chart" aria-label={`Net movement over the last ${data.length} entries`}>
      <figcaption className="muted small">Net movement, last {data.length} entries</figcaption>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            isAnimationActive={false}
            labelFormatter={() => ''}
            formatter={(_value, _name, item) => {
              const point = item.payload as (typeof data)[number];
              return [formatMinor(point.exact, point.currency), 'net'];
            }}
          />
          <Area
            type="stepAfter"
            dataKey="y"
            stroke="var(--accent)"
            fill="var(--accent-soft)"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
