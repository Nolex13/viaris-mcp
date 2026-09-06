---
title: Device API reference
description: The local HTTP API of the Orbis Viaris charger, mapped from real firmware.
---

# Orbis Viaris — local HTTP API

Mapped by interrogating a real device and reading the firmware's own web
interface. Useful on its own if you want to talk to the charger directly.

Serial numbers, MAC and IP addresses on this page are placeholders.

## The device this was mapped from

| | |
|---|---|
| Model | VIARIS UNI |
| Firmware (ESP) | 7.2.53 |
| Firmware (power stage) | 1PH_FW_ORB_V05.1 — single phase |
| Firmware (Cortex) | 003.005.010 |
| Hardware | 8.0 |
| Connector | Mennekes Type 2, 5 m cable |
| Max current | 32 A (7360 W) |
| Modules enabled | OCPP, Modbus, Solar |
| MAC prefix | `E8:9F:6D:…` — Espressif, so the controller is an ESP32 |

Other models in the family share this API surface; the values differ.

## Things worth knowing before you start

**No authentication.** Every endpoint below is open to anyone who can reach the
device on the network. There is no token, no password, no session.

**It does not answer ICMP.** `ping` fails against a charger that is perfectly
healthy. Use an HTTP request to check whether it is up.

**It is slow, and it serialises internally.** Concurrent requests all succeed,
but latency grows with load: twenty at once still complete, the slowest after
about thirteen seconds.

**HTTP/1.1 works fine.** An earlier version of these notes claimed the device
only spoke HTTP/1.0. That was wrong — measurement with pauses between requests
gives an identical success rate for both. The failures that suggested it were
requests fired while the device was still busy with previous traffic.

## Device

| Method | Path | Payload / notes |
|---|---|---|
| GET | `/device` | Identity, enabled modules, current limits |
| PUT | `/device?level=ampacity` | `{"ampacity": 32}` — charger's max current in amps |
| PUT | `/device?level=midAnalyzers` | `{"midAnalyzers": n}` |
| PUT | `/device?level=rfid` | `{"rfid": bool, "eocMode": "own"｜"any"}` |
| GET | `/device/localtime` | `{"localtime": <epoch seconds>}` — the device clock |
| PUT | `/device/localtime` | `{"localtime": <epoch seconds>}` |
| PUT | `/device/rt` | `{"period":3,"timeout":30,"status":true}` — enables the realtime stream on the WebSocket. GET is not supported. |
| POST | `/reset/sys` | `{"timeout":1000,"type":"hard"｜"factoryresetsoft"｜"factoryresethard"}` |

A `GET /device` response looks like this:

```json
{
  "model": "VIARIS UNI",
  "serial": "EVVC36DAABBCC",
  "maxPower": 7360,
  "ampacity": 32,
  "maxAmpacity": 32,
  "limitPower": 4000,
  "selectorPower": 7360,
  "mac": "E8:9F:6D:AA:BB:CC",
  "fwv": "7.2.53",
  "ocpp": true, "modbus": true, "solar": true,
  "elements": [{ "id": 1, "type": 1, "name": "mennekes", "info": "2 Menekes manguera 5mT2" }]
}
```

## Charge points (`elements`)

| Method | Path | Payload / notes |
|---|---|---|
| GET | `/elements?level=cfg` | Per-connector config: `minPower`, `limitPower`, `phaseRotation`, temperature thresholds |
| PUT | `/elements` | `{"minPower": <W>}` |
| PUT | `/elements/<name>` | `{"limitPower": <W>, "phaseRotation": n}` |
| GET | `/modules/evsm/elements` | **Charging state**: `event`, `state`, `idCharge`, `user`, `localtime` |

`/modules/evsm/elements` is **read-only**: `PUT` answers `405 Method Not
Allowed`. There is no local endpoint that starts or stops a session — the
vendor app issues those through `apiv3.orbis.com.es`, and the charger receives
them over its own outbound connection. Captured rather than assumed; see the
project README for the evidence.

### Charging state codes

Taken from the firmware's own web interface:

| Code | Meaning |
|---|---|
| 1, 2 | free |
| 3, 4 | connected |
| 5, 6 | charging |
| 7 | paused |
| 8 | finished |
| 14 | on |
| 31 | off |
| 32 | inoperative |

## Modulator — live power and the household limit

| Method | Path | Payload / notes |
|---|---|---|
| GET | `/modules/modulator?level=stat` | **Live**: `totalPower`, `evsePower`, `homePower`, `selectorPower`, all in watts |
| GET | `/modules/modulator?level=cfg` | `limitPower`, `limitPowerByPhase`, `notifCycle`, night-PV handling |
| PUT | `/modules/modulator` | `{"limitPower": <W>, "limitPowerByPhase":[W,W,W], "switchEnabled": bool, "unswitchCurrent": mA}` |
| GET | `/modules/modulator/historic` | Charging session history, **CSV inside the JSON `body` field** |

