import type { ChargerEntry } from '../registry.js';
import { ValidationError } from '../transport/errors.js';

/**
 * Same addressing scheme as chargers, applied to the connectors of a single
 * device. With more than one connector the name is mandatory: silently
 * picking one would hand the agent a wrong answer without it noticing.
 *
 * Pure function: it takes connector names that have already been read (no
 * network calls), so a caller who has already done getInfo() for other
 * purposes doesn't need to redo it just to resolve the connector.
 */
export function chooseElement(chargerName: string, names: string[], element?: string): string {
  if (element === undefined) {
    if (names.length === 1) return names[0];
    throw new ValidationError(
      `charger "${chargerName}" has more than one connector: specify "element" among ${names.join(', ')}`,
    );
  }
  if (!names.includes(element)) {
    throw new ValidationError(
      `connector "${element}" does not exist on "${chargerName}". Available: ${names.join(', ')}`,
    );
  }
  return element;
}

/** Thin wrapper over chooseElement: reads getInfo() and picks the connector. */
export async function resolveElement(entry: ChargerEntry, element?: string): Promise<string> {
  const { elements } = await entry.device.getInfo();
  return chooseElement(entry.name, elements.map((e) => e.name), element);
}
