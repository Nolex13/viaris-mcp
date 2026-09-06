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
  readOnly: { ocpp: unknown; modbus: unknown; mqtt: unknown };
}

export async function getConfiguration(entry: ChargerEntry): Promise<ChargerConfiguration> {
  const { device } = entry;
  const [info, modulator, spl, solar, hmi, ocpp, modbus, mqtt] = await Promise.all([
    device.getInfo(), device.getModulatorCfg(), device.getSplCfg(),
    device.getSolarCfg(), device.getHmiCfg(),
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
    readOnly: { ocpp, modbus, mqtt },
  };
}
