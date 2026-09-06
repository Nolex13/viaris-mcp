/** The device did not respond: powered off, off the network, or stuck in a reset loop. */
export class DeviceUnreachableError extends Error {
  constructor(readonly host: string, readonly cause: unknown) {
    super(`charger ${host} unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DeviceUnreachableError';
  }
}

/** The device responded, but unexpectedly: a non-2xx status or unreadable JSON. */
export class DeviceResponseError extends Error {
  constructor(readonly host: string, readonly path: string, readonly status: number, detail: string) {
    super(`unexpected response from ${host}${path} (HTTP ${status}): ${detail}`);
    this.name = 'DeviceResponseError';
  }
}

/** Input rejected before any network call. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
