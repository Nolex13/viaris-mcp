import { ViarisDevice, type RequestFn } from './device/client.js';
import { ValidationError } from './transport/errors.js';

export interface ChargerEntry {
  name: string;
  host: string;
  device: ViarisDevice;
}

/**
 * Chargers are configured via the environment, because the server is launched
 * as a stdio subprocess by Hermes:
 *   VIARIS_CHARGERS='{"garage":"192.168.1.100","outdoor":"192.168.1.101"}'
 *   VIARIS_HOST='192.168.1.100'   (shortcut for a single charger)
 */
export function loadChargers(env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.VIARIS_CHARGERS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.VIARIS_CHARGERS);
    } catch {
      throw new ValidationError('VIARIS_CHARGERS is not valid JSON. Expected {"name":"address"}');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ValidationError('VIARIS_CHARGERS must be an object {"name":"address"}');
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) throw new ValidationError('VIARIS_CHARGERS contains no chargers');
    for (const [name, host] of entries) {
      if (typeof host !== 'string' || host === '') {
        throw new ValidationError(`invalid address for charger "${name}"`);
      }
    }
    return Object.fromEntries(entries) as Record<string, string>;
  }

  if (env.VIARIS_HOST) return { default: env.VIARIS_HOST };

  throw new ValidationError(
    'no charger configured: set VIARIS_HOST or VIARIS_CHARGERS',
  );
}

export class ChargerRegistry {
  private readonly entries: Map<string, ChargerEntry>;

  constructor(hosts: Record<string, string>, request: RequestFn) {
    this.entries = new Map(
      Object.entries(hosts).map(([name, host]) => [
        name,
        { name, host, device: new ViarisDevice(host, request) },
      ]),
    );
  }

  get names(): string[] {
    return [...this.entries.keys()];
  }

  /** With a single charger the name is superfluous; with more than one it becomes mandatory. */
  resolve(name?: string): ChargerEntry {
    if (name === undefined) {
      if (this.entries.size === 1) return [...this.entries.values()][0];
      throw new ValidationError(
        `more than one charger is configured: specify "charger" among ${this.names.join(', ')}`,
      );
    }
    const entry = this.entries.get(name);
    if (!entry) {
      throw new ValidationError(
        `charger "${name}" not configured. Available: ${this.names.join(', ')}`,
      );
    }
    return entry;
  }

  all(): ChargerEntry[] {
    return [...this.entries.values()];
  }
}
