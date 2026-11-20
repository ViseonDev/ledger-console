import type { z } from 'zod';

import { AccountList, EntryPage, Payment, PaymentList } from '@/contract/extensions';
import { Account, Balance, Problem, Readiness, Transaction } from '@/contract/schemas';
import { parseLedgerJson } from './money';

/** The ledger answered with an RFC 9457 problem document (or something like one). */
export class LedgerProblem extends Error {
  readonly problem: Problem;
  readonly httpStatus: number;

  constructor(problem: Problem, httpStatus: number) {
    super(problem.detail ?? problem.title);
    this.name = 'LedgerProblem';
    this.problem = problem;
    this.httpStatus = httpStatus;
  }
}

/** The response parsed, but didn't match the schema. */
export class ContractViolation extends Error {
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`${path} did not match the contract: ${issues.join('; ')}`);
    this.name = 'ContractViolation';
    this.path = path;
    this.issues = issues;
  }
}

/** An extension endpoint this ledger doesn't serve. */
export class Unsupported extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`${path} is not served by this ledger`);
    this.name = 'Unsupported';
    this.path = path;
  }
}

interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface EntriesQuery {
  after?: number | null;
  limit?: number;
}

export class LedgerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, fetchImpl }: ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    // bound, or the browser throws "Illegal invocation"
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // ledger-core

  readiness() {
    return this.get('/readyz', Readiness);
  }

  /** ledger-core looks accounts up by code, not id. */
  accountByCode(code: string) {
    return this.get(`/v1/accounts/${codeSegment(code)}`, Account);
  }

  balance(accountId: string, authoritative = false) {
    const query = authoritative ? '?authoritative=true' : '';
    return this.get(`/v1/accounts/${accountId}/balance${query}`, Balance);
  }

  transaction(id: string) {
    return this.get(`/v1/transactions/${id}`, Transaction);
  }

  // extensions (fixture only for now)

  accounts({ limit = 100 }: { limit?: number } = {}) {
    return this.get(`/v1/accounts?limit=${limit}`, AccountList, { extension: true });
  }

  entries(accountId: string, { after, limit = 200 }: EntriesQuery = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (after != null) query.set('after', String(after));

    return this.get(`/v1/accounts/${accountId}/entries?${query}`, EntryPage, { extension: true });
  }

  payments({ limit = 50 }: { limit?: number } = {}) {
    return this.get(`/v1/payments?limit=${limit}`, PaymentList, { extension: true });
  }

  payment(id: string) {
    return this.get(`/v1/payments/${id}`, Payment, { extension: true });
  }

  private async get<S extends z.ZodType>(
    path: string,
    schema: S,
    { extension = false } = {},
  ): Promise<z.output<S>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
    });
    // not response.json(): that's JSON.parse, which is what rounds the money
    const text = await response.text();

    if (!response.ok) {
      const isProblem = response.headers.get('content-type')?.includes('problem+json') ?? false;

      // chi answers unknown routes with a plain-text 404 (or 405 when only
      // POST exists), which is how we tell "no such endpoint" from "no such row"
      if (extension && !isProblem && (response.status === 404 || response.status === 405)) {
        throw new Unsupported(path);
      }

      throw new LedgerProblem(problemFrom(text, response), response.status);
    }

    const result = schema.safeParse(parseLedgerJson(text));

    if (!result.success) {
      throw new ContractViolation(
        path,
        result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }

    return result.data;
  }
}

// chi doesn't decode path params, so an encoded colon never reaches
// ledger-core as a colon. Colons are fine in a path segment anyway.
export function codeSegment(code: string): string {
  return encodeURIComponent(code).replace(/%3A/gi, ':');
}

function problemFrom(text: string, response: Response): Problem {
  try {
    const parsed = Problem.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // not JSON, e.g. an HTML error page from a proxy
  }

  return {
    type: 'about:blank',
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
  };
}
