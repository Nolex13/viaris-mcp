import { describe, expect, it, vi } from 'vitest';
import { Transport } from '../../src/transport/transport.js';
import { DeviceResponseError, DeviceUnreachableError } from '../../src/transport/errors.js';

const ok = (body: string) => ({
  status: 200,
  headers: { 'content-length': String(Buffer.byteLength(body)) },
  body,
});

describe('Transport', () => {
  it('parses the JSON of a successful response', async () => {
    const impl = vi.fn().mockResolvedValue(ok('{"model":"VIARIS UNI"}'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await expect(t.request('h', 'GET', '/device')).resolves.toEqual({ model: 'VIARIS UNI' });
  });

  it('retries GETs until they succeed', async () => {
    const impl = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(ok('{"ok":true}'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await expect(t.request('h', 'GET', '/device')).resolves.toEqual({ ok: true });
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('also retries PUTs, which are idempotent', async () => {
    const impl = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(ok('{}'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await t.request('h', 'PUT', '/modules/modulator', { limitPower: 4000 });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry POSTs: they would create a duplicate task', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await expect(t.request('h', 'POST', '/modules/scheduler/elements/mennekes', {}))
      .rejects.toBeInstanceOf(DeviceUnreachableError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('retries DELETEs: the id is chosen by the caller, so repeating it is harmless', async () => {
    const impl = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(ok('{}'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await t.request('h', 'DELETE', '/modules/scheduler/elements/mennekes', { tasks: [{ id: 1 }] });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('throws DeviceUnreachableError after exhausting the retries', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const t = new Transport({ requestImpl: impl, retries: 2, baseDelayMs: 1 });
    await expect(t.request('h', 'GET', '/device')).rejects.toBeInstanceOf(DeviceUnreachableError);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('throws DeviceResponseError on a non-2xx status without retrying', async () => {
    const impl = vi.fn().mockResolvedValue({ status: 404, headers: {}, body: '{"error":true}' });
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await expect(t.request('h', 'GET', '/elements')).rejects.toBeInstanceOf(DeviceResponseError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('throws DeviceResponseError on malformed JSON', async () => {
    const impl = vi.fn().mockResolvedValue(ok('non-json'));
    const t = new Transport({ requestImpl: impl, baseDelayMs: 1 });
    await expect(t.request('h', 'GET', '/device')).rejects.toBeInstanceOf(DeviceResponseError);
  });
});
