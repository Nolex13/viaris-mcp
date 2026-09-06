# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this is

An MCP server that exposes the local HTTP API of Orbis Viaris EV chargers to an
agent. It runs over stdio, so it lives on the same machine as the agent, and
that machine has to be on the same LAN as the chargers.

## Architecture: three layers, dependencies point down only

```
tools/      intent-shaped MCP tools — watts, "HH:MM", states as strings
   ↓
device/     typed client per module — endpoints and payloads, raw device data
   ↓
transport/  node:http plus the retry policy
```

No layer knows about the one above it. That is what makes each testable in
isolation by substituting the layer below with a fake, and it is the rule to
preserve when adding anything.

Concretely:

- **`transport/`** knows HTTP and nothing about the Viaris. Its only real
  responsibility is the retry policy.
- **`device/`** knows the firmware's endpoints and payload shapes. It returns
  data **exactly as the device sends it** — no unit conversion, no translating
  numeric codes. If you feel like making a return value "more useful" here,
  that belongs one layer up.
- **`tools/`** is the only place that knows `hourMin: 1380` means `"23:00"`,
  that state `5` means `charging`, and that the history arrives as CSV.

## Non-negotiable rules

**Retry only what is idempotent.** `GET`, `PUT` and `DELETE` are retried with
backoff; `POST` is attempted **once**. The POST creates a scheduler task — if
the response is lost after the device applied it, a retry produces a duplicate
time window. An honest error beats a phantom charging schedule.

A response that arrived but is *wrong* (non-2xx, unparseable body) is never
retried: the device is fine, the content is not.

**No silent fallbacks.** An error travels as an error, never as `0`, `null`,
`[]` or a partial value. An agent that receives `0 W` instead of a failure
draws confident, wrong conclusions about someone's electrical installation.
This is the rule most easily broken by accident — `?? ''` and `?? []` are the
usual shape of the mistake.

**Validation ranges come from the device.** Every ceiling is read from what the
charger reports (`maxAmpacity`, `maxPower`), never hardcoded. Two consequences
that are easy to get wrong:

- Check the value you read is actually a finite number before comparing against
  it. `amps > undefined` is `false` in JavaScript, so a missing field silently
  disables the check exactly when it matters.
- Where the device declares *no* maximum for a quantity, do not borrow one from
  a different quantity. `set_home_power_limit` deliberately has no ceiling: the
  household limit is a property of the electrical supply, not of the charger.

**States are strings, never codes.** An agent that reads `5` cannot reason about
it; one that reads `charging` can.

**These endpoints must never gain a tool:** `POST /reset/sys`,
`POST /updaterESP`, `POST /updaterST`, and any write to `/modules/network`.
They can make the charger unreachable or unusable. OCPP, Modbus and MQTT stay
read-only.

## Multiple chargers

Coordination between chargers is a **firmware** feature (the SPL module), not
something this server reimplements — the chargers talk to each other
continuously, we poll. `splMode` is `0` independent, `1` master, `2` slave; the
master holds the shared limit and distributes it.

This matters for safety: two independent chargers each capped at 4000 W will
together draw 8000 W and trip the meter. `set_home_power_limit` reads `splMode`
first and writes where it belongs, warning when the configuration is one the
device cannot make safe on its own.

## Testing

- **`transport/`** against a real `http.createServer`.
- **`device/`** against **fixtures recorded from a real charger**
  (`tests/fixtures/`), not invented payloads.
- **`tools/`** against a fake device.

The fixtures are anonymised: serial, MAC and IPs are plausible substitutes and
the charging history is synthetic. Keep them that way.

When you add an endpoint to `device/`, add its path and verb to the
table-driven routing test. This layer *is* its paths: a `?level=cfg` mistaken
for `?level=all` returns different data with no error.

## Working against a real charger

`VIARIS_HOST=<ip> npx tsx <script>` will talk to a real device. **Reads are
safe. Writes are not** — they change a real household electrical installation.
Never run a `set_*`, `add_*` or `remove_*` tool against someone's charger
without their explicit go-ahead, and restore the original value afterwards.

The device responds slowly and serialises internally; under many concurrent
requests latency grows but nothing fails.

## Two beliefs this project got wrong, so you don't repeat them

Early versions were built on two "constraints" that measurement later disproved:

1. *"The device only speaks HTTP/1.0."* It does not — a clean A/B test with
   pauses gives 5/5 for both versions. The original evidence came from requests
   fired immediately after other traffic: a busy device, mistaken for a
   protocol limit. This cost ~150 lines of hand-rolled socket code.
2. *"It handles one connection at a time."* It does not — 20 concurrent
   requests all succeed. This cost a per-host serialisation queue that made
   parallel reads sequential for no benefit.

The lesson worth keeping: when a device misbehaves under load, isolate the
variable before turning the observation into an architectural constraint. Both
of these were believed for the whole build, and the second one was later cited
as justification for an unrelated design decision.
