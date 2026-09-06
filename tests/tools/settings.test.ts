import { describe, expect, it, vi } from 'vitest';
import { setDeviceTime, setLedBrightness, setSolarConfig } from '../../src/tools/settings.js';
import { ValidationError } from '../../src/transport/errors.js';
import type { ChargerEntry } from '../../src/registry.js';

function fakeEntry() {
  const putSolarCfg = vi.fn(async () => ({}));
  const putHmiCfg = vi.fn(async () => ({}));
  const putLocaltime = vi.fn(async () => ({}));
  const putTimezone = vi.fn(async () => ({}));
  const entry: ChargerEntry = {
    name: 'garage', host: '10.0.0.1',
    device: { putSolarCfg, putHmiCfg, putLocaltime, putTimezone } as never,
  };
  return { entry, putSolarCfg, putHmiCfg, putLocaltime, putTimezone };
}

describe('setSolarConfig', () => {
  it('enables solar with the requested priority', async () => {
    const { entry, putSolarCfg } = fakeEntry();
    await setSolarConfig(entry, { enabled: true, priority: 2 });
    expect(putSolarCfg).toHaveBeenCalledWith({ enabled: true, priority: 2 });
  });

  it('disables it without touching the priority', async () => {
    const { entry, putSolarCfg } = fakeEntry();
    await setSolarConfig(entry, { enabled: false });
    expect(putSolarCfg).toHaveBeenCalledWith({ enabled: false });
  });
});

describe('setLedBrightness', () => {
  it('accepts the three values supported by the firmware', async () => {
    const { entry, putHmiCfg } = fakeEntry();
    await setLedBrightness(entry, 50);
    expect(putHmiCfg).toHaveBeenCalledWith({ ledsIntensity: 50 });
  });

  it('rejects an unsupported value', async () => {
    const { entry, putHmiCfg } = fakeEntry();
    await expect(setLedBrightness(entry, 75 as never)).rejects.toBeInstanceOf(ValidationError);
    expect(putHmiCfg).not.toHaveBeenCalled();
  });
});

describe('setDeviceTime', () => {
  it('synchronizes the clock to the current time if none is specified', async () => {
    const { entry, putLocaltime } = fakeEntry();
    await setDeviceTime(entry, {});
    const [seconds] = putLocaltime.mock.calls[0] as unknown as [number];
    expect(Math.abs(seconds - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it('also sets the time zone when both parameters are provided', async () => {
    const { entry, putTimezone } = fakeEntry();
    await setDeviceTime(entry, { timezone: 'CET-1CEST,M3.5.0,M10.5.0/3', timezoneCode: 42 });
    expect(putTimezone).toHaveBeenCalledWith('CET-1CEST,M3.5.0,M10.5.0/3', 42);
  });

  it('rejects a time zone without its code', async () => {
    const { entry } = fakeEntry();
    await expect(setDeviceTime(entry, { timezone: 'CET-1CEST' }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});
