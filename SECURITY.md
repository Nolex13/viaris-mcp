# Security Policy

## The threat model you are opting into

The Viaris HTTP API **has no authentication**. Anyone who can reach the charger
on your network can read its configuration and change it — including the
household power limit and a factory reset.

This server does not add authentication, because it cannot: it is a client of
that API, not a gateway in front of it. What it does instead:

- **Refuses to expose the destructive endpoints at all.** Factory reset,
  firmware upload and network reconfiguration have no corresponding tool. They
  are absent from the code, not merely undocumented.
- **Validates every write** against the maxima the device itself reports, so a
  nonsensical value is rejected before it reaches the charger.
- **Keeps OCPP, Modbus and MQTT read-only.** They are installation-time
  settings with no day-to-day intent worth exposing to an agent.

Everything else follows from where you run it. An agent with these tools can
change your household power limit; if that agent also reads untrusted content
from the web, a prompt injection could reach the tools. Run it where you would
be comfortable running any other tool with physical side effects.

## Reporting a vulnerability

Open a [security advisory](https://github.com/Nolex13/viaris-mcp/security/advisories/new)
rather than a public issue. Please include the firmware version of your charger
(`fwv` in `GET /device`), since behaviour differs across firmware revisions.

Expect a first response within a week. This is a hobby project maintained in
spare time — that is the honest service level, not a formality.