Charging windows fire on the **device's own clock**, so a charger whose clock
has drifted will run a schedule at the wrong time while reporting it correctly.
Worth checking `GET /device/localtime` before trusting a schedule.

`limitPower` is the **household** budget, not the charger's capacity. The
modulator subtracts what the house is drawing and gives the car the remainder,
capped by the charger's own maximum. This distinction matters: a 10 kW supply
contract with a 7.36 kW charger legitimately wants `limitPower: 10000`.

### History CSV

Eighteen comma-separated columns per row. Thirteen are identified:

```
tsStart, ?, ?, element, ?, maxPower, tsStart, user, startSource,
meterStartWh, tsEnd, user, stopSource, meterEndWh, energyWh, energyWh, 0, 0
```

Columns 2, 3, 5, 17 and 18 are constant across every row of a full buffer, so
their meaning cannot be deduced by observation. `meterEndWh - meterStartWh`
equals `energyWh`, which confirms the meter readings.

The buffer is circular: expect the newest rows to wrap around to the start.

## Scheduler — charging windows

| Method | Path | Payload / notes |
|---|---|---|
| GET | `/modules/scheduler/elements?level=cfg` | `tasks[]`, `defaultState` |
| POST | `/modules/scheduler/elements/<name>` | Create a task |
| PUT | `/modules/scheduler/elements/<name>` | Update a task |
| DELETE | `/modules/scheduler/elements/<name>` | `{"tasks":[{"id": n}]}` |

```json
{"tasks":[{"id":1,"active":true,"user":"","group":0,"priority":1,
  "initTime":{"day":0,"month":0,"weekday":0,
    "timeList":[{"hourMin":1320,"duration":420,"maxPower":6000}]}}]}
```

`hourMin` is minutes since midnight and `duration` is minutes. For a window
that crosses midnight, add a day to the end time before subtracting: `23:00` to
`06:00` becomes `hourMin: 1380, duration: 420`.

Creation is **not idempotent** — the client picks the id, and a retry after a
lost response can leave you with a duplicate window.

`defaultState` decides what happens outside the windows: `1` permits charging,
`0` blocks it. Two things to know, both measured:

- The firmware **refuses to set it unless at least one window exists**,
  answering HTTP 200 with `data: {error: true, msg: ...}` per element. A client
  that only checks the status code will read a refusal as a success.
- It does **not** stop a session already in progress, not even when a window
  ends.

Two quirks on the way back out, both confirmed against real hardware:

- `active` accepts a boolean on write but comes back as `1` or `0`.
- `maxPower` comes back as `0` for a window with no power cap. Read literally
  that says "limited to zero watts", which is the opposite of what it means.

## SPL — sharing one supply between chargers

`splMode` is the field that matters: `0` independent, `1` master, `2` slave.

The master holds `splLimitPower`, the shared household limit, and distributes it
among the chargers. Slaves point at it via `splIp` / `splPort`, with
`splSlaveFailPower` as the fallback if that link drops.

This is a firmware feature: the chargers coordinate with each other
continuously. Two chargers left as `splMode: 0`, each capped at 4000 W, will
together draw 8000 W — neither of them knows about the other.

| Method | Path |
|---|---|
| GET/PUT | `/modules/spl?level=cfg` |

## Solar

| Method | Path | Payload / notes |
|---|---|---|
| GET | `/modules/solar?level=cfg` | `enabled`, `maxFvPower`, `priority`, inverter Modbus config |
| PUT | `/modules/solar` | Same shape |

## Other modules

| Method | Path |
|---|---|
| GET/PUT | `/modules/hmi?level=cfg` — LEDs; intensity accepts only 0, 50 or 100 |
| GET/PUT | `/modules/modbus?level=cfg` |
| GET/PUT | `/modules/ocpp?level=all` |
| GET/PUT | `/modules/mqtt_user?level=all`, GET `/modules/mqtt?level=stat` |
| GET/PUT | `/modules/network?level=all`, GET `?level=list_aps` |
| GET/PUT | `/modules/shelly?level=cfg` |
| GET/PUT/POST | `/modules/tags?level=cfg｜file｜save｜tagid` — RFID cards |
| PUT | `/modules/astcal?level=clock` — `{"geoloc":{"timezone":"...","timezoneCode":n}}` |
| POST | `/updaterESP`, `/updaterST` — firmware upload |

## WebSocket

`ws://<charger-ip>/` — push notifications only; it accepts no commands.

Messages are `<type>[:<parameter>] <payload>`, space separated:

- `evsm_elem:<name> <state>` — the charge point changed state
- `modulator_processes <json>` — live power figures, only after
  `PUT /device/rt` with `status: true`

## Endpoints this project will not touch

`POST /reset/sys`, `POST /updaterESP`, `POST /updaterST` and any write to
`/modules/network`. They are documented here because they exist, but no MCP
tool exposes them: each can leave a charger unreachable or unusable, and none
has a day-to-day purpose worth that risk.

---

[Home](index.html) · [Design notes](design.html) · [Repository](https://github.com/Nolex13/viaris-mcp)
