import { ViarisDevice, type RequestFn } from './device/client.js';
import { ValidationError } from './transport/errors.js';

export interface ChargerEntry {
  name: string;
  host: string;
  device: ViarisDevice;
}

/**
 * Chargers are configured via the environment, because the server is launched
 * as a stdio subprocess by the agent:
 *
 *   VIARIS_CHARGERS="garage=192.168.1.100"
 *   VIARIS_CHARGERS="garage=192.168.1.100,outdoor=192.168.1.101"
 *
 * Deliberately not JSON: this value almost always ends up inside an MCP
 * client's own JSON config file, where a JSON payload would need its quotes
 * escaped — the most common way to get the setup wrong.
 */
export function loadChargers(env: NodeJS.ProcessEnv): Record<string, string> {
  const raw = env.VIARIS_CHARGERS?.trim();
  if (!raw) {
    throw new ValidationError(
      'no charger configured: set VIARIS_CHARGERS, for example ' +
      'VIARIS_CHARGERS="garage=192.168.1.100" or ' +
      'VIARIS_CHARGERS="garage=192.168.1.100,outdoor=192.168.1.101"',
    );
  }

  const chargers: Record<string, string> = {};

  for (const entry of raw.split(',')) {
    const pair = entry.trim();
    if (pair === '') continue;

    // Split on the first "=" only: a name never contains one, a host might.
    const separator = pair.indexOf('=');
    if (separator === -1) {
      throw new ValidationError(
        `invalid charger "${pair}": expected name=address, for example garage=192.168.1.100`,
      );
    }

    const name = pair.slice(0, separator).trim();
    const host = pair.slice(separator + 1).trim();

    if (name === '') throw new ValidationError(`missing charger name in "${pair}"`);
    if (host === '') throw new ValidationError(`missing address for charger "${name}"`);

    // Silently keeping the last one would leave a charger configured but
    // unreachable by name, with nothing to indicate why.
    if (name in chargers) {
      throw new ValidationError(`charger "${name}" is configured more than once`);
    }

    chargers[name] = host;
  }

  if (Object.keys(chargers).length === 0) {
    throw new ValidationError('VIARIS_CHARGERS contains no chargers');
  }

  return chargers;
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
