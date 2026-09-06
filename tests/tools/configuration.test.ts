import { describe, expect, it } from 'vitest';
import { getConfiguration } from '../../src/tools/configuration.js';
import type { ChargerEntry } from '../../src/registry.js';

/** Seconds the fake device's clock is away from this machine's. */
function entryWithClockDrift(driftSeconds: number): ChargerEntry {
  return {
    ...entry,
    device: {
      ...(entry.device as unknown as Record<string, unknown>),
      getLocaltime: async () => Math.floor(Date.now() / 1000) + driftSeconds,
    } as never,
  };
}

const entry: ChargerEntry = {
  name: 'garage',
  host: '10.0.0.1',
  device: {
    getInfo: async () => ({ model: 'VIARIS UNI', serial: 'EV1', fwv: '7.2.53',
      ampacity: 32, maxAmpacity: 32, maxPower: 7360 }),
    getModulatorCfg: async () => ({ limitPower: 4000, limitPowerByPhase: [4000, 4000, 4000] }),
    getSplCfg: async () => ({ splMode: 0, splLimitPower: 4000, splCount: 1, splIndex: 0 }),
    getSolarCfg: async () => ({ enabled: false, maxFvPower: 1600, priority: 1 }),
    getHmiCfg: async () => ({ ledsIntensity: 100 }),
    getLocaltime: async () => Math.floor(Date.now() / 1000),
    getOcppCfg: async () => ({ enabled: true }),
    getModbusCfg: async () => ({ baud: 9600 }),
    getMqttStat: async () => ({ connected: false }),
  } as never,
};

describe('getConfiguration', () => {
  it('collects the configuration into thematic areas', async () => {
    const cfg = await getConfiguration(entry);
    expect(cfg.device.model).toBe('VIARIS UNI');
    expect(cfg.power.homeLimit).toBe(4000);
    expect(cfg.solar.enabled).toBe(false);
    expect(cfg.leds.intensity).toBe(100);
  });

  it('groups under readOnly what cannot be modified via MCP', async () => {
    const cfg = await getConfiguration(entry);
    expect(cfg.readOnly).toHaveProperty('ocpp');
    expect(cfg.readOnly).toHaveProperty('modbus');
    expect(cfg.readOnly).toHaveProperty('mqtt');
  });

  it('exposes the SPL mode, which determines how the limit is written', async () => {
    const cfg = await getConfiguration(entry);
    expect(cfg.power.splMode).toBe('independent');
  });
});

describe('getConfiguration clock', () => {
  it('reports the device clock as an ISO timestamp', async () => {
    const { clock } = await getConfiguration(entry);
    expect(clock.deviceTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reports no meaningful drift when the clocks agree', async () => {
    const { clock } = await getConfiguration(entry);
    expect(Math.abs(clock.driftSeconds)).toBeLessThanOrEqual(1);
  });

  // A charging window fires on the device's own clock, so a charger that is
  // hours out runs the schedule at the wrong time while reporting it correctly.
  it('surfaces a device clock that is hours behind', async () => {
    const { clock } = await getConfiguration(entryWithClockDrift(-48065));
    expect(clock.driftSeconds).toBeLessThan(-48000);
  });

  it('surfaces a device clock that is ahead', async () => {
    const { clock } = await getConfiguration(entryWithClockDrift(3600));
    expect(clock.driftSeconds).toBeGreaterThan(3500);
  });
});
