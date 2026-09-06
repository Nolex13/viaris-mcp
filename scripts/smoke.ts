/**
 * End-to-end check that the built server actually speaks MCP: spawn it over
 * stdio, complete the handshake, and confirm every expected tool is exposed.
 *
 * Deliberately does not talk to a charger. It points at a documentation IP so
 * that startup configuration is exercised while no request ever leaves the
 * process — this runs in CI, where no charger exists.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOLS = [
  'get_status',
  'get_configuration',
  'get_charging_history',
  'get_charging_schedule',
  'add_charging_schedule',
  'remove_charging_schedule',
  'set_home_power_limit',
  'set_charger_current_limit',
  'set_solar_config',
  'set_led_brightness',
  'set_device_time',
];

/** Endpoints that would brick or strand a charger; they must have no tool. */
const FORBIDDEN_SUBSTRINGS = ['reset', 'firmware', 'updater', 'network'];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, VIARIS_CHARGERS: 'test=192.0.2.1' }, // TEST-NET-1, RFC 5737
});

const client = new Client({ name: 'smoke', version: '0.0.0' });

let failed = false;
const fail = (message: string) => {
  console.error(`FAIL  ${message}`);
  failed = true;
};

try {
  await client.connect(transport);
  console.log('ok    MCP handshake completed');

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();

  for (const expected of EXPECTED_TOOLS) {
    if (!names.includes(expected)) fail(`tool missing: ${expected}`);
  }
  console.log(`ok    ${names.length} tools exposed`);

  const unexpected = names.filter((n) => !EXPECTED_TOOLS.includes(n));
  if (unexpected.length > 0) fail(`unexpected tools: ${unexpected.join(', ')}`);

  for (const name of names) {
    const hit = FORBIDDEN_SUBSTRINGS.find((word) => name.includes(word));
    if (hit) fail(`tool "${name}" looks like a forbidden operation ("${hit}")`);
  }
  console.log('ok    no destructive tool exposed');

  for (const tool of tools) {
    if (!tool.description || tool.description.length < 20) {
      fail(`tool "${tool.name}" has no usable description`);
    }
  }
  console.log('ok    every tool carries a description');

  // The published input schemas are the interface a model reads to decide when
  // and how to call a tool, and nothing else in the suite asserts on them. A
  // dependency bump once turned a constrained choice into a three-branch anyOf
  // and dropped every parameter description would have gone unnoticed too.
  for (const tool of tools) {
    const properties = (tool.inputSchema as { properties?: Record<string, { description?: string }> })
      .properties ?? {};
    for (const [name, property] of Object.entries(properties)) {
      if (!property.description) {
        fail(`parameter "${tool.name}.${name}" reaches the model with no description`);
      }
    }
  }
  console.log('ok    every parameter carries a description');

  const intensity = (
    tools.find((t) => t.name === 'set_led_brightness')?.inputSchema as
      { properties?: { intensity?: { enum?: unknown[] } } }
  )?.properties?.intensity;
  const values = intensity?.enum;
  if (!Array.isArray(values) || JSON.stringify([...values].sort((a, b) => Number(a) - Number(b))) !== '[0,50,100]') {
    fail(`set_led_brightness.intensity should publish enum [0,50,100], got ${JSON.stringify(intensity)}`);
  } else {
    console.log('ok    constrained choices publish as an enum');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.close().catch(() => undefined);
}

process.exit(failed ? 1 : 0);
