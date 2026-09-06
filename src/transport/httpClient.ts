import * as http from 'node:http';

export interface HttpClientResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpClientOptions {
  host: string;
  port?: number;
  method: string;
  path: string;
  body?: string;
  timeoutMs?: number;
}

/** Headers with multiple values, or none, are flattened into a single string. */
function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flat[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

export function httpRequest(opts: HttpClientOptions): Promise<HttpClientResponse> {
  const { host, port = 80, method, path, body, timeoutMs = 15000 } = opts;

  return new Promise<HttpClientResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    const req = http.request({ host, port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode;
        // Node always sets statusCode before this callback runs. If it ever
        // didn't, a fallback of 0 would masquerade as a plausible status
        // instead of the impossible case it actually is: better to say so.
        if (status === undefined) {
          settle(() => reject(new Error(`response with no status line from ${host}${path}`)));
          return;
        }
        settle(() => resolve({
          status,
          headers: flattenHeaders(res.headers),
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      res.on('error', (err) => settle(() => reject(err)));
    });

    req.on('error', (err) => settle(() => reject(err)));

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      settle(() => reject(new Error(`timeout after ${timeoutMs}ms towards ${host}${path}`)));
    });

    req.end(body ?? '');
  });
}
