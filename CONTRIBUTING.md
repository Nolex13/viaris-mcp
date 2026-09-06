# Contributing

## The most useful thing you can do

**Run it against a charger that isn't a `VIARIS UNI` on firmware 7.2.53.**

That is the one device this was mapped from. Everything else in the family
shares the API surface, and the code reads its limits from what the device
reports rather than assuming them — but three-phase units and multi-connector
models have never been tested against real hardware.

If you have one, `get_configuration` and `get_status` are enough to learn a
lot. Open an issue with the output (minus your serial, MAC and IPs) whether it
works or not. "It just worked on a Combi+" is a genuinely valuable report.

## Getting set up

```bash
git clone https://github.com/Nolex13/viaris-mcp.git
cd viaris-mcp
npm install
npm test
```

The full suite runs without a charger. That is deliberate: `device/` tests run
against fixtures recorded from real hardware, `transport/` against a local HTTP
server, `tools/` against fakes.

## Before you open a pull request

```bash
npm run typecheck && npm run lint && npm test && npm run smoke
```

CI runs the same four on Node 20, 22 and 24.

## What the review will look for

Beyond the usual, this project has a few rules that exist for concrete reasons.
[CLAUDE.md](CLAUDE.md) has the full version; the short one:

**Layer boundaries.** `tools/` → `device/` → `transport/`, never upward.
`device/` returns what the device sent — no unit conversion, no translating
numeric codes. That belongs in `tools/`.

**No silent fallbacks.** An error travels as an error, never as `0`, `null`,
`[]` or a partial value. An agent that receives `0 W` instead of a failure will
confidently tell someone their house is drawing nothing. `?? ''` and `?? []`
are the usual shape of this mistake.

**No hardcoded limits.** Every ceiling comes from what the charger reports.
And check the value is a finite number before comparing against it —
`amps > undefined` is `false`, which silently disables the check exactly when
it matters.

**Retry only what is idempotent.** `POST` creates a scheduler window and is
attempted once; a retry after a lost response leaves a duplicate the user never
asked for.

**Tests that could fail.** A test that passes equally with and without your
change is decoration. If you fix a calculation, pick inputs where the old and
new results differ — there is an example in the SPL ceiling tests, which use
chargers of different capacity precisely because identical ones make the bug
and the fix produce the same number.

## Adding a tool

Tools are shaped like **intents**, not endpoints. `set_home_power_limit` takes
watts, not a modulator payload; `add_charging_schedule` takes `"23:00"`, not
minutes since midnight. If a proposed tool can only be described in terms of
the device's own vocabulary, it probably belongs inside an existing one.

When you add an endpoint to `device/`, add its verb and path to the
table-driven routing test. That layer *is* its paths: a `?level=cfg` mistaken
for `?level=all` returns different data with no error at all.

**These will not be merged**, whatever the implementation quality: tools for
`POST /reset/sys`, `POST /updaterESP`, `POST /updaterST`, or any write to
`/modules/network`. Each can leave a charger unreachable, and none has a
recurring purpose that justifies putting it within reach of an agent. OCPP,
Modbus and MQTT stay read-only for the same reason at lower stakes: they are
installation-time settings.

## Testing against real hardware

Reads are safe. **Writes change a real electrical installation** — never run a
`set_*`, `add_*` or `remove_*` tool against a charger that isn't yours, and
restore the original value when you are done.

```bash
VIARIS_HOST=192.168.1.100 npx tsx -e "
import { Transport } from './src/transport/transport.js';
import { ChargerRegistry, loadChargers } from './src/registry.js';
import { getChargerStatus } from './src/tools/status.js';
const t = new Transport();
const r = new ChargerRegistry(loadChargers(process.env), t.request);
console.log(await getChargerStatus(r.resolve()));
"
```

The device responds slowly. Concurrent requests all succeed, but latency grows
under load.

## Commits and reporting

Commit messages in English, present tense, explaining *why* where it is not
obvious. Small focused commits over one large one.

Found a security problem? Please use a
[security advisory](https://github.com/Nolex13/viaris-mcp/security/advisories/new)
rather than a public issue.

Not affiliated with Orbis. This is a hobby project maintained in spare time —
reviews may take a week, and that is the honest expectation rather than a
formality.
