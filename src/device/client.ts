import type { HttpMethod } from '../transport/transport.js';
import { DeviceResponseError } from '../transport/errors.js';
import type {
  DeviceInfo, EvsmElement, HmiCfg, ModulatorCfg, ModulatorStat,
  SchedulerElement, SchedulerTask, SolarCfg, SplCfg,
} from './types.js';

export type RequestFn = (
  host: string, method: HttpMethod, path: string, body?: unknown,
) => Promise<unknown>;

/**
 * Knows the endpoints and payloads of the Viaris firmware. Returns data exactly
 * as the device provides it: no unit conversion, no code translation.
 */
export class ViarisDevice {
  constructor(readonly host: string, private readonly request: RequestFn) {}

  private get<T>(path: string): Promise<T> {
    return this.request(this.host, 'GET', path) as Promise<T>;
  }

  private put(path: string, body: unknown): Promise<unknown> {
    return this.request(this.host, 'PUT', path, body);
  }

  /**
   * Module reads arrive wrapped in { cfg } or { stat }. The envelope is the
   * boundary we check: without it an `undefined` would bubble up to the tools
   * and blow up there as a TypeError, instead of the "unparseable response"
   * category of error, which must name the offending endpoint.
   * Individual inner fields are not validated here: that would be over-engineering.
   */
  private getEnveloped<T>(path: string, key: 'cfg' | 'stat'): Promise<T> {
    return this.get<unknown>(path).then((response) => {
      const value = (response as Record<string, unknown> | null | undefined)?.[key];
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new DeviceResponseError(
          this.host, path, 200,
          `the response does not contain the expected "${key}" object`,
        );
      }
      return value as T;
    });
  }

  // --- reads ---

  getInfo(): Promise<DeviceInfo> {
    return this.get<DeviceInfo>('/device');
  }

  getModulatorStat(): Promise<ModulatorStat> {
    return this.getEnveloped<ModulatorStat>('/modules/modulator?level=stat', 'stat');
  }

  getModulatorCfg(): Promise<ModulatorCfg> {
    return this.getEnveloped<ModulatorCfg>('/modules/modulator?level=cfg', 'cfg');
  }

  getEvsmElements(): Promise<EvsmElement[]> {
    return this.get<EvsmElement[]>('/modules/evsm/elements');
  }

  getSchedulerElements(): Promise<SchedulerElement[]> {
    return this.get<SchedulerElement[]>('/modules/scheduler/elements?level=cfg');
  }

  getSplCfg(): Promise<SplCfg> {
    return this.getEnveloped<SplCfg>('/modules/spl?level=cfg', 'cfg');
  }

  getSolarCfg(): Promise<SolarCfg> {
    return this.getEnveloped<SolarCfg>('/modules/solar?level=cfg', 'cfg');
  }

  getHmiCfg(): Promise<HmiCfg> {
    return this.getEnveloped<HmiCfg>('/modules/hmi?level=cfg', 'cfg');
  }

  getOcppCfg(): Promise<unknown> {
    return this.get('/modules/ocpp?level=all');
  }

  getModbusCfg(): Promise<unknown> {
    return this.get('/modules/modbus?level=cfg');
  }

  getMqttStat(): Promise<unknown> {
    return this.get('/modules/mqtt?level=stat');
  }

  /** The charging history is CSV inside a JSON field: it stays raw text here. */
  getHistoricRaw(): Promise<string> {
    const path = '/modules/modulator/historic';
    return this.get<{ body: string }>(path).then((r) => {
      if (typeof r.body !== 'string') {
        throw new DeviceResponseError(
          this.host, path, 200,
          'the response does not contain the expected "body" field (string)',
        );
      }
      return r.body;
    });
  }

  // --- writes ---

  putModulatorCfg(cfg: Partial<ModulatorCfg>): Promise<unknown> {
    return this.put('/modules/modulator', cfg);
  }

  putSplCfg(cfg: Partial<SplCfg>): Promise<unknown> {
    return this.put('/modules/spl', cfg);
  }

  putAmpacity(ampacity: number): Promise<unknown> {
    return this.put('/device?level=ampacity', { ampacity });
  }

  putSolarCfg(cfg: Partial<SolarCfg>): Promise<unknown> {
    return this.put('/modules/solar', cfg);
  }

  putHmiCfg(cfg: Partial<HmiCfg>): Promise<unknown> {
    return this.put('/modules/hmi', cfg);
  }

  /**
   * The device clock, as epoch seconds. Not an enveloped payload like the
   * module reads, so the field is checked here: a clock that came back as
   * anything other than a finite number would otherwise surface as a
   * nonsensical date rather than as an error.
   */
  getLocaltime(): Promise<number> {
    const path = '/device/localtime';
    return this.get<{ localtime?: unknown }>(path).then((r) => {
      if (typeof r?.localtime !== 'number' || !Number.isFinite(r.localtime)) {
        throw new DeviceResponseError(
          this.host, path, 200,
          'the response does not contain a numeric "localtime"',
        );
      }
      return r.localtime;
    });
  }

  /**
   * Element-collection endpoints answer HTTP 200 even when they refuse the
   * write, reporting it per element as `data: {error: true, msg}`. Left
   * unchecked, a rejected write reads as a success — the caller would tell an
   * agent it changed something it did not.
   */
  private assertNoElementError(path: string, response: unknown): void {
    if (!Array.isArray(response)) return;
    for (const element of response) {
      const data = (element as { name?: string; data?: { error?: boolean; msg?: string } })?.data;
      if (data?.error === true) {
        throw new DeviceResponseError(
          this.host, path, 200,
          `the device refused the change for "${(element as { name?: string }).name ?? '?'}": ${data.msg ?? 'no reason given'}`,
        );
      }
    }
  }

  /**
   * Whether charging is permitted outside the scheduled windows. The firmware
   * rejects this unless at least one window exists.
   */
  async putSchedulerDefaultState(defaultState: number): Promise<void> {
    const path = '/modules/scheduler/elements?level=cfg';
    this.assertNoElementError(path, await this.put(path, { defaultState }));
  }

  putLocaltime(epochSeconds: number): Promise<unknown> {
    return this.put('/device/localtime', { localtime: epochSeconds });
  }

  putTimezone(timezone: string, timezoneCode: number): Promise<unknown> {
    return this.put('/modules/astcal?level=clock', { geoloc: { timezone, timezoneCode } });
  }

  /** POST: the transport does not retry it. */
  createSchedulerTask(element: string, task: SchedulerTask): Promise<unknown> {
    return this.request(this.host, 'POST', `/modules/scheduler/elements/${element}`, { tasks: [task] });
  }

  updateSchedulerTask(element: string, task: SchedulerTask): Promise<unknown> {
    return this.put(`/modules/scheduler/elements/${element}`, { tasks: [task] });
  }

  deleteSchedulerTask(element: string, id: number): Promise<unknown> {
    return this.request(this.host, 'DELETE', `/modules/scheduler/elements/${element}`, { tasks: [{ id }] });
  }
}
