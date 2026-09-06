# Changelog

Notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** configuration is now a single environment variable.
  `VIARIS_HOST` is gone; `VIARIS_CHARGERS` takes `name=address` pairs:
  `VIARIS_CHARGERS="garage=192.168.1.100,outdoor=192.168.1.101"`.

  Two variables meant two code paths and two ways to get the setup wrong. The
  format changed away from JSON at the same time, because the value almost
  always ends up inside an MCP client's own JSON config file, where a JSON
  payload needs its quotes escaped — the very awkwardness `VIARIS_HOST` had
  been papering over.

  Every charger now carries a name, so the agent can say "the garage charger"
  rather than "default", and a name repeated twice is an error rather than one
  configuration silently winning.

### Added

- `get_configuration` now reports the device clock and, more usefully, how far
  it has drifted from the machine running the server. Charging windows fire on
  the charger's own clock, so one that is hours out runs a schedule at the
  wrong time while reporting it correctly — previously the clock could be set
  but never read back.

### Fixed

- `get_charging_schedule` reported a window with no power cap as `maxPowerW: 0`
  rather than `null`. The firmware echoes `maxPower: 0` for "no cap", and
  passing that through told the agent the exact opposite of what it meant.
- `get_charging_schedule` leaked the firmware's numeric `active` flag (`1`/`0`)
  where the documented shape promises a boolean.

Both surfaced while exercising the write tools against a real charger, and
neither was reachable from the read path alone.

## [0.1.0] — 2026-09-06

First public release.

### Added

- Eleven MCP tools over stdio: four reads (`get_status`, `get_configuration`,
  `get_charging_history`, `get_charging_schedule`) and seven writes
  (charging windows, household power limit, charger current, solar, LEDs, clock).
- Support for **multiple chargers**, addressed by name, with SPL-aware writing
  of the household limit: to the master when there is one, with an explicit
  warning when the configuration is one the firmware cannot make safe by itself.
- Multi-connector support with the same addressing rule.
- Documented mapping of the device's local HTTP API — see [docs/api.md](docs/api.md).

### Notes

- Mapped and verified against a `VIARIS UNI` on firmware `7.2.53`, single-phase,
  32 A. Three-phase and multi-connector hardware is untested.
- Reset, firmware upload and network reconfiguration are deliberately not exposed.
- Two constraints believed during development — that the device only spoke
  HTTP/1.0, and that it handled one connection at a time — were disproved by
  measurement before release and the code simplified accordingly. The reasoning
  is recorded in [docs/design.md](docs/design.md).

[Unreleased]: https://github.com/Nolex13/viaris-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nolex13/viaris-mcp/releases/tag/v0.1.0
