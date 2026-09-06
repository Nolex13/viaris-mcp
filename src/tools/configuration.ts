import type { ChargerEntry } from '../registry.js';

export type SplMode = 'independent' | 'master' | 'slave' | 'unknown';

export function splModeToString(mode: number): SplMode {
  if (mode === 0) return 'independent';
  if (mode === 1) return 'master';
  if (mode === 2) return 'slave';
  return 'unknown';
}

export interface ChargerConfiguration {
  device: { model: string; serial: string; firmware: string; ampacity: number; maxAmpacity: number; maxPower: number };
  power: { homeLimit: number; limitByPhase: number[]; splMode: SplMode; splLimitPower: number; splCount: number };
  solar: { enabled: boolean; maxFvPower: number; priority: number };
  leds: { intensity: number };
  /**
   * `driftSeconds` is the interesting half: charging windows fire on the
   * device's own clock, so a charger that is hours out will run a schedule at
   * the wrong time while reporting it correctly. Positive means the device is
   * ahead of this machine.
   */
  clock: { deviceTime: string; driftSeconds: number };
  /**
   * Whether charging is permitted outside the scheduled windows. Note this
   * governs whether a session may begin, not whether one in progress stops.
   */
  charging: { allowedOutsideSchedule: boolean };
  readOnly: { ocpp: unknown; modbus: unknown; mqtt: unknown };
}

export async function getConfiguration(entry: ChargerEntry): Promise<ChargerConfiguration> {
  const { device } = entry;
  const [info, modulator, spl, solar, hmi, localtime, scheduler, ocpp, modbus, mqtt] = await Promise.all([
    device.getInfo(), device.getModulatorCfg(), device.getSplCfg(),
    device.getSolarCfg(), device.getHmiCfg(), device.getLocaltime(),
    device.getSchedulerElements(),
    device.getOcppCfg(), device.getModbusCfg(), device.getMqttStat(),
  ]);

  return {
    device: {
      model: info.model, serial: info.serial, firmware: info.fwv,
      ampacity: info.ampacity, maxAmpacity: info.maxAmpacity, maxPower: info.maxPower,
    },
    power: {
      homeLimit: modulator.limitPower,
      limitByPhase: modulator.limitPowerByPhase,
      splMode: splModeToString(spl.splMode),
      splLimitPower: spl.splLimitPower,
      splCount: spl.splCount,
    },
    solar: { enabled: solar.enabled, maxFvPower: solar.maxFvPower, priority: solar.priority },
    leds: { intensity: hmi.ledsIntensity },
    clock: {
      deviceTime: new Date(localtime * 1000).toISOString(),
      driftSeconds: localtime - Math.floor(Date.now() / 1000),
    },
    charging: { allowedOutsideSchedule: scheduler[0]?.data.cfg.defaultState === 1 },
    readOnly: { ocpp, modbus, mqtt },
  };
}
