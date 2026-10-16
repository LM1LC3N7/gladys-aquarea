# TODO — Panasonic Aquarea v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #178) gets one recap message there, with
  a link to each repo, once the ten are published.

## Status

- [x] **Milestone 1 — core** (2026-10-15): Aquarea Smart Cloud (Panasonic ID
      login with PKCE and two-factor code, saved session and refresh, device
      list, live status with the cloud copy as fallback, commands on/off, mode,
      zone setpoints, tank setpoint, quiet mode, consumption per day published
      with `publishEnergyConsumption`) and HeishaMon (MQTT topics with the
      retained values, last will, extra power block, commands; or the `/json`
      page and `/command`); one device per heat pump with zones, tank, outdoor,
      inlet and outlet temperatures, compressor, powers, energy index, quiet and
      powerful modes, defrost, error code and the `heat_pump_error` scene
      trigger; badges; connection test; manifest; docs en/fr. Unit and app
      tests on a fake Panasonic cloud and an in-memory broker; HeishaMon also
      against a real Mosquitto 2 (`~/gladys-integrations/e2e/heishamon-e2e.sh`).
- [ ] **Milestone 2 — real installs**: answers of real accounts (anonymized)
      as fixtures, the points of "To check" below, French heat pumps (J, K and L
      series, All-In-One, T-CAP).
- [ ] **Milestone 3 — more controls**: powerful mode and force DHW (the key
      differs between the references: `powerful` / `powerfulRequest`), Eco /
      Comfort special status, holiday mode, force defrost and the HeishaMon
      `SetReset` (acknowledge an error), zone on/off, tank on/off, the
      HeishaMon direct setpoints of the zones regulated by a room thermostat
      (curve high target, SetCurves), the consumption split (heating / hot
      water), COP, pump flow and water pressure (no unit in Gladys yet), the
      HeishaMon S0 kWh meters and 1-wire probes, the weekly timer.
- [ ] **Milestone 4 — first release**: cover image, Docker image check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## To check on a real heat pump or account

- **Cloud login**: the whole Auth0 flow against the real Panasonic tenant
  (it changed in 2024–2025; the steps follow aioaquarea 1.0.7 and
  aio-panasonic-comfort-cloud of October 2026), the two-factor variants
  (Universal Login `mfa_token` and Guardian), the `/auth/v2/login` client id,
  the store version lookup (Play Store then AppBrain; default 4.3.0).
- **Which accounts list Aquarea**: heat pumps registered only in the old Aquarea
  Smart Cloud app/web site, do they show in `/device/group` of the Comfort
  Cloud API? (aioaquarea and panasonic_cc both rely on it.)
- **Status answer**: the real shape (`status` an object or a list), the zone
  `zoneId` values, `temperatureNow` for zones without a sensor (126?),
  `coolMode`, `heatMin`/`heatMax` of a zone on a curve (assumed −5…5), the
  `faultStatus` codes, `powerful` vs `powerfulRequest`, `deiceStatus`,
  `direction` while heating the tank.
- **Commands**: the body accepted for on/off and mode (every zone and tank
  status resent), a zone setpoint alone, the tank setpoint, the quiet level;
  how long until the live status shows the change (echo read after 5 s).
- **Consumption**: the units and the `-255` convention, the days of the month
  answer, the current day, the time zone (`osTimezone` from the container TZ,
  which Gladys sets to its own).
- **Quotas**: how many calls an account may make (2 minutes per heat pump +
  hourly consumption), what Panasonic answers past it.
- **Adapter offline**: the refusal message of a live status (`deviceDirect=1`),
  the cached copy, how long it stays.
- **HeishaMon**: the real retained dump of J/K/L series, the extra block,
  `Z2_*` values when zone 2 is absent, error texts (`H62`…, hex digits),
  `Heating_Mode` and the setpoint ranges in direct mode, a heat-only unit
  receiving cooling commands, the `/json` page of firmware 3.x and 4.x.
- **Energy**: the integrated index against the heat pump's own counter or a
  meter over a few days.

## Decisions

- **Not a duplicate of the core** (checked 2026-10-15): no Aquarea, Panasonic
  or HeishaMon code in GladysAssistant/Gladys master (5.2.1, `server/services`)
  nor in 217 release notes; HeishaMon publishes no Home Assistant discovery (no
  `homeassistant/` topic in its firmware), so the core MQTT discovery does not
  pick it up. In the store, guim31/gladys-panasonic-cc (Comfort Cloud, 1.0.1 of
  2026-10-14) states "Aquarea air-to-water heat pumps and hot water tanks are
  not supported". Its upstream (panasonic_cc) added Aquarea in August 2026: if
  guim31 follows, coordinate rather than duplicate.
