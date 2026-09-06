---
title: viaris-mcp
description: Talk to your EV charger from an AI agent.
---

An [MCP](https://modelcontextprotocol.io) server that puts an Orbis Viaris EV
charger within reach of an AI agent: how much the house is drawing right now,
what the car took last night, and when it should charge next.

It talks to the charger over your own network. Nothing leaves the LAN, there is
no cloud account, and the vendor app is not involved.

```
You    "Is the car charging? How much is the house pulling?"
Agent  → get_status
       "Nothing plugged in. The house is drawing 436 W, and the charger is
        allowed up to 4000 W of the household budget."

You    "Only charge between 11pm and 6am."
Agent  → add_charging_schedule  start 23:00  end 06:00
       "Done — window 23:00–06:00 is active on the mennekes connector."
```

## Start here

- **[README](https://github.com/Nolex13/viaris-mcp#readme)** — install it and
  wire it into your agent. Includes setup for Claude Desktop, Claude Code,
  Cline, Continue, Zed and any other stdio MCP client.
- **[Device API reference](api.html)** — the charger's own HTTP endpoints, mapped
  from real firmware. Useful even if you never run this server.
- **[Design notes](design.html)** — why it is built the way it is, including the
  parts that turned out to be wrong.

## What it can do

| | |
|---|---|
| **See** | live household and vehicle power, charging state, past sessions, full configuration |
| **Set** | household power limit, charger current, solar priority, LED brightness, clock |
| **Schedule** | charging windows in plain `HH:MM`, including windows that cross midnight |

Eleven tools in total. Reset, firmware upload and network reconfiguration are
deliberately absent — they can leave a charger unreachable.

## Before you install it

The Viaris HTTP API **has no authentication**. Anyone already on your network
can read and change your charger's settings, with or without this server. What
this server changes is that an *agent* can too.

That is the point, and it is also the risk worth understanding before you wire
it up. The [security notes](https://github.com/Nolex13/viaris-mcp/blob/main/SECURITY.md)
spell out what is exposed and what is deliberately not.

## Tested against

`VIARIS UNI`, firmware `7.2.53`, single-phase, 32 A. Other models in the family
share the same API surface, and the code reads its limits from what the device
reports rather than assuming them — but reports from other hardware are
[very welcome](https://github.com/Nolex13/viaris-mcp/issues).
