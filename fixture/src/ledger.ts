import type {
  Account,
  AccountType,
  Direction,
  Transaction,
} from '../../console/src/contract/schemas.ts';
import type { JournalEntry, Payment, PaymentStep } from '../../console/src/contract/extensions.ts';
import { Random } from './random.ts';

// In-memory ledger with ledger-core's shapes plus the extension endpoints.

type Leg = { account: Account; direction: Direction; amount: bigint };

export interface BalanceView {
  account_id: string;
  currency: string;
  debits: bigint;
  credits: bigint;
  balance: bigint;
  authoritative: boolean;
}

/** Accounts the demo and the browser tests rely on. */
export const SPECIAL = {
  large: 'liabilities:customer:wallet:cus_demo_0901',
  busy: 'liabilities:customer:wallet:cus_demo_0902',
  quiet: 'liabilities:customer:wallet:cus_demo_0903',
  drifted: 'liabilities:customer:wallet:cus_demo_0904',
  huge: 'liabilities:customer:wallet:cus_demo_0905',
} as const;

const CHART: [code: string, name: string, type: AccountType, allowNegative: boolean][] = [
  ['assets:cash:operating', 'Operating cash', 'ASSET', false],
  ['assets:psp:stripe', 'Stripe balance', 'ASSET', true],
  ['liabilities:settlement:pending', 'Pending settlement', 'LIABILITY', false],
  ['liabilities:fees:payable', 'Fees payable', 'LIABILITY', false],
  ['revenue:fees:processing', 'Processing fee revenue', 'REVENUE', false],
  ['expense:psp:fees', 'PSP fees', 'EXPENSE', false],
  ['equity:retained', 'Retained earnings', 'EQUITY', true],
];

const CUSTOMERS = 6;
const MERCHANTS = 3;
const DAY = 86_400_000;

const normal = (type: AccountType): Direction =>
  type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';

export class Ledger {
  readonly accounts: Account[] = [];
  private readonly byId = new Map<string, Account>();
  private readonly byCode = new Map<string, Account>();

  private readonly entries: JournalEntry[] = [];
  private readonly entriesByAccount = new Map<string, JournalEntry[]>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly cache = new Map<string, { debits: bigint; credits: bigint }>();

  readonly payments: Payment[] = [];
  private readonly paymentsById = new Map<string, Payment>();

  private readonly random: Random;
  private nextEntryId = 1;
  // history is backdated from here; anything posted after generate() is "now"
  private clock: number | null;

