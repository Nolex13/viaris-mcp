import { httpRequest } from './httpClient.js';
import { DeviceResponseError, DeviceUnreachableError } from './errors.js';

export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE';

/**
 * Methods that are safe to repeat without extra side effects. POST is
 * excluded: it creates a scheduler task, and retrying after a lost response
 * would create a duplicate.
 */
const RETRYABLE: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

export interface TransportOptions {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  requestImpl?: typeof httpRequest;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Transport {
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly impl: typeof httpRequest;

  constructor(opts: TransportOptions = {}) {
    this.retries = opts.retries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 300;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.impl = opts.requestImpl ?? httpRequest;
  }

  request = async (host: string, method: HttpMethod, path: string, body?: unknown): Promise<unknown> => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const attempts = RETRYABLE.has(method) ? this.retries : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await this.impl({
          host, method, path, body: payload, timeoutMs: this.timeoutMs,
        });

        if (res.status < 200 || res.status >= 300) {
          throw new DeviceResponseError(host, path, res.status, res.body.slice(0, 200));
        }
        if (res.body.trim() === '') return undefined;
        try {
          return JSON.parse(res.body);
        } catch {
          throw new DeviceResponseError(host, path, res.status, 'body could not be parsed as JSON');
        }
      } catch (err) {
        // a response that was received but is wrong is not retried: the device is fine, it's the content that's off
        if (err instanceof DeviceResponseError) throw err;
        lastError = err;
        if (attempt < attempts - 1) await sleep(this.baseDelayMs * 2 ** attempt);
      }
    }
    throw new DeviceUnreachableError(host, lastError);
  };
}