- **Reuse (Louis's rule)**:
  - No npm library qualifies: `panasonic-aquarea-client` (0.0.1, 2023, the old
    web flow), `panasonic-comfort-cloud-client` (MIT, maintained, but no Aquarea
    call and `ts-node`, `inquirer`, `axios`, `cheerio`… as runtime
    dependencies), `@hernas/homebridge-panasonic-heat-pump` and
    `iobroker.heishamon` (applications, not libraries).
  - The Python references are maintained but Python: aioaquarea (cjaliaga,
    MIT, 1.0.7 of May 2026, the library of the Home Assistant `aquarea`
    integration, whose repository was deprecated in March 2026 for the
    wpatrik14 fork) and aio-panasonic-comfort-cloud (sockless-coding, MIT,
    commits of October 2026, full Aquarea support since August 2026). Read as
    documentation for the endpoints, fields, values and pace.
  - The Panasonic ID login is the same for Aquarea and the air conditioners:
    adapted from guim31/gladys-panasonic-cc (Apache-2.0, a tested JavaScript
    port of aio-panasonic-comfort-cloud), not rewritten. Notices in
    THIRD_PARTY_NOTICES.md (shipped in the image).
  - aioaquarea 1.0.7 sends no `refresh_token` in its refresh request; the
    session follows aio-panasonic-comfort-cloud, which does.
  - HeishaMon: MQTT with `mqtt` (mqtt.js, MIT, the client of gladys-rtl433);
    topics from its documentation only (no licence in its repository).
- **Two transports, one device model**: both sources produce the same
  "snapshot" (`src/model.js`); the device external ids differ by source
  (`aquarea:<guid>` / `heishamon:<base topic>`), there is no reliable link
  between a cloud guid and a HeishaMon. Choice: the section the user fills;
  both filled, the core's "Prefer the local connection" switch (manifest
  `transports: ["cloud", "local"]`) picks HeishaMon when on.
- **Room mode, not machine mode**: THERMOSTAT_MODE OFF/HEATING/COOLING/AUTO.
  Off keeps the hot water (HeishaMon "DHW only" mode 3; cloud zones off, tank
  kept, unit on if the tank is); a mode keeps the hot water as it was and
  switches the pump on. The whole unit has its own `binary`.
- **Cloud command bodies**: on/off and mode resend every zone and tank
  operation status (sockless-coding: omitted ones reset); setpoints, tank
  setpoint and quiet mode send their field only, like both references.
- **Live first, cloud copy after a failure**: `deviceDirect=1`; when the adapter
  does not answer, `deviceDirect=0` for the next 10 polls (aio-panasonic's
  rule), with a degraded badge.
- **Pace**: cloud status every 120 s per heat pump (panasonic_cc's default; the
  HA `aquarea` fork polls every 10 s, too fast for a shared quota),
  consumption hourly, device list every 6 hours; backoff 30 s → 15 min;
  credentials and two-factor: no automatic retry.
- **Energy**: cloud → `daily-consumption` with `publishEnergyConsumption`
  (Gladys 5.2.0, hence `gladys_version >=5.2.0`) for the finished days only,
  heating + cooling + hot water added; HeishaMon → power held between readings
  integrated into an `energy-sensor`/`energy` index in kWh, not across a gap of
  more than 15 minutes, saved in `/data/energy.json`. The thermal power is an
  `unknown` feature in W (an `energy-sensor` would be counted as electricity by
  the dashboards and the contracts).
- **Temperatures**: tank, outdoor, inlet, outlet are `probe` (kept out of the
  room average); a zone is `decimal` (room), or `probe` when HeishaMon says it
  reads its water temperature.
- **HeishaMon cooling**: offered on every heat pump (every model of its table
  is a "C" heat-and-cool one; heishamon-homeassistant does the same).
- **Errors**: text feature (`OK` when none) and the `heat_pump_error` trigger
  for a new code seen while running, not the code present at startup.
- **Language**: a config select (fr by default) names the features, like
  gladys-panasonic-cc.
- **Fixtures**: written for the tests (no reference project ships Aquarea test
  data; HeishaMon has no licence). The API key and PKCE vectors are checked
  against the Python reference code.
