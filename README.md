# gladys-aquarea

[Gladys Assistant](https://gladysassistant.com) external integration for
**Panasonic Aquarea** air-to-water heat pumps, through **Aquarea Smart Cloud**
(the Panasonic cloud, CZ-TAW1 / CZ-TAW1B adapters) or a local **HeishaMon**
board (on the CN-CNT port, read on your MQTT broker or through its web page):
zone temperatures and setpoints, hot water tank, outdoor, inlet and outlet
temperatures, modes, quiet and powerful modes, defrost, error codes as a scene
trigger, compressor frequency, heat produced, power and energy for the Gladys
energy dashboards. Unofficial, not affiliated with Panasonic.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/178).
> Developed without a heat pump: see [TODO.md](TODO.md) for what still needs a
> real installation.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (AquareaApp) ⇄ source ⇄ heat pump
                                   │                         ├─ src/cloud/source.js      Aquarea Smart Cloud
                                   │                         │    session.js  Panasonic ID login (Auth0, PKCE), tokens
                                   │                         │    api.js      device list, transfer proxy calls
                                   │                         │    status.js   status -> snapshot, commands, days (pure)
                                   │                         └─ src/heishamon/source.js  HeishaMon (MQTT or /json)
                                   │                              state.js    topics -> snapshot, commands (pure)
                                   ├─ src/model.js      snapshot -> Gladys device and states (pure)
                                   ├─ src/energy.js     power -> kWh index (HeishaMon), kept in /data
                                   └─ src/publisher.js  states within 300/min, measurement throttling
```

Both sources describe the heat pump the same way (a "snapshot", see
`src/model.js`); the app builds one Gladys device per heat pump from it.

- **Aquarea Smart Cloud**: the Panasonic ID login of the Comfort Cloud Android
  application (which carries the Aquarea heat pumps since 2024: Auth0 with
  PKCE, scope `a2w.control`, then `/auth/v2/login` for the client id and the
  signed `x-cfc-api-key` headers). The session is kept in `/data/session.json`
  (tokens, never the password) and refreshed with its refresh token. Heat pumps:
  `/device/group` (deviceType `2`); status, commands and consumption through
  `/remote/v1/app/common/transfer` (`/remote/v1/api/devices?gwid=…&deviceDirect=1`
  live, `deviceDirect=0` the cloud copy when the adapter does not answer). One
  request at a time, a status read per heat pump every 2 minutes, the
  consumption every hour. Two-factor accounts send their code with a button.
- **HeishaMon**: `<base>/main/+`, `<base>/extra/+` and `<base>/LWT` on the
  user's broker (retained values: the heat pump appears at once), commands on
  `<base>/commands/<SetName>`; or the board's `/json` page every
  `http_interval` seconds and `/command?<SetName>=<value>`.
- **Energy**: the cloud gives the consumption per day, published for the
  finished days with `publishEnergyConsumption` on a `daily-consumption`
  feature (Gladys 5.2.0); HeishaMon gives the electrical power, integrated into
  a kWh index (`energy-sensor` / `energy`) the core turns into 30-minute
  consumption and cost. The thermal power produced is not an `energy-sensor`
  feature (it would be counted as electricity).
- **Errors**: the error code is a text feature, and a new code fires the
  `heat_pump_error` scene trigger (not the code already there at startup).

## Reused work

- **Panasonic ID login**: adapted from
  [guim31/gladys-panasonic-cc](https://github.com/guim31/gladys-panasonic-cc)
  (Apache-2.0, `src/panasonic/cloud.js`, `http.js`, `html.js`,
  `appversion.js`), itself a port of
  [aio-panasonic-comfort-cloud](https://github.com/sockless-coding/aio-panasonic-comfort-cloud)
  (MIT): Aquarea uses the very same login. A dependency was not possible (an
  integration, not a package).
- **Aquarea API**: written from
  [aioaquarea](https://github.com/cjaliaga/aioaquarea) 1.0.7 (MIT, the library
  of the Home Assistant `aquarea` integration) and the Aquarea part of
  aio-panasonic-comfort-cloud (MIT, the library of
  [panasonic_cc](https://github.com/sockless-coding/panasonic_cc), which reads
  Aquarea since August 2026): endpoints, field names, value codes, the "resend
  every zone and tank status" rule, the polling pace. Read as documentation.
- **HeishaMon**: the topics, values and commands of the
  [HeishaMon](https://github.com/Egyras/HeishaMon) documentation
  (`MQTT-Topics.md`, read as documentation: the repository has no licence),
  and the mapping choices of
  [heishamon-homeassistant](https://github.com/kamaradclimber/heishamon-homeassistant)
  (Apache-2.0). MQTT through [mqtt.js](https://github.com/mqttjs/MQTT.js) (MIT).
- npm has no usable Aquarea client: `panasonic-aquarea-client` (one 0.0.1 of
  2023, the old web flow), `panasonic-comfort-cloud-client` (no Aquarea calls,
  `ts-node` and `inquirer` as runtime dependencies), Homebridge and ioBroker
  plugins (applications, not libraries).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the licences and
[TODO.md](TODO.md) "Decisions" for the reasons.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run the real client and app against the SDK's fake Gladys:
`test/helpers/fakePanasonic.js` is a fake Panasonic cloud behind `fetch`
(Auth0 login with PKCE checked, signed headers checked, device list, transfer
proxy applying the commands), `test/helpers/harness.js` an in-memory MQTT
broker. The fixtures are written for the tests (`test/fixtures/`): the
reference projects ship no test data.

The HeishaMon path also ran against a real **Mosquitto 2** broker, with a
simulated HeishaMon replaying its topics (retained values, last will, command
echoes): `~/gladys-integrations/e2e/heishamon-e2e.sh` (outside the repository).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Panasonic and Aquarea are trademarks of Panasonic Holdings
Corporation; this project is not affiliated with Panasonic, nor with the
HeishaMon project.
