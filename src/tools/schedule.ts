import type { ChargerEntry } from '../registry.js';
import { DeviceResponseError, ValidationError } from '../transport/errors.js';
import { timeListToWindow, windowToTimeList } from './convert.js';
import { resolveElement } from './element.js';
import type { SchedulerTask } from '../device/types.js';

export interface ScheduleWindow {
  id: number;
  start: string;
  end: string;
  active: boolean;
  maxPowerW: number | null;
  /** Index of the window inside the task: present only if the task has more than one. */
  slot?: number;
}

const SCHEDULER_PATH = '/modules/scheduler/elements?level=cfg';

async function readTasks(entry: ChargerEntry, element: string): Promise<SchedulerTask[]> {
  const elements = await entry.device.getSchedulerElements();
  const found = elements.find((e) => e.name === element);
  // The connector has already been validated against /device: if it doesn't
  // show up here, the device has responded unexpectedly, not "no scheduled
  // window". An element that is present with empty tasks, on the other hand,
  // genuinely means no window.
  if (!found) {
    throw new DeviceResponseError(
      entry.host, SCHEDULER_PATH, 200,
      `connector "${element}" does not appear among the scheduler elements`,
    );
  }
  const tasks = found.data.cfg.tasks;
  if (!Array.isArray(tasks)) {
    throw new DeviceResponseError(
      entry.host, SCHEDULER_PATH, 200,
      `element "${element}" does not expose the expected "tasks" list`,
    );
  }
  return tasks;
}

/**
 * A task can contain more than one window: `timeList` is an array and the
 * firmware allows it. Each one becomes an entry in the result; showing only
 * one would report an incomplete schedule to the agent without flagging it.
 *
 * The exposed id stays the **task**'s id, because `remove_charging_schedule`
 * removes by task id: it's the device that accepts that identifier, not us
 * choosing it. When a task has more than one window the entries therefore
 * share the same id and are distinguished by `slot`; removing that id removes
 * the whole task, i.e. all of its windows together. With a single window
 * `slot` is omitted: it would just be noise.
 *
 * A task with an empty `timeList` produces no entry at all — flatMap skips it
 * on its own, with no need for an explicit filter.
 */
function toWindows(task: SchedulerTask): ScheduleWindow[] {
  return task.initTime.timeList.map((slot, index) => {
    const { start, end } = timeListToWindow(slot.hourMin, slot.duration);
    return {
      id: task.id,
      start,
      end,
      active: Boolean(task.active),
      // The firmware echoes maxPower: 0 for a window with no power cap. Passing
      // that through would tell the agent the window is limited to zero watts —
      // the opposite of what it means — so both 0 and absent become null.
      maxPowerW: slot.maxPower ? slot.maxPower : null,
      ...(task.initTime.timeList.length > 1 ? { slot: index } : {}),
    };
  });
}

export async function getSchedule(entry: ChargerEntry, element?: string): Promise<ScheduleWindow[]> {
  const name = await resolveElement(entry, element);
  return (await readTasks(entry, name)).flatMap(toWindows);
}

export async function addSchedule(
  entry: ChargerEntry,
  start: string,
  end: string,
  opts: { element?: string; maxPowerW?: number } = {},
): Promise<ScheduleWindow> {
  // the conversion validates the times: if malformed, it throws before touching the network
  const slot = windowToTimeList(start, end);
  const name = await resolveElement(entry, opts.element);
  const existing = await readTasks(entry, name);
  const id = existing.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  const task: SchedulerTask = {
    id, active: true, user: '', group: 0, priority: 1,
    initTime: {
      day: 0, month: 0, weekday: 0,
      timeList: [opts.maxPowerW === undefined ? slot : { ...slot, maxPower: opts.maxPowerW }],
    },
  };

  await entry.device.createSchedulerTask(name, task);
  return toWindows(task)[0];
}

export async function removeSchedule(
  entry: ChargerEntry,
  id: number,
  element?: string,
): Promise<{ removed: number }> {
  const name = await resolveElement(entry, element);
  const existing = await readTasks(entry, name);
  if (!existing.some((t) => t.id === id)) {
    const ids = existing.map((t) => t.id);
    throw new ValidationError(
      ids.length === 0
        ? `no scheduled window on "${name}"`
        : `window ${id} does not exist on "${name}". Existing ids: ${ids.join(', ')}`,
    );
  }
  await entry.device.deleteSchedulerTask(name, id);
  return { removed: id };
}
