import type { ChargerEntry } from '../registry.js';
import { ValidationError } from '../transport/errors.js';

export async function setSolarConfig(
  entry: ChargerEntry,
  cfg: { enabled: boolean; priority?: number },
): Promise<{ charger: string; enabled: boolean; priority: number | null }> {
  const payload = cfg.priority === undefined
    ? { enabled: cfg.enabled }
    : { enabled: cfg.enabled, priority: cfg.priority };
  await entry.device.putSolarCfg(payload);
  return { charger: entry.name, enabled: cfg.enabled, priority: cfg.priority ?? null };
}

/** The firmware only accepts these three levels (item_lowConsumption in index.js). */
const LED_LEVELS = [0, 50, 100] as const;

export async function setLedBrightness(
  entry: ChargerEntry,
  intensity: 0 | 50 | 100,
): Promise<{ charger: string; intensity: number }> {
  if (!LED_LEVELS.includes(intensity as (typeof LED_LEVELS)[number])) {
    throw new ValidationError(`invalid LED intensity: ${intensity}. Allowed values: 0, 50, 100`);
  }
  await entry.device.putHmiCfg({ ledsIntensity: intensity });
  return { charger: entry.name, intensity };
}

export async function setDeviceTime(
  entry: ChargerEntry,
  opts: { epochSeconds?: number; timezone?: string; timezoneCode?: number },
): Promise<{ charger: string; localtime: string; timezone: string | null }> {
  if ((opts.timezone === undefined) !== (opts.timezoneCode === undefined)) {
    throw new ValidationError(
      'timezone and timezoneCode must be provided together: the firmware requires both',
    );
  }

  const seconds = opts.epochSeconds ?? Math.floor(Date.now() / 1000);
  await entry.device.putLocaltime(seconds);

  if (opts.timezone !== undefined && opts.timezoneCode !== undefined) {
    await entry.device.putTimezone(opts.timezone, opts.timezoneCode);
  }

  return {
    charger: entry.name,
    localtime: new Date(seconds * 1000).toISOString(),
    timezone: opts.timezone ?? null,
  };
}
