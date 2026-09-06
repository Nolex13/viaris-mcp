import type { ChargerEntry } from '../registry.js';
import { parseHistoryCsv, type ChargingSession } from './convert.js';

export async function getChargingHistory(
  entry: ChargerEntry,
  limit?: number,
): Promise<ChargingSession[]> {
  const sessions = parseHistoryCsv(await entry.device.getHistoricRaw());
  sessions.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return limit === undefined ? sessions : sessions.slice(0, limit);
}
