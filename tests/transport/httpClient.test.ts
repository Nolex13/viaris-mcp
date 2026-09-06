import { describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { httpRequest } from '../../src/transport/httpClient.js';

/** Starts a real HTTP server on a free port and returns how to close it. */
function withServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('node:net').AddressInfo).port;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('httpRequest', () => {
  it('returns status, headers (lowercased) and body on a successful JSON response', async () => {
    const srv = await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"model":"VIARIS UNI"}');
    });
    const res = await httpRequest({ host: '127.0.0.1', port: srv.port, method: 'GET', path: '/device' });
    await srv.close();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toBe('{"model":"VIARIS UNI"}');
  });

  it('sends Content-Type and body on writes', async () => {
    let seenBody = '';
    let seenContentType = '';
    const srv = await withServer((req, res) => {
      seenContentType = req.headers['content-type'] ?? '';
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seenBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await httpRequest({
      host: '127.0.0.1', port: srv.port, method: 'PUT',
      path: '/modules/modulator', body: '{"limitPower":4000}',
    });
    await srv.close();
    expect(seenContentType).toBe('application/json; charset=utf-8');
    expect(seenBody).toBe('{"limitPower":4000}');
  });

  it('propagates a non-2xx status without throwing', async () => {
    const srv = await withServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":true}');
    });
    const res = await httpRequest({ host: '127.0.0.1', port: srv.port, method: 'GET', path: '/elements' });
    await srv.close();
    expect(res.status).toBe(404);
    expect(res.body).toBe('{"error":true}');
  });

  it('resolves even if the device never closes the connection', async () => {
    // behavior observed on the real charger: a complete and correct response,
    // but the socket stays open. The low timeout fails the test if this property
    // were ever lost, instead of leaving it hanging.
    const payload = '{"model":"VIARIS UNI"}';
    const lingering: import('node:net').Socket[] = [];
    const srv = await withServer((_req, res) => {
      if (res.socket) lingering.push(res.socket);
      res.socket?.write(
        'HTTP/1.1 200 OK\r\n' +
        'Content-Type: application/json\r\n' +
        `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
        '\r\n' +
        payload,
      );
      // and it stops here: no end(), no close
    });
    const res = await httpRequest({
      host: '127.0.0.1', port: srv.port, method: 'GET', path: '/device', timeoutMs: 1000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe(payload);
    // the socket was deliberately left open: it must be closed by hand, or server.close() would wait
    for (const socket of lingering) socket.destroy();
    await srv.close();
  });

  it('fails with a timeout if the device does not respond', async () => {
    const srv = await withServer(() => { /* never responds */ });
    await expect(
      httpRequest({ host: '127.0.0.1', port: srv.port, method: 'GET', path: '/device', timeoutMs: 200 }),
    ).rejects.toThrow(/timeout/);
    await srv.close();
  });
});