  constructor(seed: number, now = Date.now()) {
    this.random = new Random(seed);
    this.clock = now - 14 * DAY;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  generate(): void {
    for (const [code, name, type, allowNegative] of CHART) {
      this.open(code, name, type, allowNegative);
    }
    for (let i = 1; i <= CUSTOMERS; i += 1) {
      const ref = `cus_demo_${String(i).padStart(4, '0')}`;
      this.open(`liabilities:customer:wallet:${ref}`, `Demo customer ${ref.slice(-4)} wallet`, 'LIABILITY');
    }
    for (let i = 1; i <= MERCHANTS; i += 1) {
      const ref = `mer_demo_${String(i).padStart(2, '0')}`;
      this.open(`liabilities:merchant:payable:${ref}`, `Demo merchant ${ref.slice(-2)} payable`, 'LIABILITY');
    }

    this.open(SPECIAL.large, 'Load test wallet (10k entries)', 'LIABILITY');
    this.open(SPECIAL.busy, 'Busy wallet (450 entries)', 'LIABILITY');
    this.open(SPECIAL.quiet, 'Quiet wallet', 'LIABILITY');
    this.open(SPECIAL.drifted, 'Drifted wallet (cache != journal)', 'LIABILITY');
    this.open(SPECIAL.huge, 'Wallet above 2^53', 'LIABILITY');

    const equity = this.code('equity:retained');

    for (const wallet of this.wallets()) {
      this.post('opening_balance', [
        { account: equity, direction: 'DEBIT', amount: BigInt(this.random.int(50, 2_500) * 100) },
        { account: wallet, direction: 'CREDIT', amount: 0n },
      ]);
    }

    for (let i = 0; i < 400; i += 1) this.postRandom();

    this.fill(SPECIAL.large, 10_000);
    this.fill(SPECIAL.busy, 450);
    this.fill(SPECIAL.quiet, 3);
    this.fill(SPECIAL.drifted, 25);

    // 9007199254740993 minor units: the first integer a double can't hold
    this.post('opening_balance', [
      { account: equity, direction: 'DEBIT', amount: 9_007_199_254_740_993n },
      { account: this.code(SPECIAL.huge), direction: 'CREDIT', amount: 9_007_199_254_740_993n },
    ]);

    // the cache claims €12.34 more than the entries add up to
    this.cache.get(this.code(SPECIAL.drifted).id)!.credits += 1_234n;

    this.seedPayments();
    this.clock = null;
  }

  /** One random top-up, purchase or payout. What the live writer calls. */
  postRandom(): Transaction {
    const wallets = this.wallets();
    const wallet = this.random.pick(wallets);
    const merchant = this.random.pick(this.accounts.filter((a) => a.code.startsWith('liabilities:merchant:')));
    const cash = this.code('assets:cash:operating');
    const roll = this.random.next();

    if (roll < 0.45 || this.normalBalance(wallet) < 1_000n) {
      const amount = BigInt(this.random.int(10, 500) * 100);
      return this.post(`topup_${this.random.int(10_000, 99_999)}`, [
        { account: cash, direction: 'DEBIT', amount },
        { account: wallet, direction: 'CREDIT', amount },
      ]);
    }

    if (roll < 0.85) {
      const max = Number(this.normalBalance(wallet) / 2n);
      const amount = BigInt(this.random.int(100, Math.max(100, max)));
      const fee = amount / 50n;
      return this.post(`purchase_${this.random.int(10_000, 99_999)}`, [
        { account: wallet, direction: 'DEBIT', amount },
        { account: merchant, direction: 'CREDIT', amount: amount - fee },
        { account: this.code('revenue:fees:processing'), direction: 'CREDIT', amount: fee },
      ]);
    }

    const owed = this.normalBalance(merchant);
    if (owed <= 0n) return this.postRandom();
    return this.post(`payout_${this.random.int(10_000, 99_999)}`, [
      { account: merchant, direction: 'DEBIT', amount: owed },
      { account: cash, direction: 'CREDIT', amount: owed },
    ]);
  }

  // reads

  accountByCode(code: string): Account | undefined {
    return this.byCode.get(code);
  }

  account(id: string): Account | undefined {
    return this.byId.get(id);
  }

  transaction(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  payment(id: string): Payment | undefined {
    return this.paymentsById.get(id);
  }

  balance(account: Account, authoritative: boolean): BalanceView {
    let debits = 0n;
    let credits = 0n;

    if (authoritative) {
      for (const entry of this.entriesByAccount.get(account.id) ?? []) {
        if (entry.direction === 'DEBIT') debits += entry.amount;
        else credits += entry.amount;
      }
    } else {
      ({ debits, credits } = this.cache.get(account.id)!);
    }

    return {
      account_id: account.id,
      currency: account.currency,
      debits,
      credits,
      balance: normal(account.type) === 'DEBIT' ? debits - credits : credits - debits,
      authoritative,
    };
  }

  /** Keyset page: ids strictly greater than `after`, ascending. */
  entriesAfter(account: Account, after: number, limit: number): JournalEntry[] {
    const list = this.entriesByAccount.get(account.id) ?? [];

    // ids are ascending, so binary search for the first one past the cursor
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid]!.id <= after) lo = mid + 1;
      else hi = mid;
    }

