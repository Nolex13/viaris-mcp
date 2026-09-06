import { describe, expect, it, vi } from 'vitest';
import { ChargerRegistry, loadChargers } from '../src/registry.js';
import { ValidationError } from '../src/transport/errors.js';

const request = vi.fn();

describe('loadChargers', () => {
  it('reads a map of chargers from VIARIS_CHARGERS', () => {
    expect(loadChargers({ VIARIS_CHARGERS: '{"garage":"192.168.1.100"}' } as never))
      .toEqual({ garage: '192.168.1.100' });
  });

  it('accepts the VIARIS_HOST shortcut for a single charger', () => {
    expect(loadChargers({ VIARIS_HOST: '192.168.1.100' } as never))
      .toEqual({ default: '192.168.1.100' });
  });

  it('throws if no charger is configured', () => {
    expect(() => loadChargers({} as never)).toThrow(ValidationError);
  });

  it('throws if VIARIS_CHARGERS is not valid JSON', () => {
    expect(() => loadChargers({ VIARIS_CHARGERS: 'non-json' } as never)).toThrow(ValidationError);
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
