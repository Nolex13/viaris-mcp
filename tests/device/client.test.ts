import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ViarisDevice } from '../../src/device/client.js';
import { DeviceResponseError } from '../../src/transport/errors.js';
import type { SchedulerTask } from '../../src/device/types.js';

/** Returns the body recorded from the real device, already parsed. */
function fixture(name: string): unknown {
  const { body } = JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
  return JSON.parse(body);
}

function deviceWith(map: Record<string, unknown>) {
  const request = vi.fn(async (_host, _method, path: string) => {
    if (!(path in map)) throw new Error(`unexpected path: ${path}`);
    return map[path];
  });
  return { device: new ViarisDevice('192.168.1.100', request as never), request };
}

describe('ViarisDevice', () => {
  it('reads device info from the real fixture', async () => {
    const { device } = deviceWith({ '/device': fixture('device') });
    const info = await device.getInfo();
    expect(info.model).toBe('VIARIS UNI');
    expect(info.maxAmpacity).toBe(32);
    expect(info.elements[0].name).toBe('mennekes');
  });

  it('reads the modulator stats', async () => {
    const { device } = deviceWith({ '/modules/modulator?level=stat': fixture('modulator-stat') });
    const stat = await device.getModulatorStat();
    expect(stat).toHaveProperty('homePower');
    expect(typeof stat.evsePower).toBe('number');
  });

  it('reads the evsm elements', async () => {
    const { device } = deviceWith({ '/modules/evsm/elements': fixture('evsm-elements') });
    const [element] = await device.getEvsmElements();
    expect(element.name).toBe('mennekes');
    expect(typeof element.stat.state).toBe('number');
  });

  it('reads the SPL configuration', async () => {
    const { device } = deviceWith({ '/modules/spl?level=cfg': fixture('spl-cfg') });
    const spl = await device.getSplCfg();
    expect(spl.splMode).toBe(0);
    expect(spl.splCount).toBe(1);
  });

  it('reads the charging history as raw text, without interpreting it', async () => {
    const { device } = deviceWith({ '/modules/modulator/historic': fixture('modulator-historic') });
    const body = await device.getHistoricRaw();
    expect(typeof body).toBe('string');
    expect(body).toContain('mennekes');
  });

  it('throws DeviceResponseError if the history response has no body field', async () => {
    const { device } = deviceWith({ '/modules/modulator/historic': {} });
    await expect(device.getHistoricRaw()).rejects.toBeInstanceOf(DeviceResponseError);
  });

  it('returns an empty string without throwing when the history is genuinely empty', async () => {
    const { device } = deviceWith({ '/modules/modulator/historic': { body: '' } });
    await expect(device.getHistoricRaw()).resolves.toBe('');
  });

  it('reads the device clock as epoch seconds', async () => {
    const { device, request } = deviceWith({ '/device/localtime': { localtime: 1788635822 } });
    await expect(device.getLocaltime()).resolves.toBe(1788635822);
    expect(request).toHaveBeenCalledWith('192.168.1.100', 'GET', '/device/localtime');
  });

  it.each([
    { label: 'missing', payload: {} },
    { label: 'not a number', payload: { localtime: 'now' } },
    { label: 'not finite', payload: { localtime: Number.NaN } },
  ])('throws DeviceResponseError when localtime is $label', async ({ payload }) => {
    const { device } = deviceWith({ '/device/localtime': payload });
    await expect(device.getLocaltime()).rejects.toBeInstanceOf(DeviceResponseError);
  });

  it.each([
    { label: 'getModulatorCfg', call: (d: ViarisDevice) => d.getModulatorCfg(), path: '/modules/modulator?level=cfg' },
    { label: 'getModulatorStat', call: (d: ViarisDevice) => d.getModulatorStat(), path: '/modules/modulator?level=stat' },
    { label: 'getSplCfg', call: (d: ViarisDevice) => d.getSplCfg(), path: '/modules/spl?level=cfg' },
    { label: 'getSolarCfg', call: (d: ViarisDevice) => d.getSolarCfg(), path: '/modules/solar?level=cfg' },
    { label: 'getHmiCfg', call: (d: ViarisDevice) => d.getHmiCfg(), path: '/modules/hmi?level=cfg' },
  ])('$label throws DeviceResponseError if the expected envelope is missing', async ({ call, path }) => {
    const { device } = deviceWith({ [path]: { other: 1 } });
    await expect(call(device)).rejects.toBeInstanceOf(DeviceResponseError);
  });

  it('the error on a missing envelope names the offending endpoint', async () => {
    const { device } = deviceWith({ '/modules/spl?level=cfg': {} });
    await expect(device.getSplCfg()).rejects.toThrow(/\/modules\/spl\?level=cfg/);
  });

  it('writes the power limit with a PUT to the modulator', async () => {
    const { device, request } = deviceWith({ '/modules/modulator': {} });
    await device.putModulatorCfg({ limitPower: 5000 });
    expect(request).toHaveBeenCalledWith('192.168.1.100', 'PUT', '/modules/modulator', { limitPower: 5000 });
  });

  it('writes the ampacity to the endpoint with the level query', async () => {
    const { device, request } = deviceWith({ '/device?level=ampacity': {} });
    await device.putAmpacity(16);
    expect(request).toHaveBeenCalledWith('192.168.1.100', 'PUT', '/device?level=ampacity', { ampacity: 16 });
  });

  it('creates a scheduler task with a POST on the element', async () => {
    const { device, request } = deviceWith({ '/modules/scheduler/elements/mennekes': {} });
    const task = { id: 1, active: true, user: '', group: 0, priority: 1,
      initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin: 1380, duration: 420 }] } };
    await device.createSchedulerTask('mennekes', task);
    expect(request).toHaveBeenCalledWith(
      '192.168.1.100', 'POST', '/modules/scheduler/elements/mennekes', { tasks: [task] });
  });

  it('deletes a scheduler task by id', async () => {
    const { device, request } = deviceWith({ '/modules/scheduler/elements/mennekes': {} });
    await device.deleteSchedulerTask('mennekes', 3);
    expect(request).toHaveBeenCalledWith(
      '192.168.1.100', 'DELETE', '/modules/scheduler/elements/mennekes', { tasks: [{ id: 3 }] });
  });

  const sampleTask: SchedulerTask = {
    id: 1, active: true, user: '', group: 0, priority: 1,
    initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin: 1380, duration: 420 }] },
  };

  const routingCases: Array<{
    label: string;
    call: (device: ViarisDevice) => Promise<unknown>;
    method: string;
    path: string;
    body?: unknown;
  }> = [
    { label: 'getModulatorCfg', call: (d) => d.getModulatorCfg(), method: 'GET', path: '/modules/modulator?level=cfg' },
    { label: 'getSchedulerElements', call: (d) => d.getSchedulerElements(), method: 'GET', path: '/modules/scheduler/elements?level=cfg' },
    { label: 'getSolarCfg', call: (d) => d.getSolarCfg(), method: 'GET', path: '/modules/solar?level=cfg' },
    { label: 'getHmiCfg', call: (d) => d.getHmiCfg(), method: 'GET', path: '/modules/hmi?level=cfg' },
    { label: 'getOcppCfg', call: (d) => d.getOcppCfg(), method: 'GET', path: '/modules/ocpp?level=all' },
    { label: 'getModbusCfg', call: (d) => d.getModbusCfg(), method: 'GET', path: '/modules/modbus?level=cfg' },
    { label: 'getMqttStat', call: (d) => d.getMqttStat(), method: 'GET', path: '/modules/mqtt?level=stat' },
    { label: 'putSplCfg', call: (d) => d.putSplCfg({ splMode: 1 }), method: 'PUT', path: '/modules/spl', body: { splMode: 1 } },
    { label: 'putSolarCfg', call: (d) => d.putSolarCfg({ enabled: true }), method: 'PUT', path: '/modules/solar', body: { enabled: true } },
    { label: 'putHmiCfg', call: (d) => d.putHmiCfg({ ledsIntensity: 5 }), method: 'PUT', path: '/modules/hmi', body: { ledsIntensity: 5 } },
    { label: 'putLocaltime', call: (d) => d.putLocaltime(1700000000), method: 'PUT', path: '/device/localtime', body: { localtime: 1700000000 } },
    {
      label: 'putTimezone',
      call: (d) => d.putTimezone('Europe/Rome', 3),
      method: 'PUT',
      path: '/modules/astcal?level=clock',
      body: { geoloc: { timezone: 'Europe/Rome', timezoneCode: 3 } },
    },
    {
      label: 'updateSchedulerTask',
      call: (d) => d.updateSchedulerTask('mennekes', sampleTask),
      method: 'PUT',
      path: '/modules/scheduler/elements/mennekes',
      body: { tasks: [sampleTask] },
    },
  ];

  it.each(routingCases)('$label calls $method $path with the expected body', async ({ call, method, path, body }) => {
    // the cfg/stat envelope is now verified: the stub must return it, otherwise
    // the test would be checking the routing against a response the device never gives
    const request = vi.fn(async () => ({ cfg: {}, stat: {} }));
    const device = new ViarisDevice('192.168.1.100', request as never);
    await call(device);
    if (body === undefined) {
      expect(request).toHaveBeenCalledWith('192.168.1.100', method, path);
    } else {
      expect(request).toHaveBeenCalledWith('192.168.1.100', method, path, body);
    }
  });
});
