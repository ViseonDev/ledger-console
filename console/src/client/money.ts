import type { AccountType, Direction } from '@/contract/schemas';

// int64 money fields. Keep in sync with Money() in contract/.
export const MONEY_FIELDS = ['amount', 'fee_amount', 'balance', 'debits', 'credits'] as const;

// "key": 123  ->  "key": "123"
// bare integers only, skips decimals and exponents
const MONEY_PATTERN = new RegExp(`"(${MONEY_FIELDS.join('|')})"(\\s*):(\\s*)(-?\\d+)(?![\\d.eE])`, 'g');

/** JSON.parse that keeps int64 money exact. A reviver would run after the rounding. */
export function parseLedgerJson(text: string): unknown {
  return JSON.parse(text.replace(MONEY_PATTERN, '"$1"$2:$3"$4"'));
}

const SYMBOLS: Record<string, string> = { EUR: '€', GBP: '£', USD: '$' };

export function formatMinor(amount: bigint, currency: string): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;

  const major = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const minor = (abs % 100n).toString().padStart(2, '0');
  const symbol = SYMBOLS[currency];

  const body = symbol ? `${symbol}${major}.${minor}` : `${major}.${minor} ${currency}`;

  return negative ? `-${body}` : body;
}

export function normalSide(type: AccountType): Direction {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

/** How an entry moves the account's balance: + on its normal side, - otherwise. */
export function signedAmount(amount: bigint, direction: Direction, type: AccountType): bigint {
  return direction === normalSide(type) ? amount : -amount;
}
