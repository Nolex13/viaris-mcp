import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getChargingHistory } from '../../src/tools/history.js';
import type { ChargerEntry } from '../../src/registry.js';

function entryWithHistory(csv: string): ChargerEntry {
  return { name: 'garage', host: '10.0.0.1', device: { getHistoricRaw: async () => csv } as never };
}

const realCsv = JSON.parse(
  JSON.parse(readFileSync('tests/fixtures/modulator-historic.json', 'utf8')).body,
).body as string;

describe('getChargingHistory', () => {
  it('parses the real history into sessions', async () => {
    const sessions = await getChargingHistory(entryWithHistory(realCsv));
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty('energyWh');
    expect(sessions[0]).toHaveProperty('durationMin');
  });

  it('returns the most recent sessions first', async () => {
    const sessions = await getChargingHistory(entryWithHistory(realCsv));
    const times = sessions.map((s) => Date.parse(s.start));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('honors the requested limit', async () => {
    expect(await getChargingHistory(entryWithHistory(realCsv), 3)).toHaveLength(3);
  });

  it('returns an empty array for an empty history', async () => {
    expect(await getChargingHistory(entryWithHistory(''))).toEqual([]);
  });
});
