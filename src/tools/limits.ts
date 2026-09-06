import type { ChargerEntry, ChargerRegistry } from '../registry.js';
import { DeviceResponseError, ValidationError } from '../transport/errors.js';

export interface LimitResult {
  charger: string;
  limitW: number;
  appliedTo: 'modulator' | 'spl-master';
  warning?: string;
}

/**
 * Coordination between chargers belongs to the firmware (the SPL module), not
 * to us. Here we only detect how the household electrical supply is
 * configured and write to wherever the value belongs:
 *
 *  - a single charger           -> limitPower on the modulator
 *  - one is master (splMode 1)  -> splLimitPower on the master, which redistributes it
 *  - several independent ones   -> the write goes through, but with a warning:
 *                                  the sum of the limits can exceed the home
 *                                  power limit and trip the meter
 *
 * Anomalous setups (a slave with no master, two masters) follow the same
 * choice as the spec makes for independents: write and warn, because a
 * rejection would block legitimate setups not anticipated at this stage.
 *
 * There is no ceiling on the value. `limitPower` is the household power, not
 * what the charger delivers, and the device does not declare any maximum for
 * this quantity. Validating it against `maxPower` (7360 W on the real UNI,
 * with `limitPower` at 4000) would reject a 10 kW contract, which is
 * legitimate and useful: the modulator subtracts household consumption from
 * the limit to decide how much to give the car, so a ceiling borrowed from a
 * different quantity would steal power from the car. The spec wants ranges
 * derived from the maximums the device declares: where none exists, none is
 * invented.
 */
export async function setHomePowerLimit(
  registry: ChargerRegistry,
  limitW: number,
  charger?: string,
): Promise<LimitResult> {
  if (!Number.isInteger(limitW) || limitW <= 0) {
    throw new ValidationError(`invalid power limit: ${limitW}. Expected a positive integer in watts`);
  }

  const all = registry.all();
  const modes = await Promise.all(
    all.map(async (entry) => ({ entry, spl: await entry.device.getSplCfg() })),
  );

  const warnings: string[] = [];
  const masters = modes.filter((m) => m.spl.splMode === 1);

  if (masters.length > 1) {
    warnings.push(
      `Warning: ${masters.length} chargers declare themselves SPL master ` +
      `(${masters.map((m) => m.entry.name).join(', ')}). The setup expects only one: ` +
      `the limit was written to "${masters[0].entry.name}", but how it is split between masters ` +
      'is unpredictable. The SPL pairing must be corrected from the web interface.',
    );
  }

  const master = masters[0];
  if (master) {
    await master.entry.device.putSplCfg({ splLimitPower: limitW });
    return { charger: master.entry.name, limitW, appliedTo: 'spl-master', ...toWarning(warnings) };
  }

  const target = registry.resolve(charger);
  const targetMode = modes.find((m) => m.entry.name === target.name);

  if (targetMode?.spl.splMode === 2) {
    warnings.push(
      `Warning: charger "${target.name}" is configured as SPL slave but none of the known ` +
      'chargers is a master (missing, unreachable, or misconfigured master). The limit was ' +
      'written to its modulator, but will most likely be overwritten by the master once it ' +
      'becomes available again.',
    );
  }

  await target.device.putModulatorCfg({ limitPower: limitW });

  const independents = modes.filter((m) => m.spl.splMode === 0);
  if (independents.length > 1) {
    warnings.push(
      `Warning: ${independents.length} chargers are configured as independent ` +
      '(SPL disabled). Each one can draw up to its own limit, so the sum can exceed the ' +
      'contracted power and trip the meter. For a shared limit, enable SPL master/slave ' +
      'from the web interface.',
    );
  }

  return { charger: target.name, limitW, appliedTo: 'modulator', ...toWarning(warnings) };
}

/** Warnings accumulate: two anomalies together must not hide each other. */
function toWarning(warnings: string[]): { warning?: string } {
  return warnings.length === 0 ? {} : { warning: warnings.join(' ') };
}

export async function setChargerCurrentLimit(
  entry: ChargerEntry,
  amps: number,
): Promise<{ charger: string; ampacity: number }> {
  if (!Number.isInteger(amps) || amps <= 0) {
    throw new ValidationError(`invalid current: ${amps}. Expected a positive integer in amperes`);
  }
  const info = await entry.device.getInfo();
  // The ceiling comes from the device: if it doesn't declare one, range
  // validation has no source. Comparing against `undefined` would give
  // `false` and let any value through, silently disabling the only
  // protection on writes: an explicit error is better.
  if (!Number.isFinite(info.maxAmpacity)) {
    throw new DeviceResponseError(
      entry.host, '/device', 200,
      'the response does not declare "maxAmpacity" as a number: impossible to validate the requested current',
    );
  }
  if (amps > info.maxAmpacity) {
    throw new ValidationError(
      `current ${amps} A exceeds the maximum of ${info.maxAmpacity} A for charger "${entry.name}"`,
    );
  }
  await entry.device.putAmpacity(amps);
  return { charger: entry.name, ampacity: amps };
}
