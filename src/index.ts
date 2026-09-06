#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ChargerRegistry, loadChargers } from './registry.js';
import { Transport } from './transport/transport.js';
import { perCharger, perChargerIsError } from './tools/aggregate.js';
import { getChargerStatus } from './tools/status.js';
import { getChargingHistory } from './tools/history.js';
import { getConfiguration } from './tools/configuration.js';
import { addSchedule, getSchedule, removeSchedule } from './tools/schedule.js';
import { setChargerCurrentLimit, setHomePowerLimit } from './tools/limits.js';
import { setDeviceTime, setLedBrightness, setSolarConfig } from './tools/settings.js';

const transport = new Transport();
const registry = new ChargerRegistry(loadChargers(process.env), transport.request);

const server = new McpServer({ name: 'viaris', version: '0.1.0' });

/** Serializes a result as MCP text content. */
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

/** Converts an error into an MCP error response, without inventing any values. */
const failure = (err: unknown) => ({
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

/**
 * Serializes the result of perCharger as MCP content, marking the response
 * as an error only when perChargerIsError declares it so (all entries
 * failed). The actual decision lives in aggregate.ts, testable without the
 * MCP response format.
 */
const perChargerResult = (results: Record<string, unknown>) => ({
  ...json(results),
  isError: perChargerIsError(results),
});

const chargerParam = z.string().optional()
  .describe('Charger name. Unnecessary if only one is configured.');

const elementParam = z.string().optional()
  .describe('Connector name. Unnecessary if the charger has only one.');

server.registerTool(
  'get_status',
  {
    description:
      'Charging status and instantaneous power of the chargers: how much the house is drawing, ' +
      'how much the car is drawing, and the active limits. Without "charger" it reports all chargers.',
    inputSchema: { charger: chargerParam, element: elementParam },
  },
  async ({ charger, element }) => {
    try {
      const entries = charger === undefined ? registry.all() : [registry.resolve(charger)];
      return perChargerResult(await perCharger(entries, (e) => getChargerStatus(e, element)));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'get_charging_history',
  {
    description:
      'Past charging sessions, most recent first: start, end, energy delivered in Wh, ' +
      'duration in minutes, and what started and stopped the charge.',
    inputSchema: {
      charger: chargerParam,
      limit: z.number().int().positive().max(100).optional()
        .describe('Maximum number of sessions to return.'),
    },
  },
  async ({ charger, limit }) => {
    try {
      const entries = charger === undefined ? registry.all() : [registry.resolve(charger)];
      return perChargerResult(await perCharger(entries, (e) => getChargingHistory(e, limit)));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'get_configuration',
  {
    description:
      'Full read-only configuration: device, power limits, SPL mode, solar, LEDs, and under ' +
      '"readOnly" OCPP, Modbus and MQTT, which can only be changed from the web interface.',
    inputSchema: { charger: chargerParam },
  },
  async ({ charger }) => {
    try {
      const entries = charger === undefined ? registry.all() : [registry.resolve(charger)];
      return perChargerResult(await perCharger(entries, getConfiguration));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'get_charging_schedule',
  {
    description: 'Scheduled charging time windows, with times in HH:MM format.',
    inputSchema: { charger: chargerParam, element: elementParam },
  },
  async ({ charger, element }) => {
    try {
      const entries = charger === undefined ? registry.all() : [registry.resolve(charger)];
      return perChargerResult(await perCharger(entries, (e) => getSchedule(e, element)));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'add_charging_schedule',
  {
    description:
      'Schedules a charging time window. Times are in HH:MM format; a window crossing ' +
      'midnight (e.g. 23:00-06:00) is handled automatically.',
    inputSchema: {
      charger: chargerParam,
      element: elementParam,
      start: z.string().describe('Start time, HH:MM format, e.g. "23:00".'),
      end: z.string().describe('End time, HH:MM format, e.g. "06:00".'),
      maxPowerW: z.number().int().positive().optional()
        .describe('Maximum power in watts during the window.'),
    },
  },
  async ({ charger, element, start, end, maxPowerW }) => {
    try {
      // write: the charger must be specified explicitly when more than one is configured
      const entry = registry.resolve(charger);
      return json(await addSchedule(entry, start, end, { element, maxPowerW }));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'remove_charging_schedule',
  {
    description: 'Removes a scheduled time window, given the id returned by get_charging_schedule.',
    inputSchema: {
      charger: chargerParam,
      element: elementParam,
      id: z.number().int().positive().describe('Id of the window to remove.'),
    },
  },
  async ({ charger, element, id }) => {
    try {
      return json(await removeSchedule(registry.resolve(charger), id, element));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'set_home_power_limit',
  {
    description:
      'Sets the maximum power in watts that the household electrical supply can deliver. If the ' +
      'chargers are in an SPL master/slave setup the limit is written to the master and propagates; ' +
      'if they are independent, the response includes a warning about the risk of exceeding the contracted power.',
    inputSchema: {
      charger: chargerParam,
      limitW: z.number().int().positive().describe('Power limit in watts, e.g. 4000.'),
    },
  },
  async ({ charger, limitW }) => {
    try {
      return json(await setHomePowerLimit(registry, limitW, charger));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'set_charger_current_limit',
  {
    description:
      'Sets the maximum current in amperes that the charger can deliver to the car. ' +
      'The allowed maximum is whatever the device declares.',
    inputSchema: {
      charger: chargerParam,
      amps: z.number().int().positive().describe('Maximum current in amperes, e.g. 16.'),
    },
  },
  async ({ charger, amps }) => {
    try {
      return json(await setChargerCurrentLimit(registry.resolve(charger), amps));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'set_solar_config',
  {
    description: 'Enables or disables solar charging and sets its priority.',
    inputSchema: {
      charger: chargerParam,
      enabled: z.boolean().describe('true to enable solar charging.'),
      priority: z.number().int().min(0).max(3).optional().describe('Priority of the solar source.'),
    },
  },
  async ({ charger, enabled, priority }) => {
    try {
      return json(await setSolarConfig(registry.resolve(charger), { enabled, priority }));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'set_led_brightness',
  {
    description: 'Sets the charger LED intensity: 0 off, 50 reduced, 100 full.',
    inputSchema: {
      charger: chargerParam,
      // z.literal with an array emits {type: number, enum: [...]}, which reads
      // to a model as "pick one of these". A union of three literals emits a
      // three-branch anyOf that says the same thing far less legibly.
      intensity: z.literal([0, 50, 100])
        .describe('LED intensity: 0, 50, or 100.'),
    },
  },
  async ({ charger, intensity }) => {
    try {
      return json(await setLedBrightness(registry.resolve(charger), intensity));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'set_device_time',
  {
    description:
      'Synchronizes the charger clock. Without parameters it sets the current time. ' +
      'The time zone requires timezone and timezoneCode together.',
    inputSchema: {
      charger: chargerParam,
      epochSeconds: z.number().int().positive().optional()
        .describe('Moment to set, in epoch seconds. If omitted, uses the current time.'),
      timezone: z.string().optional().describe('POSIX time zone string, e.g. "CET-1CEST,M3.5.0,M10.5.0/3".'),
      timezoneCode: z.number().int().optional().describe('Numeric time zone code expected by the firmware.'),
    },
  },
  async ({ charger, epochSeconds, timezone, timezoneCode }) => {
    try {
      return json(await setDeviceTime(registry.resolve(charger), { epochSeconds, timezone, timezoneCode }));
    } catch (err) {
      return failure(err);
    }
  },
);

await server.connect(new StdioServerTransport());
