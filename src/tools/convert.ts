import { ValidationError } from '../transport/errors.js';

export type ChargingState =
  | 'free' | 'connected' | 'charging' | 'paused'
  | 'finished' | 'on' | 'off' | 'inoperative' | 'unknown';

/** Map derived from changeEvsmElemState in firmware 7.2.53. */
const STATES: ReadonlyMap<number, ChargingState> = new Map([
  [1, 'free'], [2, 'free'],
  [3, 'connected'], [4, 'connected'],
  [5, 'charging'], [6, 'charging'],
  [7, 'paused'], [8, 'finished'],
  [14, 'on'], [31, 'off'], [32, 'inoperative'],
]);

export function stateToString(code: number): ChargingState {
  return STATES.get(code) ?? 'unknown';
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function hhmmToMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new ValidationError(`invalid time: "${hhmm}". Expected format HH:MM, e.g. "23:00"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHhmm(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * The firmware expresses a time window as minutes-since-midnight plus a
 * duration in minutes. If the end precedes the start, the window crosses
 * midnight and a day must be added.
 */
export function windowToTimeList(start: string, end: string): { hourMin: number; duration: number } {
  const hourMin = hhmmToMinutes(start);
  let endMin = hhmmToMinutes(end);
  if (endMin <= hourMin) endMin += 1440;
  const duration = endMin - hourMin;
  if (duration === 0 || duration >= 1440) {
    throw new ValidationError(`invalid time window: ${start}-${end}`);
  }
  return { hourMin, duration };
}

export function timeListToWindow(hourMin: number, duration: number): { start: string; end: string } {
  return { start: minutesToHhmm(hourMin), end: minutesToHhmm(hourMin + duration) };
}

export interface ChargingSession {
  start: string;
  end: string;
  energyWh: number;
  durationMin: number;
  startedBy: string;
  endedBy: string;
}

/**
 * The charging history arrives as an 18-column CSV. 13 of them are identified;
 * positions 2, 3, 5, 17 and 18 are constant across all the available history
 * and are omitted rather than exposed under a made-up name.
 *
 *  0 start ts | 3 element | 5 max power | 6 start ts (dup) | 7 start user
 *  8 start source | 9 start meter Wh | 10 end ts | 11 end user
 * 12 stop source | 13 end meter Wh | 14 energy Wh | 15 energy Wh (dup)
 */
export function parseHistoryCsv(body: string): ChargingSession[] {
  const sessions: ChargingSession[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const c = trimmed.split(',');
    if (c.length < 15) continue;

    const startSec = Number(c[0]);
    const endSec = Number(c[10]);
    const energyWh = c[14].trim() === '' ? NaN : Number(c[14]);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || !Number.isFinite(energyWh)) continue;

    sessions.push({
      start: new Date(startSec * 1000).toISOString(),
      end: new Date(endSec * 1000).toISOString(),
      energyWh,
      durationMin: Math.round((endSec - startSec) / 60),
      startedBy: c[8],
      endedBy: c[12],
    });
  }
  return sessions;
}
