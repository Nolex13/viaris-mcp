---
title: Design notes
description: Why viaris-mcp is built the way it is, including the parts that were wrong.
---

# Design notes

## The shape of the problem

The charger already has a complete local HTTP API — the vendor's own web
interface uses it. So the work is not access, it is **translation**: turning
twenty-odd endpoints that speak in minutes-since-midnight and numeric state
codes into something an agent can reason about.

That framing drives most of what follows. The tools are shaped like intents,
not endpoints, and exactly one layer is allowed to know the difference.

## Three layers, dependencies pointing down

```
tools/      intent-shaped MCP tools — watts, "HH:MM", states as strings
   ↓
device/     typed client per module — endpoints and payloads, raw device data
   ↓
transport/  node:http plus the retry policy
```

No layer knows the one above it. Each is testable in isolation by substituting
the layer below with a fake, and the substance of each is genuinely different:
`transport/` knows HTTP, `device/` knows the firmware, `tools/` knows what a
person means by "charge overnight".

The rule earns its keep in the boring cases. `device/` returns `state: 5`
untranslated, even though translating it there would be convenient — because
then two layers would know the state table, and they would drift.

## Decisions worth explaining

### Retry is asymmetric, on purpose

`GET`, `PUT` and `DELETE` retry with backoff. `POST` gets **one** attempt.

The POST creates a scheduler window. If the response is lost after the device
already applied it, a retry produces a second identical window — and the user
finds their car charging at the wrong time, with no error ever reported. An
honest failure is better than a silent duplicate.

Deletes are safe to repeat because the caller supplies the id: deleting an
already-deleted window is a no-op.

A response that *arrived* but is wrong — non-2xx, unparseable body — is never
retried either. The device is fine; the content is not. Retrying just wastes
time before failing.

### Errors never degrade into values

An agent that receives `0 W` instead of a failure will tell someone their house
is drawing nothing. So a missing field, a truncated response, or an unreachable
charger travels as an error, all the way up.

The one place this bends is reading history: the device's circular buffer
contains partial rows at the wrap point, and those are skipped rather than
failing the whole read. Malformed rows in an append-only log are expected
noise, not a failed request. Any row whose *energy* value is unreadable is
dropped entirely, rather than reported as zero.

### Validation ceilings come from the device

Nothing hardcodes 32 A or 7360 W. The limits are read from what the charger
reports, so there is no second source of truth to keep in sync with firmware.

Two consequences that are easy to get wrong, and were:

- A missing field must be checked explicitly. `amps > undefined` is `false` in
  JavaScript, so an absent `maxAmpacity` would silently *disable* the only
  protection on a write.
- Where the device declares no maximum, none is invented.
  `set_home_power_limit` deliberately has no ceiling: the household limit is a
  property of the electrical supply, and borrowing the charger's capacity as a
  proxy rejects a legitimate 10 kW contract behind a 7.36 kW charger.

### Multiple chargers: the firmware already solved this

Chargers coordinate through the SPL module, talking to each other continuously.
This server polls. Reimplementing load balancing on top would be strictly worse
than the thing already running inside the devices.

So `set_home_power_limit` reads the configuration and writes where it belongs:
to the master when there is one, to the target charger when there is not — and
returns a **warning** when it finds a configuration the firmware cannot make
safe on its own, such as two independent chargers whose limits sum past the
supply contract, or a slave whose master has gone missing.

Warning rather than refusing is a deliberate choice: a refusal would block
legitimate setups nobody anticipated. The user is told; the user decides.

### Connectors and chargers use one addressing rule

With one charger the name is optional; with two it becomes required, because
silently picking the first would answer confidently about the wrong device.
Connectors within a charger follow exactly the same rule. Two levels, one
mechanism.

## What this deliberately does not do

Reset, firmware upload and network reconfiguration have no tool. Each can leave
a charger unreachable, and none has a day-to-day purpose that justifies the
risk of an agent reaching for it.

OCPP, Modbus and MQTT are readable but not writable. They are installation-time
settings; there is no recurring intent for a tool to express.

There is no database, no background process and no cache. Every tool call asks
the charger.

## Two constraints that were wrong

Worth recording, because they shaped the code for the entire build before
measurement caught them.

**"The device only speaks HTTP/1.0."** It does not. A clean A/B test — five
requests per protocol, five seconds apart — gives 5/5 for both. The original
evidence was two HTTP/1.1 failures, each of which happened to follow other
traffic immediately: a busy device, mistaken for a protocol limitation.

The cost was about 150 lines of hand-rolled socket code: manual header parsing,
`Content-Length` accounting, and four socket event handlers, all of which
`node:http` does correctly for free.

**"It handles one connection at a time."** It does not. Three, six, twelve and
twenty concurrent requests all succeed; latency grows but nothing fails. The
cost was a per-host serialisation queue that turned parallel reads into
sequential ones — and, worse, was later cited as justification for an unrelated
restructuring, on the grounds that "parallelism doesn't help anyway".

The lesson worth carrying: when a device misbehaves under load, isolate the
variable before promoting the observation to an architectural constraint. A
wrong measurement does not stay contained — it becomes a premise in arguments
made months later.

## Testing

- **`transport/`** against a real `http.createServer`, including the behaviour
  the device actually exhibits: a complete response on a connection it never
  closes.
- **`device/`** against fixtures recorded from a real charger, not invented
  payloads. This layer *is* its paths, so the routing test asserts verb and
  path for every method: a `?level=cfg` mistaken for `?level=all` returns
  different data with no error.
- **`tools/`** against a fake device, where the conversions live: state codes,
  `HH:MM` arithmetic, the window that crosses midnight, CSV parsing, and each
  branch of the SPL logic.

Fixtures are anonymised and the charging history is synthetic.

One test earns a special mention: the SPL ceiling test uses chargers of
*different* capacity, because with identical ones the correct formula and the
buggy one produce the same number. A test that cannot distinguish the fix from
the bug is decoration.

---

[Home](index.html) · [API reference](api.html) · [Repository](https://github.com/Nolex13/viaris-mcp)
