# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Panasonic Aquarea heat pumps through Aquarea Smart Cloud: Panasonic ID login
  as the Comfort Cloud app does it (two-factor accounts send their code with a
  button), the session kept between restarts (never the password), every
  heat pump of the account in Discovery, a status read every 2 minutes (the
  copy kept by the cloud when the adapter does not answer live).
- Panasonic Aquarea heat pumps through HeishaMon: its topics on your MQTT
  broker (one or several base topics, retained values, last will, the extra
  power block of the newer heat pumps), or its web page without a broker.
- One device per heat pump: on/off, heating mode (off, heating, cooling, auto;
  off keeps the hot water), activity, zone 1 and 2 temperatures and setpoints
  (a shift on a heating curve, or a water temperature), hot water tank
  temperature, setpoint and heating, outdoor temperature, quiet mode, powerful
  mode, defrost, error code; through HeishaMon also the water inlet and outlet
  temperatures, compressor frequency, power consumed and heat produced.
- Energy dashboards: the consumption per day of the cloud (finished days), or
  an energy index in kWh computed from the power HeishaMon reports.
- "Heat pump error" scene trigger: a new error code (H62, F12…).
- Transport badges: cloud or local, degraded when the adapter does not answer
  live, when HeishaMon is offline or silent for 15 minutes.
- "Test the connection" button, feature names in French or English.
