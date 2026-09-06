import type { ChargerEntry } from '../registry.js';

/** Recognizes an error entry produced by perCharger, without repeating the check by hand. */
export function isChargerError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

/**
 * Runs fn on every charger and returns a map by name. An error on one charger
 * stays confined to its own entry: the others still report their data.
 */
export async function perCharger<T>(
  entries: ChargerEntry[],
  fn: (entry: ChargerEntry) => Promise<T>,
): Promise<Record<string, T | { error: string }>> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        return [entry.name, await fn(entry)] as const;
      } catch (err) {
        return [entry.name, { error: err instanceof Error ? err.message : String(err) }] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}

/**
 * Serializes the result of perCharger, marking the response as an MCP error
 * only when ALL entries have failed. With more than one charger an isolated
 * error remains a legitimate partial success (per-charger isolation is the
 * intent); but if only one charger was queried, or all of them failed, the
 * agent must not be able to mistake the error for valid data. An empty map is
 * not an error: it simply means there was nothing to query.
 */
export function perChargerIsError(results: Record<string, unknown>): boolean {
  const values = Object.values(results);
  return values.length > 0 && values.every(isChargerError);
}
