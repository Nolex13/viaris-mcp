import { describe, expect, it, vi } from 'vitest';
import { addSchedule, getSchedule, removeSchedule } from '../../src/tools/schedule.js';
import { DeviceResponseError, ValidationError } from '../../src/transport/errors.js';
import type { ChargerEntry } from '../../src/registry.js';

function entryWith(
  tasks: unknown[],
  elements = [{ name: 'mennekes' }],
  schedulerElementName = 'mennekes',
) {
  const getInfo = vi.fn(async () => ({ elements }));
  const getSchedulerElements = vi.fn(async () => [
    { name: schedulerElementName, data: { uid: 17, cfg: { tasks, defaultState: 1 } } },
  ]);
  const createSchedulerTask = vi.fn(async () => ({}));
  const deleteSchedulerTask = vi.fn(async () => ({}));
  const device = {
    getInfo,
    getSchedulerElements,
    createSchedulerTask,
    deleteSchedulerTask,
  };
  const entry: ChargerEntry = { name: 'garage', host: '10.0.0.1', device: device as never };
  return { entry, getInfo, getSchedulerElements, createSchedulerTask, deleteSchedulerTask };
}

const task = (id: number, hourMin: number, duration: number) => ({
  id, active: true, user: '', group: 0, priority: 1,
  initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin, duration }] },
});

describe('getSchedule', () => {
  it('exposes windows in HH:MM', async () => {
    const { entry } = entryWith([task(1, 1380, 420)]);
    await expect(getSchedule(entry)).resolves.toEqual([
      { id: 1, start: '23:00', end: '06:00', active: true, maxPowerW: null },
    ]);
  });

  it('returns an empty array when there are no windows', async () => {
    const { entry } = entryWith([]);
    await expect(getSchedule(entry)).resolves.toEqual([]);
  });

  // Both of these come from what a real charger returned after
  // add_charging_schedule: {"id":1,...,"active":1,"maxPowerW":0}.
  it('normalises the numeric active flag the firmware returns', async () => {
    const fromDevice = {
      id: 1, active: 1, user: '', group: 0, priority: 1,
      initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin: 180, duration: 60 }] },
    };
    const [window] = await getSchedule(entryWith([fromDevice]).entry);
    expect(window.active).toBe(true);
  });

  it('reports a window with no power cap as null, not as zero watts', async () => {
    const fromDevice = {
      id: 1, active: 1, user: '', group: 0, priority: 1,
      initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin: 180, duration: 60, maxPower: 0 }] },
    };
    const [window] = await getSchedule(entryWith([fromDevice]).entry);
    expect(window.maxPowerW).toBeNull();
  });

  it('still reports a real power cap', async () => {
    const fromDevice = {
      id: 1, active: 1, user: '', group: 0, priority: 1,
      initTime: { day: 0, month: 0, weekday: 0, timeList: [{ hourMin: 180, duration: 60, maxPower: 6000 }] },
    };
    const [window] = await getSchedule(entryWith([fromDevice]).entry);
    expect(window.maxPowerW).toBe(6000);
  });

  it('exposes all windows of a task that has more than one', async () => {
    const multi = {
      id: 4, active: true, user: '', group: 0, priority: 1,
      initTime: {
        day: 0, month: 0, weekday: 0,
        timeList: [
          { hourMin: 1380, duration: 420 },
          { hourMin: 780, duration: 120, maxPower: 6000 },
        ],
      },
    };
    const { entry } = entryWith([multi]);
    // same id on both: remove_charging_schedule removes by task id, so the
    // exposed identifier stays the one the removal accepts
    await expect(getSchedule(entry)).resolves.toEqual([
      { id: 4, start: '23:00', end: '06:00', active: true, maxPowerW: null, slot: 0 },
      { id: 4, start: '13:00', end: '15:00', active: true, maxPowerW: 6000, slot: 1 },
    ]);
  });

  it('skips tasks with an empty timeList without throwing', async () => {
    const empty = {
      id: 9, active: true, user: '', group: 0, priority: 1,
      initTime: { day: 0, month: 0, weekday: 0, timeList: [] },
    };
    const { entry } = entryWith([empty, task(1, 1380, 420)]);
    await expect(getSchedule(entry)).resolves.toEqual([
      { id: 1, start: '23:00', end: '06:00', active: true, maxPowerW: null },
    ]);
  });

  it('throws if the connector does not appear among the scheduler elements', async () => {
    // the connector has already been validated against /device: its absence here
    // is an unexpected response from the device, not "no scheduled window"
    const { entry } = entryWith([task(1, 1380, 420)], [{ name: 'mennekes' }], 'schuko');
    await expect(getSchedule(entry)).rejects.toBeInstanceOf(DeviceResponseError);
  });
});

describe('addSchedule', () => {
  it('converts the window and assigns the first free id', async () => {
    const { entry, createSchedulerTask } = entryWith([task(1, 540, 60)]);
    const created = await addSchedule(entry, '23:00', '06:00');
    expect(created.id).toBe(2);
    expect(createSchedulerTask).toHaveBeenCalledWith('mennekes', expect.objectContaining({
      id: 2,
      initTime: expect.objectContaining({
        timeList: [{ hourMin: 1380, duration: 420 }],
      }),
    }));
  });

  it('handles a window crossing midnight', async () => {
    const { entry } = entryWith([]);
    await expect(addSchedule(entry, '22:00', '02:00'))
      .resolves.toMatchObject({ start: '22:00', end: '02:00' });
  });

  it('includes maxPower when requested', async () => {
    const { entry, createSchedulerTask } = entryWith([]);
    await addSchedule(entry, '01:00', '05:00', { maxPowerW: 6000 });
    expect(createSchedulerTask).toHaveBeenCalledWith('mennekes', expect.objectContaining({
      initTime: expect.objectContaining({ timeList: [{ hourMin: 60, duration: 240, maxPower: 6000 }] }),
    }));
  });

  it('rejects a malformed time before calling the device', async () => {
    const { entry, getInfo, getSchedulerElements, createSchedulerTask } = entryWith([]);
    await expect(addSchedule(entry, '25:00', '06:00')).rejects.toBeInstanceOf(ValidationError);
    expect(getInfo).not.toHaveBeenCalled();
    expect(getSchedulerElements).not.toHaveBeenCalled();
    expect(createSchedulerTask).not.toHaveBeenCalled();
  });

  it('rejects a window with zero duration', async () => {
    const { entry } = entryWith([]);
    await expect(addSchedule(entry, '06:00', '06:00')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('removeSchedule', () => {
  it('removes by id', async () => {
    const { entry, deleteSchedulerTask } = entryWith([task(3, 540, 60)]);
    await expect(removeSchedule(entry, 3)).resolves.toEqual({ removed: 3 });
    expect(deleteSchedulerTask).toHaveBeenCalledWith('mennekes', 3);
  });

  it('rejects a nonexistent id without calling the device', async () => {
    const { entry, deleteSchedulerTask } = entryWith([task(3, 540, 60)]);
    await expect(removeSchedule(entry, 99)).rejects.toBeInstanceOf(ValidationError);
    expect(deleteSchedulerTask).not.toHaveBeenCalled();
  });
});

describe('connector addressing', () => {
  it('with two connectors requires the name', async () => {
    const { entry } = entryWith([], [{ name: 'mennekes' }, { name: 'schuko' }]);
    await expect(getSchedule(entry)).rejects.toBeInstanceOf(ValidationError);
    await expect(getSchedule(entry, 'mennekes')).resolves.toEqual([]);
  });
});
