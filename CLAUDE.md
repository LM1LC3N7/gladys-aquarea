# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It reads
Panasonic Aquarea heat pumps through **Aquarea Smart Cloud** (the Panasonic
cloud, own client) or **HeishaMon** (MQTT with `mqtt`, or the board's `/json`
page), turns each heat pump into a Gladys device and sends the Gladys commands
back. Unofficial, not affiliated with Panasonic.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/cloud-status.test.js     # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                 SDK bootstrap only
src/handlers.js          every SDK handler -> the app (shared with the tests)
src/app.js               AquareaApp: picks the source, snapshots -> devices and
                         states, daily consumption, energy index, error trigger,
                         badges, commands, buttons
src/config.js            config_schema normalized, which source (cloud/HeishaMon)
src/model.js             snapshot -> Gladys device, features and readers (pure)
src/cloud/session.js     Panasonic ID login (Auth0, PKCE, two-factor), tokens,
                         signed headers, one call at a time
src/cloud/api.js         device list, transfer proxy (status, commands, consumption)
src/cloud/status.js      status -> snapshot, command bodies, finished days (pure)
src/cloud/source.js      the cloud loop: polls, live/cached, consumption, retries
src/cloud/http.js, html.js   fetch + cookie jar, Auth0 page parsing
src/heishamon/state.js   topics -> snapshot, Gladys values -> HeishaMon commands (pure)
src/heishamon/source.js  MQTT subscriptions or /json polling, commands, badges
src/energy.js            power (W) -> energy index (kWh), kept in /data
src/store.js             JSON documents in /data (session, energy)
src/publisher.js         states within 300/min, measurement throttling
src/constants.js         manifest keys, core enums, limits, timings
src/i18n.js              runtime texts and feature names (en/fr)
test/fixtures/           cloud answers and HeishaMon topics WRITTEN for the tests
test/helpers/            fake Panasonic cloud (fetch), MQTT broker, fast timers
```

## Rules

- **External ids are forever**: device = `aquarea:<deviceGuid>` (cloud) or
  `heishamon:<base topic>` / `heishamon:<board host>` (HTTP); feature =
  `<key>` among `binary`, `mode`, `operating-state`, `zone{1,2}-temperature`,
  `zone{1,2}-{heat,cool}-setpoint`, `tank-temperature`, `tank-setpoint`,
  `tank-heating`, `outdoor-temperature`, `inlet-temperature`,
  `outlet-temperature`, `compressor-frequency`, `power-consumed`,
  `energy-consumed`, `heat-produced`, `daily-consumption`, `quiet-mode`,
  `powerful-mode`, `defrost`, `error`. Never change how they are built.
- The manifest keys (config keys, `test_connection`, `two_factor_code`, the
  scene trigger `heat_pump_error` and its fields) are frozen: users store them.
- Value conventions: the Gladys side uses the enums of the core
  `server/utils/constants.js` (THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE,
  copied in `src/constants.js`: the SDK does not export them). The "mode" is
  the room mode: off keeps the hot water running.
- **Never count heat as electricity**: the thermal power is an `unknown`
  feature, not `energy-sensor`. Only the electrical energy feeds the energy
  dashboards: the HeishaMon index (`energy-sensor`/`energy`), the cloud days
  (`daily-consumption` through `publishEnergyConsumption`, never states, and
  never on a device that also has an index).
- **Cloud**: one request at a time, polite pace (Panasonic counts the calls).
  Refused credentials and two-factor prompts are never retried on their own
  (an account lock-out risk). Commands that change on/off or the mode resend
  the status of every zone and of the tank (omitted ones reset).
- **Hot water**: never written above 65 °C (`DHW_CAP.max`, Louis's rule of
  2026-10-28), nor above the configured ceiling (`dhw_max_temperature`, 65 °C
  by default) nor the heat pump's own limit when lower. `tankTop()` in
  `src/config.js` is the one bound of both write paths (HeishaMon
  `commands`, cloud `commandBody`) and of the published slider; each path
  checks the value once more before it leaves.
- Never log or put in a status message a token, a password, a two-factor code
  or a whole Panasonic answer: errors keep the code and a short message only.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Tests never touch the network: the fake Panasonic cloud and the in-memory
  broker stand in. The real broker path is checked with Mosquitto 2:
  `~/gladys-integrations/e2e/heishamon-e2e.sh`.
- Licences: the login code is adapted from guim31/gladys-panasonic-cc
  (Apache-2.0); aioaquarea and aio-panasonic-comfort-cloud (MIT) are read as
  documentation; HeishaMon has no licence: read its docs, never copy from it.
  Keep THIRD_PARTY_NOTICES.md in step.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
