# Deploying

## Access control goes in front of the ledger, not the console

The console is a static bundle that calls the ledger's API. Anything it can read, a browser's network
tab can read. Putting basic auth on the console and leaving the API open protects nothing.

ledger-core's own deploy setup already does the right thing here: Caddy in front, GETs public, writes
behind basic auth. If balances shouldn't be public, put the auth on the API routes.

The fixture server is for development and CI only. If the `fixture` badge shows up on a deployment
that's supposed to show real money, something is pointed at the wrong place.

## One origin, no CORS

ledger-core doesn't send CORS headers. Rather than change that, serve both from the same host: the
console at `/`, the ledger's API at `/v1` and `/readyz`. Then build with an empty `VITE_LEDGER_URL`
and every request is same-origin.

With Caddy, added to ledger-core's existing Caddyfile:

```
ledger.example.com {
    handle /v1/* {
        reverse_proxy 127.0.0.1:8080
    }
    handle /readyz {
        reverse_proxy 127.0.0.1:8080
    }
    handle {
        root * /srv/ledger-console
        try_files {path} /index.html
        file_server
    }
}
```

Build:

```bash
VITE_LEDGER_URL= npm run build --workspace=console
rsync -a console/dist/ server:/srv/ledger-console/
```

## Changing the ledger URL means a rebuild

Vite replaces `import.meta.env.VITE_LEDGER_URL` with a string at build time. Setting it on a running
container does nothing. That's why docker-compose passes it as a build arg.

With one deployment that's fine. With several, fetch a `config.json` from the serving origin at
startup instead: one request and a loading state before the first render.

## What you get against ledger-core today

| | Fixture | ledger-core |
| --- | --- | --- |
| Account list | yes | no endpoint, use lookup by code |
| Account by code | yes | yes |
| Cached + recomputed balance | yes | yes |
| Transaction view | yes | yes |
| Live journal | yes | no endpoint |
| Payments / saga | yes | no endpoint |

ledger-core's REST API only has lookups: account by code, balance by account id, transaction by id.
The console handles the missing ones (a plain 404/405 without a problem document) as "not supported"
and says so on the page rather than erroring.

Adding them to ledger-core is mostly SQL over tables that already exist:

- `GET /v1/accounts/{id}/entries?after=&limit=`: `entries` already has `(account_id, id)` indexed,
  which is exactly a keyset query.
- `GET /v1/payments/{id}`: `payment_intents` joined to `payment_steps`.
- `GET /v1/accounts?limit=`: trivial.

The shapes the console expects are in [extensions.ts](../console/src/contract/extensions.ts).

## What to watch

The console has no state of its own. Things to look for:

- Balance mismatch: a ledger problem, run `make reconcile` there.
- `ContractViolation` in the browser console: the API changed shape. `contract-live` in CI should
  catch it first.
- Journal stuck on error: ledger unreachable or returning problems.

## Not done

- No writes, including retrying a stuck compensation.
- No auth (see above).
- No account list, journal or payments against ledger-core until it has the endpoints.
- Journal is per account, no global feed.
- Entries dropped from the buffer need a reload; scrolling back needs a `before` cursor.
- The chart covers what's in the buffer, not a date range.
- Each open account polls every 2s. Fine for a team, would need push for many viewers.
- `MONEY_FIELDS` in money.ts is maintained by hand.
