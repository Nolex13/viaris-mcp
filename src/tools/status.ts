import type { ChargerEntry } from '../registry.js';
import { stateToString, type ChargingState } from './convert.js';
import { chooseElement } from './element.js';
import { DeviceResponseError } from '../transport/errors.js';

export interface ChargerStatus {
  charging: { connector: string; state: ChargingState; sessionId: number; user: string | null };
  power: { home: number; car: number; total: number; unit: 'W' };
  limits: { homeLimit: number; chargerMax: number };
}

export async function getChargerStatus(
  entry: ChargerEntry,
  element?: string,
): Promise<ChargerStatus> {
  const { device } = entry;

  // getInfo() first and alone: validates the connector right away, before
  // spending three more calls against a device that only holds one connection at a time.
  const info = await device.getInfo();
  const connector = chooseElement(entry.name, info.elements.map((e) => e.name), element);

  // the remaining calls are serialized by the transport towards the same host:
  // Promise.all does not increase the load on the device, it still queues up.
  const [elements, stat, cfg] = await Promise.all([
    device.getEvsmElements(),
    device.getModulatorStat(),
    device.getModulatorCfg(),
  ]);

  const found = elements.find((e) => e.name === connector);
  if (!found) {
    throw new DeviceResponseError(
      entry.host, '/modules/evsm/elements', 200,
      `connector "${connector}" does not appear among the evsm elements`,
    );
  }

  return {
    charging: {
      connector,
      state: stateToString(found.stat.state),
      sessionId: found.stat.idCharge,
      user: found.stat.user === '' ? null : found.stat.user,
    },
    power: {
      home: stat.homePower,
      car: stat.evsePower,
      total: stat.totalPower,
      unit: 'W',
    },
    limits: { homeLimit: cfg.limitPower, chargerMax: info.maxPower },
  };
}
