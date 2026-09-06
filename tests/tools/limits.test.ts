import { describe, expect, it, vi } from 'vitest';
import { setChargerCurrentLimit, setHomePowerLimit } from '../../src/tools/limits.js';
import { ChargerRegistry } from '../../src/registry.js';
import { DeviceResponseError, ValidationError } from '../../src/transport/errors.js';

function fakeRegistry(
  specs: Array<{ name: string; splMode: number; maxPower?: number; noMaxAmpacity?: boolean }>,
) {
  const calls: Array<{ name: string; kind: string; body: unknown }> = [];
  const registry = new ChargerRegistry(
    Object.fromEntries(specs.map((s, i) => [s.name, `10.0.0.${i + 1}`])),
    vi.fn() as never,
  );
  for (const spec of specs) {
    const entry = registry.resolve(spec.name);
    (entry as { device: unknown }).device = {
      getInfo: async () => ({
        maxPower: spec.maxPower ?? 7360,
        ampacity: 32,
        ...(spec.noMaxAmpacity ? {} : { maxAmpacity: 32 }),
      }),
      getSplCfg: async () => ({ splMode: spec.splMode, splLimitPower: 4000, splCount: specs.length, splIndex: 0 }),
      putModulatorCfg: async (body: unknown) => { calls.push({ name: spec.name, kind: 'modulator', body }); },
      putSplCfg: async (body: unknown) => { calls.push({ name: spec.name, kind: 'spl', body }); },
      putAmpacity: async (a: number) => { calls.push({ name: spec.name, kind: 'ampacity', body: a }); },
    };
  }
  return { registry, calls };
}

describe('setHomePowerLimit', () => {
  it('with a single charger writes to the modulator', async () => {
    const { registry, calls } = fakeRegistry([{ name: 'garage', splMode: 0 }]);
    const result = await setHomePowerLimit(registry, 5000);
    expect(result.appliedTo).toBe('modulator');
    expect(result.warning).toBeUndefined();
    expect(calls).toEqual([{ name: 'garage', kind: 'modulator', body: { limitPower: 5000 } }]);
  });

  it('with an SPL master writes splLimitPower only to the master', async () => {
    const { registry, calls } = fakeRegistry([
      { name: 'garage', splMode: 1 },
      { name: 'outdoor', splMode: 2 },
    ]);
    const result = await setHomePowerLimit(registry, 6000);
    expect(result.appliedTo).toBe('spl-master');
    expect(result.charger).toBe('garage');
    expect(calls).toEqual([{ name: 'garage', kind: 'spl', body: { splLimitPower: 6000 } }]);
  });

  it('with more than one independent charger writes and warns about the risk', async () => {
    const { registry, calls } = fakeRegistry([
      { name: 'garage', splMode: 0 },
      { name: 'outdoor', splMode: 0 },
    ]);
    const result = await setHomePowerLimit(registry, 4000, 'garage');
    expect(result.appliedTo).toBe('modulator');
    expect(result.warning).toMatch(/independent/);
    expect(calls).toHaveLength(1);
  });

  it('accepts a limit beyond the chargers\' maxPower: the household ceiling is not theirs', async () => {
    // limitPower is the household power, not what the charger delivers: a 20 kW
    // contract is legitimate even with chargers that deliver much less.
    // The device does not declare a maximum for this quantity, so there is no ceiling.
    const { registry, calls } = fakeRegistry([
      { name: 'garage', splMode: 1, maxPower: 7360 },
      { name: 'outdoor', splMode: 2, maxPower: 22000 },
    ]);
    const result = await setHomePowerLimit(registry, 20000);
    expect(result.appliedTo).toBe('spl-master');
    expect(result.charger).toBe('garage');
    expect(calls).toEqual([{ name: 'garage', kind: 'spl', body: { splLimitPower: 20000 } }]);
  });

  it('with an orphaned slave (no master) writes and warns', async () => {
    const { registry, calls } = fakeRegistry([{ name: 'garage', splMode: 2 }]);
    const result = await setHomePowerLimit(registry, 5000);
    expect(result.appliedTo).toBe('modulator');
    expect(result.warning).toMatch(/slave/);
    expect(calls).toEqual([{ name: 'garage', kind: 'modulator', body: { limitPower: 5000 } }]);
  });

  it('with two masters writes to the first and warns about the anomaly', async () => {
    const { registry, calls } = fakeRegistry([
      { name: 'garage', splMode: 1 },
      { name: 'outdoor', splMode: 1 },
    ]);
    const result = await setHomePowerLimit(registry, 6000);
    expect(result.appliedTo).toBe('spl-master');
    expect(result.charger).toBe('garage');
    expect(result.warning).toMatch(/master/);
    expect(calls).toEqual([{ name: 'garage', kind: 'spl', body: { splLimitPower: 6000 } }]);
  });

  it('accumulates warnings without overwriting them: orphaned slave among independent chargers', async () => {
    const { registry, calls } = fakeRegistry([
      { name: 'garage', splMode: 2 },
      { name: 'outdoor', splMode: 0 },
      { name: 'garden', splMode: 0 },
    ]);
    const result = await setHomePowerLimit(registry, 5000, 'garage');
    expect(result.warning).toMatch(/slave/);
    expect(result.warning).toMatch(/independent/);
    expect(calls).toHaveLength(1);
  });

  it('rejects a non-positive limit', async () => {
    const { registry } = fakeRegistry([{ name: 'garage', splMode: 0 }]);
    await expect(setHomePowerLimit(registry, 0)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('setChargerCurrentLimit', () => {
  it('writes the ampacity within the device maximum', async () => {
    const { registry, calls } = fakeRegistry([{ name: 'garage', splMode: 0 }]);
    await setChargerCurrentLimit(registry.resolve('garage'), 16);
    expect(calls).toEqual([{ name: 'garage', kind: 'ampacity', body: 16 }]);
  });

  it('throws if the device does not declare maxAmpacity, instead of letting everything through', async () => {
    // without the declared maximum, the comparison amps > undefined would be false and
    // the write would pass with any value: the only protection would vanish silently
    const { registry, calls } = fakeRegistry([{ name: 'garage', splMode: 0, noMaxAmpacity: true }]);
    await expect(setChargerCurrentLimit(registry.resolve('garage'), 200))
      .rejects.toBeInstanceOf(DeviceResponseError);
    expect(calls).toHaveLength(0);
  });

  it('rejects above maxAmpacity, with no hardcoded constants', async () => {
    const { registry, calls } = fakeRegistry([{ name: 'garage', splMode: 0 }]);
    await expect(setChargerCurrentLimit(registry.resolve('garage'), 63))
      .rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });
});
