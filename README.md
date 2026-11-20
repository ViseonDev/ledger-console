# Ledger Console

A read-only web console for [ledger-core](https://github.com/ViseonDev/ledger-core): account balances,
a live journal and payment saga state.

Comes with a fixture server that serves the same API, so it runs from a clean clone. Set
`VITE_LEDGER_URL` to point it at a real ledger.

## What it shows

- Cached and recomputed balance side by side, with the difference if they don't match.
- Per-account journal, polled every 2s with keyset pagination (`?after=<last id>`). The list is
  virtualised, so 10k rows are fine.
- Payment sagas: which steps ran, which failed, what gets undone next. `COMPENSATION_FAILED` is
  flagged as needing a person.

Read-only: no posting, reversals or retries. Writes stay in ledger-core.

## Running it

Needs Node 24+ and Docker.

```bash
make up          # fixture on :8022, console on :5187
```

Or without Docker:

```bash
npm install
npm run dev
```

Accounts worth opening in the fixture:

| Account | What it's for |
| --- | --- |
| `liabilities:customer:wallet:cus_demo_0001` | normal wallet, gets new entries every ~1.5s |
| `liabilities:customer:wallet:cus_demo_0901` | 10,000 entries |
| `liabilities:customer:wallet:cus_demo_0904` | cache disagrees with the journal by €12.34 |
| `liabilities:customer:wallet:cus_demo_0905` | balance above 2^53 minor units |

The front page also lists payments in every saga state.

### Against a real ledger-core

ledger-core sends no CORS headers, so either put both behind one origin (see
[docs/DEPLOY.md](docs/DEPLOY.md)) or let vite proxy in dev:

```bash
VITE_LEDGER_URL= LEDGER_PROXY_TARGET=http://localhost:8080 npm run dev --workspace=console
```

Then open an account by code, e.g. `/accounts/assets:cash:operating`.

## Notes

- Amounts are int64 and `JSON.parse` rounds past 2^53, so money fields are quoted in the raw text
  before parsing and become `bigint` ([money.ts](console/src/client/money.ts)). The fixture sends bare
  numbers past 2^53 like Go does.
- The journal cursor lives in a class behind `useSyncExternalStore`
  ([feed.ts](console/src/journal/feed.ts)). In React state it restarted the poll timer on every page.
- When the buffer drops old entries, the list corrects `scrollTop` by the number dropped
  ([JournalList.tsx](console/src/journal/JournalList.tsx)).
- Account codes are sent with literal colons. chi doesn't decode path params, so `%3A` broke lookups
  against ledger-core.

## The contract

Zod schemas: [schemas.ts](console/src/contract/schemas.ts) for what ledger-core serves and
[extensions.ts](console/src/contract/extensions.ts) for what the fixture adds (account list, entries
feed, payments). Responses are validated in the client and a mismatch throws with the path and field.

The [contract suite](tests/contract/ledger.contract.test.ts) runs against whatever `LEDGER_URL` points
at. Against ledger-core the extension tests are skipped.

```bash
make test-live LEDGER_URL=http://localhost:8080 CONTRACT_TRANSACTION_ID=<some tx id>
```

## Tests

```bash
make test-unit   # vitest: parsing, client, feed, components, fixture
make test-int    # contract suite against the fixture + Playwright
make lint
```

Virtualisation, scroll position and poll rate are tested in Playwright ([e2e/](e2e)) since jsdom has
no layout. CI also runs the contract suite against a real ledger-core.

## Stack

React 19, TypeScript 6, Vite 8, TanStack Query + Virtual, React Router 8, Zod 4, Recharts. Vitest 5,
Testing Library, Playwright. The fixture is plain Node (`node:http`, no dependencies) run straight from
TypeScript with Node's type stripping.

TypeScript is on 6.0 rather than 7 because typescript-eslint doesn't support 7 yet.

## Layout

```
console/src/
  contract/    zod schemas: the API, described once
  client/      fetch, validation, bigint money
  journal/     keyset poller and virtualised list
  balances/    cached vs recomputed
  saga/        payment state rendering
  routes/      pages
fixture/src/   in-memory ledger with the same API
tests/contract the suite that runs against either
e2e/           Playwright
```

## Not done

No writes, no auth (put it in front of the ledger), and no account list, journal or payments against
ledger-core until it has those endpoints. More in [docs/DEPLOY.md](docs/DEPLOY.md#not-done).
