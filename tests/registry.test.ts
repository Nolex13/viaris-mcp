import { describe, expect, it, vi } from 'vitest';
import { ChargerRegistry, loadChargers } from '../src/registry.js';
import { ValidationError } from '../src/transport/errors.js';

const request = vi.fn();

describe('loadChargers', () => {
  it('reads a single charger', () => {
    expect(loadChargers({ VIARIS_CHARGERS: 'garage=192.168.1.100' } as never))
      .toEqual({ garage: '192.168.1.100' });
  });

  it('reads several chargers separated by commas', () => {
    expect(loadChargers({ VIARIS_CHARGERS: 'garage=192.168.1.100,outdoor=192.168.1.101' } as never))
      .toEqual({ garage: '192.168.1.100', outdoor: '192.168.1.101' });
  });

  it('tolerates spaces around names, addresses and separators', () => {
    expect(loadChargers({ VIARIS_CHARGERS: ' garage = 192.168.1.100 , outdoor = 192.168.1.101 ' } as never))
      .toEqual({ garage: '192.168.1.100', outdoor: '192.168.1.101' });
  });

  it('ignores a trailing comma', () => {
    expect(loadChargers({ VIARIS_CHARGERS: 'garage=192.168.1.100,' } as never))
      .toEqual({ garage: '192.168.1.100' });
  });

  it('keeps an address that contains an equals sign', () => {
    expect(loadChargers({ VIARIS_CHARGERS: 'garage=host=weird' } as never))
      .toEqual({ garage: 'host=weird' });
  });

  it('throws when nothing is configured', () => {
    expect(() => loadChargers({} as never)).toThrow(ValidationError);
  });

  it('throws when the value is only whitespace', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: '   ' } as never)).toThrow(ValidationError);
  });

  it('throws on an entry without an address', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: '192.168.1.100' } as never))
      .toThrow(/name=address/);
  });

  it('throws on a missing name', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: '=192.168.1.100' } as never))
      .toThrow(ValidationError);
  });

  it('throws on a missing address', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: 'garage=' } as never))
      .toThrow(/garage/);
  });

  // Keeping the last one silently would leave a charger configured but
  // unreachable by name, with nothing to say why.
  it('throws when the same name appears twice', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: 'garage=10.0.0.1,garage=10.0.0.2' } as never))
      .toThrow(/more than once/);
  });

  it('names the expected format when nothing is configured', () => {
    expect(() => loadChargers({} as never)).toThrow(/VIARIS_CHARGERS/);
  });
});

describe('ChargerRegistry', () => {
  it('with a single charger resolves it without a name', () => {
    const r = new ChargerRegistry({ garage: '192.168.1.100' }, request as never);
    expect(r.resolve().name).toBe('garage');
    expect(r.resolve().host).toBe('192.168.1.100');
  });

  it('with more than one charger requires the name', () => {
    const r = new ChargerRegistry({ garage: '10.0.0.1', outdoor: '10.0.0.2' }, request as never);
    expect(() => r.resolve()).toThrow(ValidationError);
    expect(r.resolve('outdoor').host).toBe('10.0.0.2');
  });

  it('lists the available names in the error message', () => {
    const r = new ChargerRegistry({ garage: '10.0.0.1', outdoor: '10.0.0.2' }, request as never);
    expect(() => r.resolve('basement')).toThrow(/garage/);
  });

  it('all() returns all configured chargers', () => {
    const r = new ChargerRegistry({ a: '10.0.0.1', b: '10.0.0.2' }, request as never);
    expect(r.all().map((c) => c.name).sort()).toEqual(['a', 'b']);
  });

  it('reuses the same ViarisDevice instance for the same name', () => {
    const r = new ChargerRegistry({ garage: '10.0.0.1' }, request as never);
    expect(r.resolve('garage').device).toBe(r.resolve('garage').device);
  });
});
