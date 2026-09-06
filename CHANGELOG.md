# Changelog

Notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.1] — 2026-09-06

Documentation only; no code changes.

### Fixed

- The changelog claimed the configuration format was still unreleased when it
  was exactly what 0.1.0 shipped — the tag had been cut after those commits.
- Removed a roadmap entry promising npm publishing, which 0.1.0 had already
  done. It was visible on the npm package page, which is where people who
  arrive from npm read it first.

## [0.1.0] — 2026-09-06

First public release, on npm as `viaris-mcp`.

### Added

- Eleven MCP tools over stdio: four reads (`get_status`, `get_configuration`,
  `get_charging_history`, `get_charging_schedule`) and seven writes (charging
  windows, household power limit, charger current, solar, LEDs, clock).
- Support for **multiple chargers**, addressed by name, with SPL-aware writing
  of the household limit: to the master when there is one, and with an explicit
  warning when the configuration is one the firmware cannot make safe by itself
  — two independent chargers whose limits sum past the supply contract, or a
  slave whose master has gone missing.
- Multi-connector support, using the same addressing rule as chargers.
- `get_configuration` reports the device clock and how far it has drifted.
  Charging windows fire on the charger's own clock, so one that is hours out
  runs a schedule at the wrong time while reporting it correctly.
- Documented mapping of the device's local HTTP API — see [docs/api.md](docs/api.md).
- Published with npm provenance, so each version can be traced to the commit
  and workflow that produced it.

### Notes

- Configuration is one environment variable, `VIARIS_CHARGERS`, taking
  `name=address` pairs. Deliberately not JSON: the value almost always ends up
  inside an MCP client's own JSON config file, where a JSON payload would need
  its quotes escaped.
- Mapped and verified against a `VIARIS UNI` on firmware `7.2.53`,
  single-phase, 32 A — reads and writes both, with every value restored
  afterwards. Three-phase and multi-connector hardware is untested.
- Reset, firmware upload and network reconfiguration are deliberately not
  exposed: each can leave a charger unreachable.
- Two constraints believed during development — that the device only spoke
  HTTP/1.0, and that it handled one connection at a time — were disproved by
  measurement before release, and the code simplified accordingly. The
  reasoning is in [docs/design.md](docs/design.md).

[Unreleased]: https://github.com/Nolex13/viaris-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Nolex13/viaris-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/Nolex13/viaris-mcp/releases/tag/v0.1.0
