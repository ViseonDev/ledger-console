import { describe, expect, it, vi } from 'vitest';

import { ContractViolation, LedgerClient, LedgerProblem, Unsupported } from './ledger';

const ACCOUNT = {
  id: '6b0b5d2e-1c3a-5f4e-8d9b-2a7c6e5f4d3b',
  code: 'liabilities:customer:wallet:cus_demo_0001',
  name: 'Demo customer 0001 wallet',
  type: 'LIABILITY',
  currency: 'EUR',
  allow_negative: false,
  status: 'ACTIVE',
};

function reply(body: string, init: ResponseInit = {}) {
  return vi.fn(async (_url: string | URL | Request) => new Response(body, { status: 200, ...init }));
}

function clientWith(fetchImpl: typeof fetch) {
  return new LedgerClient({ baseUrl: 'http://ledger/', fetchImpl });
}

describe('responses are validated at the boundary', () => {
  it('returns the parsed account', async () => {
    const client = clientWith(reply(JSON.stringify(ACCOUNT)));

    await expect(client.accountByCode(ACCOUNT.code)).resolves.toMatchObject({ id: ACCOUNT.id });
  });

  it('url-encodes the account code', async () => {
    const fetchImpl = reply(JSON.stringify(ACCOUNT));

    await clientWith(fetchImpl).accountByCode('a:b c');

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://ledger/v1/accounts/a%3Ab%20c');
  });

  it('rejects a payload with a missing field', async () => {
    const { status: _status, ...partial } = ACCOUNT;
    const client = clientWith(reply(JSON.stringify(partial)));

    await expect(client.accountByCode(ACCOUNT.code)).rejects.toThrow(ContractViolation);
  });

  it('names the bad field and the path in the error', async () => {
    const client = clientWith(reply(JSON.stringify({ ...ACCOUNT, type: 'SIDEWAYS' })));

    await expect(client.accountByCode(ACCOUNT.code)).rejects.toThrow(
      /\/v1\/accounts\/.* did not match the contract: type:/,
    );
  });

  it('keeps a large balance exact end to end', async () => {
    const body =
      `{"account_id":"${ACCOUNT.id}","currency":"EUR","debits":0,` +
      `"credits":9007199254740993,"balance":9007199254740993,"authoritative":true}`;

    const balance = await clientWith(reply(body)).balance(ACCOUNT.id, true);

    expect(balance.balance).toBe(9_007_199_254_740_993n);
  });
});

describe('errors', () => {
  it('turns a problem document into a LedgerProblem', async () => {
    const problem = {
      type: 'https://ledger.local/problems/account-not-found',
      title: 'Account not found',
      status: 404,
      detail: 'ledger: account not found',
      request_id: 'abc',
    };
    const client = clientWith(
      reply(JSON.stringify(problem), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    const error = await client.accountByCode('x:y').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LedgerProblem);
    expect((error as LedgerProblem).message).toBe('ledger: account not found');
    expect((error as LedgerProblem).problem.request_id).toBe('abc');
  });

  it('copes with an HTML error page', async () => {
    const client = clientWith(
      reply('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );

    await expect(client.accountByCode('x:y')).rejects.toThrow('Bad Gateway');
  });

  it('reports a missing extension endpoint as Unsupported', async () => {
    const client = clientWith(reply('404 page not found\n', { status: 404 }));

    await expect(client.entries(ACCOUNT.id)).rejects.toThrow(Unsupported);
  });

  it('treats 405 on the list route as Unsupported too', async () => {
    // ledger-core has POST /v1/accounts, so GET there is a 405
    const client = clientWith(reply('', { status: 405 }));

    await expect(client.accounts()).rejects.toThrow(Unsupported);
  });

  it('still reports a real 404 from an extension endpoint as a problem', async () => {
    const client = clientWith(
      reply(JSON.stringify({ title: 'Account not found', status: 404 }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    await expect(client.entries(ACCOUNT.id)).rejects.toThrow(LedgerProblem);
  });

  it('never reports a core endpoint as Unsupported', async () => {
    const client = clientWith(reply('404 page not found', { status: 404 }));

    await expect(client.transaction(ACCOUNT.id)).rejects.toThrow(LedgerProblem);
  });
});

describe('entries', () => {
  const empty = JSON.stringify({ entries: [], next_cursor: null });

  it('sends no cursor for the first page', async () => {
    const fetchImpl = reply(empty);
    await clientWith(fetchImpl).entries(ACCOUNT.id);

    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('after=');
  });

  it('sends the cursor for later pages, including 0', async () => {
    const fetchImpl = reply(empty);
    const client = clientWith(fetchImpl);

    await client.entries(ACCOUNT.id, { after: 42, limit: 10 });
    await client.entries(ACCOUNT.id, { after: 0 });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('after=42');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('limit=10');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('after=0');
  });
});
