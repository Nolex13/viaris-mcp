# viaris-mcp

[![CI](https://github.com/Nolex13/viaris-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nolex13/viaris-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)

An [MCP](https://modelcontextprotocol.io) server that puts an **Orbis Viaris EV
charger** within reach of an AI agent: what the house is drawing right now,
what the car took last night, and when it should charge next.

It speaks to the charger over your own network. No cloud account, no vendor
app, nothing leaves the LAN.

```
You    "Is the car charging? How much is the house pulling?"
Agent  → get_status
       "Nothing plugged in. The house is drawing 436 W, and the charger is
        allowed up to 4000 W of the household budget."

You    "Only charge between 11pm and 6am."
Agent  → add_charging_schedule  start 23:00  end 06:00
       "Done — 23:00–06:00 is now active on the mennekes connector."

You    "How much did I charge last month?"
Agent  → get_charging_history
       "Eleven sessions, 214 kWh, averaging 3h20m each."
```

---

## Requirements

- **Node.js 20 or newer**
- An Orbis Viaris charger **on the same network** as the machine running your
  agent. The server uses MCP's stdio transport, so it runs as a subprocess of
  the agent — it cannot reach across networks.
- The charger's IP address. It does not answer `ping`, so find it in your
  router's DHCP list (the MAC begins `E8:9F:6D`, Espressif) or in the Viaris app.

Verify you can reach it before going further:

```bash
curl -s http://<charger-ip>/device
```

You should get JSON with `model` and `serial`. If that works, everything below
will.

## Install

Nothing to install. The configurations below run it with `npx`, which fetches
the package the first time and caches it after.

If you would rather pin a version than take whatever is newest — reasonable for
something that can change your household power limit — use
`viaris-mcp@0.1.0` in place of `viaris-mcp` everywhere below.

<details>
<summary><b>From source instead</b></summary>

Worth doing if you want to read the code before pointing it at your charger, or
if you plan to change it.

```bash
git clone https://github.com/Nolex13/viaris-mcp.git
cd viaris-mcp
npm install
npm run build
```

That produces `dist/index.js`. Everywhere below, replace

```json
"command": "npx", "args": ["-y", "viaris-mcp"]
```

with

```json
"command": "node", "args": ["/absolute/path/to/viaris-mcp/dist/index.js"]
```
</details>

## Configure

One environment variable, `VIARIS_CHARGERS`, listing each charger as
`name=address`:

```bash
VIARIS_CHARGERS="garage=192.168.1.100"
VIARIS_CHARGERS="garage=192.168.1.100,outdoor=192.168.1.101"
```

The name is yours to choose — it is how you will refer to the charger when
talking to the agent, so `garage` beats `charger1`.

With one charger configured, the `charger` parameter is optional everywhere.
With two or more it becomes required for writes, and reads report on all of
them — a charger that is switched off shows up as an error in its own entry
without spoiling the others.

---

## Wire it into your agent

<details open>
<summary><b>Claude Desktop</b></summary>

Edit the config file:

- macOS — `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows — `%APPDATA%\Claude\claude_desktop_config.json`
- Linux — `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "viaris": {
      "command": "npx",
      "args": ["-y", "viaris-mcp"],
      "env": { "VIARIS_CHARGERS": "garage=192.168.1.100" }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the connectors icon.
</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add viaris \
  --env VIARIS_CHARGERS=garage=192.168.1.100 \
  -- npx -y viaris-mcp
```

Then `/mcp` inside a session to confirm it connected.
</details>

<details>
<summary><b>Cline / Roo Code (VS Code)</b></summary>

Open the MCP servers panel → *Configure MCP Servers*, and add:

```json
{
  "mcpServers": {
    "viaris": {
      "command": "npx",
      "args": ["-y", "viaris-mcp"],
      "env": { "VIARIS_CHARGERS": "garage=192.168.1.100" },
      "disabled": false
    }
  }
}
```
</details>

<details>
<summary><b>Continue</b></summary>

In `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: viaris
    command: npx
    args:
      - -y
      - viaris-mcp
    env:
      VIARIS_CHARGERS: garage=192.168.1.100
```
</details>

<details>
<summary><b>Zed</b></summary>

In your `settings.json`:

```json
{
  "context_servers": {
    "viaris": {
      "command": {
        "path": "npx",
        "args": ["-y", "viaris-mcp"],
        "env": { "VIARIS_CHARGERS": "garage=192.168.1.100" }
      }
    }
  }
}
```
</details>

<details>
<summary><b>Any other MCP client, or your own agent</b></summary>

The server speaks MCP over **stdio**. Launch it as a subprocess with
`VIARIS_CHARGERS` in its environment, and speak MCP on its
stdin/stdout:

```bash
VIARIS_CHARGERS="garage=192.168.1.100" npx -y viaris-mcp
```

With the official SDK:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'npx',
  args: ['-y', 'viaris-mcp'],
  env: { ...process.env, VIARIS_CHARGERS: 'garage=192.168.1.100' },
}));

console.log(await client.listTools());
```
</details>

**Check it works** without an agent at all:

```bash
VIARIS_CHARGERS="garage=192.168.1.100" npx -y viaris-mcp
```

It should start and sit there waiting for MCP traffic on stdin — that means the
configuration parsed and the server is running. Ctrl-C to stop. A configuration
mistake exits immediately and says what is wrong.

From a clone, `npm run smoke` goes further: it completes a real MCP handshake
and verifies every tool is exposed as expected. Neither contacts your charger.

---

## Tools

### Reading

| Tool | Parameters | Returns |
|---|---|---|
| `get_status` | `charger?`, `element?` | Charging state, live household and vehicle power, active limits |
| `get_configuration` | `charger?` | Everything readable: device, power, SPL mode, solar, LEDs, clock drift, whether charging is allowed, plus OCPP/Modbus/MQTT under `readOnly` |
| `get_charging_history` | `charger?`, `limit?` | Past sessions, newest first: start, end, energy in Wh, duration |
| `get_charging_schedule` | `charger?`, `element?` | Programmed windows, times as `HH:MM` |

`get_status` answers with:

```json
{
  "charging": { "connector": "mennekes", "state": "free", "sessionId": 1, "user": null },
  "power":    { "home": 436, "car": 0, "total": 436, "unit": "W" },
  "limits":   { "homeLimit": 4000, "chargerMax": 7360 }
}
```

States are `free`, `connected`, `charging`, `paused`, `finished`, `on`, `off`,
`inoperative`.

### Writing

| Tool | Parameters | Effect |
|---|---|---|
| `add_charging_schedule` | `start`, `end`, `maxPowerW?`, `charger?`, `element?` | Adds a window. `"23:00"`→`"06:00"` crossing midnight is handled |
| `remove_charging_schedule` | `id`, `charger?`, `element?` | Removes a window by the id `get_charging_schedule` reports |
| `set_charging_allowed` | `allowed`, `charger?` | Permits or blocks charging outside the scheduled windows. Does **not** stop a session in progress |
| `set_home_power_limit` | `limitW`, `charger?` | The household power budget, in watts |
| `set_charger_current_limit` | `amps`, `charger?` | Charger's maximum current, capped at what the device reports |
| `set_solar_config` | `enabled`, `priority?`, `charger?` | Solar charging on/off and its priority |
| `set_led_brightness` | `intensity` (0, 50 or 100), `charger?` | LED brightness |
| `set_device_time` | `epochSeconds?`, `timezone?`, `timezoneCode?`, `charger?` | Clock, and timezone if both fields are given |

### Things to try

> Is the car plugged in?
>
> How much power is the house using right now?
>
> Set the household limit to 6 kW, we upgraded the contract.
>
> Charge only during the cheap night tariff, 11pm to 7am.
>
> How much energy did I use for charging in the last three months?
>
> Turn the charger LEDs down, they light up the bedroom.

---

## Limitations

**Everything runs on your LAN.** stdio transport means the server is a
subprocess of your agent, so the agent's machine must be on the same network as
the charger. There is no remote mode, and adding one would mean exposing an
unauthenticated device to a wider network.

**The device API has no authentication.** Anybody on your network can already
read and change your charger's settings. This server does not — cannot — fix
that; see [SECURITY.md](SECURITY.md) for what it does instead.

**Mapped from one device.** `VIARIS UNI`, firmware `7.2.53`, single-phase, 32 A.
Other models in the family share the API surface, and the code reads its limits
from the device rather than assuming them, but three-phase behaviour and
multi-connector models are **untested against real hardware**. Reports welcome.

**Writes have type and range validation and nothing else.** No confirmation
step, no read-only mode. Ranges come from what the device reports, so a
nonsense value is rejected, but a *plausible* wrong value is not. If your agent
reads untrusted content from the web, consider what a prompt injection could
reach.

**Five of the eighteen history columns are unidentified.** They are constant
across a full buffer, so their meaning cannot be deduced by observation. They
are omitted rather than guessed at.

**No live streaming.** The charger has a WebSocket that pushes power updates,
but every tool here polls on demand. There is no background process and no
stored history beyond the ~100 sessions the device keeps.

**Reset, firmware upload and network configuration are deliberately absent.**
They can leave a charger unreachable. Use the web interface.

**Starting and stopping a charging session is not possible over the local
network** — not a limitation of this project, but of the charger. Measured
rather than assumed:

- `PUT /modules/evsm/elements` answers `405 Method Not Allowed`: the resource
  exists and the firmware declines to make it writable.
- The charger's own web interface has no stop control anywhere in its code.
- Setting the scheduler's default state to "blocked", with and without an
  active window, leaves a running session charging — observed for four minutes
  past a window boundary at a steady 3.3 kW.
- Capturing the vendor Android app while pressing its stop button shows **zero
  packets** to the charger: it talks to `apiv3.orbis.com.es` over HTTPS. The
  command reaches the charger from the manufacturer's cloud, through the
  outbound connection the device keeps open.

`set_charging_allowed` is the closest available: it governs whether a session
may **begin**, and needs at least one scheduled window to exist before the
firmware accepts it. Whether it actually prevents a new session from starting
is not yet confirmed on hardware — the write lands and reads back, but the
blocking effect has not been observed.

## Possible improvements

Roughly in order of how much they would add:

- **A `charging_summary` tool** that aggregates history into the answer people
  actually want — energy per month, cost given a tariff, average session — so
  the agent does not have to do arithmetic over a hundred rows.
- **WebSocket streaming** for live power, exposed as an MCP resource that
  updates rather than a tool that polls.
- **Tariff awareness**: given a time-of-use tariff, let the agent propose a
  charging window rather than only setting one it was told.
- **A local OCPP server**, which is the one standards-based route to starting
  and stopping a session without the vendor cloud: the charger speaks OCPP, and
  `RemoteStopTransaction` is exactly that command. It is a project of its own
  rather than a tool to add here, but it is the honest answer to the biggest
  gap above.
- **A read-only mode** behind an environment variable, for people who want the
  monitoring without the ability to change anything.
- **Three-phase and multi-connector coverage**, which needs someone with the
  hardware more than it needs code.
- **Solar-aware scheduling**: the device already knows PV production; charging
  windows could follow it.
- **Identify the remaining CSV columns**, most likely by correlating a session
  recorded while watching the web interface.

If one of these is what you came for, say so in an
[issue](https://github.com/Nolex13/viaris-mcp/issues) — it is useful to know
which ones matter to someone.

---

## Troubleshooting

**`ping` says the charger is down.** It is not. The device does not answer
ICMP even when perfectly healthy. Use `curl -s http://<charger-ip>/device`
instead.

**I don't know the charger's IP.** Look in your router's DHCP client list for a
MAC starting `E8:9F:6D` (Espressif — the controller is an ESP32), or read it
from the Viaris app. Give it a DHCP reservation while you are there: the
configuration hardcodes the address.

**The agent doesn't list any Viaris tools.** Run the command from your config
by hand — `VIARIS_CHARGERS="garage=192.168.1.100" npx -y viaris-mcp` — and read
what it prints. Most failures are visible in one line there and invisible
inside an MCP client, which tends to report only that the server did not start.

Running from source instead? Check the path in your config is absolute, that it
points at `dist/index.js` rather than `src/index.ts`, and that you ran
`npm run build`.

**"no charger configured".** `VIARIS_CHARGERS` did not reach the process. Most
MCP clients do *not* inherit your shell environment, so the variable has to be
in the `env` block of the client's config, not in your `.bashrc`.

**"expected name=address".** The value needs a name for each charger:
`garage=192.168.1.100`, not just the address.

**"several chargers are configured: specify..."** You configured more than one
in `VIARIS_CHARGERS`, so writes need to say which. Tell the agent the name:
*"set the garage charger to 6 kW"*.

**First start is slow, or fails with no network.** `npx` fetches the package
the first time and caches it after. An MCP client that gives up quickly may
time out on that first run: start it once by hand to warm the cache.

**Everything times out.** Check the machine running the agent is on the same
network as the charger — stdio transport means the server is a subprocess
there, not somewhere else. A VPN capturing all traffic will also do this.

**A tool returns "the device did not declare the expected maximum".** Your
firmware answers `GET /device` without a field this server needs. Please
[open an issue](https://github.com/Nolex13/viaris-mcp/issues) with your
firmware version and the response — that is exactly the kind of difference
worth knowing about.

**Something worked in the web interface but not here.** The web interface may
use an endpoint that is deliberately not exposed (reset, firmware, network) or
one that was never mapped. [docs/api.md](docs/api.md) lists what is known.

---

## Development

```bash
npm install
npm test            # no charger required
npm run test:watch
npm run typecheck
npm run lint
npm run build
npm run smoke       # MCP handshake against the built server
```

Tests never touch a real charger: `device/` runs against fixtures recorded from
real hardware, `transport/` against a local HTTP server, `tools/` against
fakes.

To re-record fixtures from your own charger:

```bash
VIARIS_CHARGERS="garage=192.168.1.100" npm run record-fixtures
```

Note that this writes your serial, MAC and charging history into
`tests/fixtures/` — anonymise before committing.

Architecture and the reasoning behind it: [docs/design.md](docs/design.md).
Guidance for coding agents working here: [CLAUDE.md](CLAUDE.md).

## Contributing

Bug reports from other Viaris models are especially useful — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Device API reference](docs/api.md) — the charger's own HTTP endpoints
- [Design notes](docs/design.md) — why it is built this way, including what was wrong
- [Security](SECURITY.md) — what is exposed and what is deliberately not

## License

[MIT](LICENSE). Not affiliated with Orbis.
