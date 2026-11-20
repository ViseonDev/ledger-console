import { createServer, type ServerResponse } from 'node:http';

import { Ledger } from './ledger.ts';
import { route } from './routes.ts';

const port = Number(process.env.FIXTURE_PORT ?? 8022);
const seed = Number(process.env.FIXTURE_SEED ?? 20_260_914);
const writeEvery = Number(process.env.FIXTURE_ENTRY_INTERVAL_MS ?? 1500);

const ledger = new Ledger(seed);
ledger.generate();

if (writeEvery > 0) {
  // unref so the timer doesn't keep the process alive on SIGTERM
  setInterval(() => ledger.postRandom(), writeEvery).unref();
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture');

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  // read-only, like the console
  if (request.method !== 'GET') {
    problem(response, 405, 'Method not allowed', 'the fixture only serves reads');
    return;
  }

  const result = route(ledger, url);

  if (result === null) {
    // like chi's default: plain text, no problem document
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 page not found\n');
    return;
  }

  if ('problem' in result) {
    problem(response, result.status, result.problem.title, result.problem.detail, result.problem.type, url.pathname);
    return;
  }

  response.writeHead(200, { 'Content-Type': 'application/json' }).end(result.body);
});

function problem(
  response: ServerResponse,
  status: number,
  title: string,
  detail?: string,
  type = 'about:blank',
  instance?: string,
): void {
  response
    .writeHead(status, { 'Content-Type': 'application/problem+json' })
    .end(JSON.stringify({ type, title, status, detail, instance }));
}

server.listen(port, () => {
  console.log(
    `fixture ledger on :${port} (seed ${seed}, ${ledger.accounts.length} accounts, ${ledger.entryCount} entries)`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