    return list.slice(lo, lo + limit);
  }

  // writes (internal only, the HTTP side is read-only)

  private open(code: string, name: string, type: AccountType, allowNegative = false): Account {
    const account: Account = {
      id: this.random.uuid(),
      code,
      name,
      type,
      currency: 'EUR',
      allow_negative: allowNegative,
      status: 'ACTIVE',
    };

    this.accounts.push(account);
    this.byId.set(account.id, account);
    this.byCode.set(code, account);
    this.entriesByAccount.set(account.id, []);
    this.cache.set(account.id, { debits: 0n, credits: 0n });

    return account;
  }

  private post(reference: string, legs: Leg[]): Transaction {
    // a zero leg means "balance the rest", which keeps the opening balances short
    const debit = legs.filter((l) => l.direction === 'DEBIT').reduce((t, l) => t + l.amount, 0n);
    const credit = legs.filter((l) => l.direction === 'CREDIT').reduce((t, l) => t + l.amount, 0n);
    const filler = legs.find((l) => l.amount === 0n);
    if (filler) filler.amount = filler.direction === 'DEBIT' ? credit - debit : debit - credit;

    let at = Date.now();
    if (this.clock !== null) {
      this.clock += this.random.int(1_000, 60_000);
      at = Math.min(this.clock, at);
    }
    const postedAt = new Date(at).toISOString();
    const id = this.random.uuid();

    const transaction: Transaction = {
      id,
      reference,
      currency: 'EUR',
      posted_at: postedAt,
      entries: legs.map((leg) => ({
        account_id: leg.account.id,
        direction: leg.direction,
        amount: leg.amount,
      })),
    };

    for (const leg of legs) {
      const entry: JournalEntry = {
        id: this.nextEntryId++,
        transaction_id: id,
        account_id: leg.account.id,
        direction: leg.direction,
        amount: leg.amount,
        currency: 'EUR',
        posted_at: postedAt,
      };

      this.entries.push(entry);
      this.entriesByAccount.get(leg.account.id)!.push(entry);

      const cached = this.cache.get(leg.account.id)!;
      if (leg.direction === 'DEBIT') cached.debits += leg.amount;
      else cached.credits += leg.amount;
    }

    this.transactions.set(id, transaction);
    return transaction;
  }

  /** Alternating top-ups and spends until the account has `count` entries. */
  private fill(code: string, count: number): void {
    const wallet = this.code(code);
    const cash = this.code('assets:cash:operating');
    const list = this.entriesByAccount.get(wallet.id)!;

    while (list.length < count) {
      const amount = BigInt(this.random.int(1, 200) * 100);
      const spend = list.length % 2 === 1 && this.normalBalance(wallet) >= amount;

      this.post(spend ? 'spend' : 'topup', [
        { account: cash, direction: spend ? 'CREDIT' : 'DEBIT', amount },
        { account: wallet, direction: spend ? 'DEBIT' : 'CREDIT', amount },
      ]);
    }
  }

  private seedPayments(): void {
    const step = (seq: number, name: string, status: PaymentStep['status'], attempts = 1, last_error: string | null = null): PaymentStep => ({
      seq,
      name,
      status,
      attempts: status === 'PENDING' ? 0 : attempts,
      last_error,
    });

    const declined = 'psp: card declined (do_not_honor)';

    const scenarios: [Payment['status'], PaymentStep[], string | null][] = [
      ['SETTLED', [step(1, 'reserve', 'DONE'), step(2, 'authorize', 'DONE'), step(3, 'capture', 'DONE', 2), step(4, 'settle', 'DONE')], null],
      ['SETTLED', [step(1, 'reserve', 'DONE'), step(2, 'authorize', 'DONE'), step(3, 'capture', 'DONE'), step(4, 'settle', 'DONE')], null],
      ['PENDING', [step(1, 'reserve', 'PENDING'), step(2, 'authorize', 'PENDING'), step(3, 'capture', 'PENDING'), step(4, 'settle', 'PENDING')], null],
      ['IN_PROGRESS', [step(1, 'reserve', 'DONE'), step(2, 'authorize', 'DONE', 3), step(3, 'capture', 'PENDING'), step(4, 'settle', 'PENDING')], null],
      ['COMPENSATING', [step(1, 'reserve', 'DONE'), step(2, 'authorize', 'COMPENSATED'), step(3, 'capture', 'FAILED', 3, declined), step(4, 'settle', 'PENDING')], declined],
      ['COMPENSATED', [step(1, 'reserve', 'COMPENSATED'), step(2, 'authorize', 'COMPENSATED'), step(3, 'capture', 'FAILED', 3, declined), step(4, 'settle', 'PENDING')], declined],
      [
        'COMPENSATION_FAILED',
        [
          step(1, 'reserve', 'DONE', 5, 'ledger: account is closed'),
          step(2, 'authorize', 'COMPENSATED'),
          step(3, 'capture', 'FAILED', 3, 'psp: timeout after 3 retries'),
          step(4, 'settle', 'PENDING'),
        ],
        'compensation of step reserve failed: ledger: account is closed',
      ],
    ];

    scenarios.forEach(([status, steps, lastError], index) => {
      const amount = BigInt(this.random.int(5, 400) * 100);
      const created = new Date(Date.now() - (scenarios.length - index) * 3_600_000);

      const payment: Payment = {
        id: this.random.uuid(),
        reference: `pay_demo_${String(index + 1).padStart(4, '0')}`,
        customer_ref: `cus_demo_${String((index % CUSTOMERS) + 1).padStart(4, '0')}`,
        merchant_ref: `mer_demo_${String((index % MERCHANTS) + 1).padStart(2, '0')}`,
        amount,
        fee_amount: amount / 50n,
        currency: 'EUR',
        status,
        attempts: steps.reduce((total, s) => total + s.attempts, 0),
        last_error: lastError,
        steps,
        created_at: created.toISOString(),
        updated_at: new Date(created.getTime() + 90_000).toISOString(),
      };

      this.payments.push(payment);
      this.paymentsById.set(payment.id, payment);
    });
  }

  private wallets(): Account[] {
    return this.accounts.filter(
      (a) => a.code.startsWith('liabilities:customer:wallet:cus_demo_000'),
    );
  }

  private code(code: string): Account {
    const account = this.byCode.get(code);
    if (!account) throw new Error(`fixture: no account ${code}`);
    return account;
  }

  private normalBalance(account: Account): bigint {
    return this.balance(account, false).balance;
  }
}
