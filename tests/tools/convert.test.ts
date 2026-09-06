import { describe, expect, it } from 'vitest';
import {
  hhmmToMinutes, minutesToHhmm, parseHistoryCsv, stateToString,
  timeListToWindow, windowToTimeList,
} from '../../src/tools/convert.js';

describe('stateToString', () => {
  it.each([
    [1, 'free'], [2, 'free'], [3, 'connected'], [4, 'connected'],
    [5, 'charging'], [6, 'charging'], [7, 'paused'], [8, 'finished'],
    [14, 'on'], [31, 'off'], [32, 'inoperative'],
  ])('maps code %i to %s', (code, expected) => {
    expect(stateToString(code)).toBe(expected);
  });

  it('returns unknown for an unforeseen code, without throwing', () => {
    expect(stateToString(99)).toBe('unknown');
  });
});

describe('time conversion', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('23:00')).toBe(1380);
    expect(hhmmToMinutes('06:30')).toBe(390);
  });

  it('converts minutes to HH:MM with a leading zero', () => {
    expect(minutesToHhmm(0)).toBe('00:00');
    expect(minutesToHhmm(390)).toBe('06:30');
    expect(minutesToHhmm(1380)).toBe('23:00');
  });

  it('rejects an invalid time format', () => {
    expect(() => hhmmToMinutes('25:00')).toThrow();
    expect(() => hhmmToMinutes('7:00')).toThrow();
    expect(() => hhmmToMinutes('abc')).toThrow();
  });

  it('computes the duration of a window within the same day', () => {
    expect(windowToTimeList('09:00', '11:30')).toEqual({ hourMin: 540, duration: 150 });
  });

  it('adds a day when the window crosses midnight', () => {
    // 23:00 -> 06:00 is 7 hours: the firmware wants 1440 + 360 - 1380
    expect(windowToTimeList('23:00', '06:00')).toEqual({ hourMin: 1380, duration: 420 });
  });

  it('rejects a window with zero duration', () => {
    expect(() => windowToTimeList('09:00', '09:00')).toThrow();
  });

  it('reconstructs the window from the firmware values', () => {
    expect(timeListToWindow(1380, 420)).toEqual({ start: '23:00', end: '06:00' });
    expect(timeListToWindow(540, 150)).toEqual({ start: '09:00', end: '11:30' });
  });

  it('is symmetric on the case that crosses midnight', () => {
    const { hourMin, duration } = windowToTimeList('22:15', '05:45');
    expect(timeListToWindow(hourMin, duration)).toEqual({ start: '22:15', end: '05:45' });
  });
});

describe('parseHistoryCsv', () => {
  const row = '1773526500,1,1,mennekes,1,6000,1773526500,,schedman,1000000,' +
    '1773542880,,evsm,1017122,17122,17122,0,0';

  it('extracts a session from the identified columns', () => {
    const [session] = parseHistoryCsv(row);
    expect(session).toEqual({
      start: '2026-03-14T22:15:00.000Z',
      end: '2026-03-15T02:48:00.000Z',
      energyWh: 17122,
      durationMin: 273,
      startedBy: 'schedman',
      endedBy: 'evsm',
    });
  });

  it('handles multiple rows', () => {
    expect(parseHistoryCsv(`${row}\n${row}`)).toHaveLength(2);
  });

  it('ignores empty rows and rows with too few columns', () => {
    expect(parseHistoryCsv(`${row}\n\n1,2,3\n`)).toHaveLength(1);
  });

  it('returns an empty array for an empty history', () => {
    expect(parseHistoryCsv('')).toEqual([]);
  });

  it('discards the row if the energy column is empty', () => {
    const cols = row.split(',');
    cols[14] = '';
    const rowWithoutEnergy = cols.join(',');
    expect(parseHistoryCsv(rowWithoutEnergy)).toEqual([]);
  });
});
