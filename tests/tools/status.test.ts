import { describe, expect, it } from 'vitest';
import { getChargerStatus } from '../../src/tools/status.js';
import { isChargerError, perCharger, perChargerIsError } from '../../src/tools/aggregate.js';
import { ValidationError } from '../../src/transport/errors.js';
import type { ChargerEntry } from '../../src/registry.js';

function fakeEntry(name: string, overrides: Record<string, unknown> = {}): ChargerEntry {
  const device = {
    getEvsmElements: async () => [
      { name: 'mennekes', stat: { event: 1, state: 5, idCharge: 7, user: '', localtime: 0 } },
    ],
    getModulatorStat: async () => ({
      totalPower: 4200, evsePower: 3600, homePower: 600,
      selectorPower: 7360, splDetected: true, mbusDetected: false,
    }),
    getInfo: async () => ({ maxPower: 7360, elements: [{ name: 'mennekes' }] }),
    getModulatorCfg: async () => ({ limitPower: 4000 }),
    ...overrides,
  };
  return { name, host: '10.0.0.1', device: device as never };
}

describe('getChargerStatus', () => {
  it('aggregates state, power and limits into a single response', async () => {
    await expect(getChargerStatus(fakeEntry('garage'))).resolves.toEqual({
      charging: { connector: 'mennekes', state: 'charging', sessionId: 7, user: null },
      power: { home: 600, car: 3600, total: 4200, unit: 'W' },
      limits: { homeLimit: 4000, chargerMax: 7360 },
    });
  });

  it('with two connectors requires the name instead of silently picking one', async () => {
    const entry = fakeEntry('garage', {
      getInfo: async () => ({ maxPower: 7360, elements: [{ name: 'mennekes' }, { name: 'schuko' }] }),
    });
    await expect(getChargerStatus(entry)).rejects.toBeInstanceOf(ValidationError);
    await expect(getChargerStatus(entry, 'mennekes')).resolves.toHaveProperty(
      'charging.connector', 'mennekes');
  });

  it('exposes the state as a string, never as a code', async () => {
    const entry = fakeEntry('garage', {
      getEvsmElements: async () => [
        { name: 'mennekes', stat: { event: 1, state: 1, idCharge: 0, user: '', localtime: 0 } },
      ],
    });
    const status = await getChargerStatus(entry);
    expect(status.charging.state).toBe('free');
  });

  it('calls getInfo() only once (the device only holds one connection at a time)', async () => {
    let getInfoCalls = 0;
    const entry = fakeEntry('garage', {
      getInfo: async () => {
        getInfoCalls += 1;
        return { maxPower: 7360, elements: [{ name: 'mennekes' }] };
      },
    });
    await getChargerStatus(entry);
    expect(getInfoCalls).toBe(1);
  });

  it('with an ambiguous connector it fails immediately, without querying the rest of the device', async () => {
    let evsmCalls = 0;
    let statCalls = 0;
    let cfgCalls = 0;
    const entry = fakeEntry('garage', {
      getInfo: async () => ({ maxPower: 7360, elements: [{ name: 'mennekes' }, { name: 'schuko' }] }),
      getEvsmElements: async () => {
        evsmCalls += 1;
        return [{ name: 'mennekes', stat: { event: 1, state: 5, idCharge: 7, user: '', localtime: 0 } }];
      },
      getModulatorStat: async () => {
        statCalls += 1;
        return { totalPower: 4200, evsePower: 3600, homePower: 600, selectorPower: 7360, splDetected: true, mbusDetected: false };
      },
      getModulatorCfg: async () => {
        cfgCalls += 1;
        return { limitPower: 4000 };
      },
    });
    await expect(getChargerStatus(entry)).rejects.toBeInstanceOf(ValidationError);
    expect(evsmCalls).toBe(0);
    expect(statCalls).toBe(0);
    expect(cfgCalls).toBe(0);
  });

  it('with a nonexistent connector it fails immediately, without querying the rest of the device', async () => {
    let evsmCalls = 0;
    let statCalls = 0;
    let cfgCalls = 0;
    const entry = fakeEntry('garage', {
      getEvsmElements: async () => {
        evsmCalls += 1;
        return [{ name: 'mennekes', stat: { event: 1, state: 5, idCharge: 7, user: '', localtime: 0 } }];
      },
      getModulatorStat: async () => {
        statCalls += 1;
        return { totalPower: 4200, evsePower: 3600, homePower: 600, selectorPower: 7360, splDetected: true, mbusDetected: false };
      },
      getModulatorCfg: async () => {
        cfgCalls += 1;
        return { limitPower: 4000 };
      },
    });
    await expect(getChargerStatus(entry, 'nonexistent')).rejects.toBeInstanceOf(ValidationError);
    expect(evsmCalls).toBe(0);
    expect(statCalls).toBe(0);
    expect(cfgCalls).toBe(0);
  });

  it('reports the user when the session has one', async () => {
    const entry = fakeEntry('garage', {
      getEvsmElements: async () => [
        { name: 'mennekes', stat: { event: 1, state: 5, idCharge: 7, user: 'alex', localtime: 0 } },
      ],
    });
    expect((await getChargerStatus(entry)).charging.user).toBe('alex');
  });
});

describe('perCharger', () => {
  it('returns a map by name', async () => {
    const result = await perCharger(
      [fakeEntry('garage'), fakeEntry('outdoor')],
      async (e) => e.name.toUpperCase(),
    );
    expect(result).toEqual({ garage: 'GARAGE', outdoor: 'OUTDOOR' });
  });

  it('an unreachable charger does not make the others fail', async () => {
    const result = await perCharger(
      [fakeEntry('garage'), fakeEntry('broken')],
      async (e) => {
        if (e.name === 'broken') throw new Error('charger 10.0.0.1 unreachable');
        return 'ok';
      },
    );
    expect(result.garage).toBe('ok');
    expect(result.broken).toEqual({ error: 'charger 10.0.0.1 unreachable' });
  });
});

describe('isChargerError', () => {
  it('recognizes an error entry', () => {
    expect(isChargerError({ error: 'charger unreachable' })).toBe(true);
  });

  it('does not mistake a normal data object for an error', () => {
    expect(isChargerError({ charging: { connector: 'mennekes' } })).toBe(false);
  });
});

describe('perChargerIsError', () => {
  it('marks as error a map where all entries have failed', () => {
    const result = {
      garage: { error: 'unreachable' },
      outdoor: { error: 'timeout' },
    };
    expect(perChargerIsError(result)).toBe(true);
  });

  it('does not mark as error a mixed case: legitimate partial success', () => {
    const result = {
      garage: { charging: { connector: 'mennekes' } },
      outdoor: { error: 'timeout' },
    };
    expect(perChargerIsError(result)).toBe(false);
  });

  it('does not mark an empty map as error', () => {
    expect(perChargerIsError({})).toBe(false);
  });
});
