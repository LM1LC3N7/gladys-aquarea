# Third-party notices

## gladys-panasonic-cc (https://github.com/guim31/gladys-panasonic-cc)

`src/cloud/http.js`, `src/cloud/html.js` and the login part of
`src/cloud/session.js` are adapted from `src/panasonic/http.js`, `html.js`,
`cloud.js` and `appversion.js` of gladys-panasonic-cc, Copyright 2026 Guilhem
(guim31), under the Apache License 2.0 (the license of this project, see
[LICENSE](LICENSE)). Changes: the Aquarea session keeps the Panasonic ID it was
saved for and never reuses another one's tokens, the API calls of the air
conditioners are left out, the default application version is the one of
aioaquarea, comments rewritten for this integration.

## aio-panasonic-comfort-cloud (https://github.com/sockless-coding/aio-panasonic-comfort-cloud)

gladys-panasonic-cc ports its Panasonic ID login (login flow, request headers,
application version), so the adapted code above derives from it. Its Aquarea
part (`apiclient/_aquarea.py`, `models/aquarea.py`, `constants.py`) was read
for the endpoints, fields and values of `src/cloud/`; no code of it is copied.

```text
MIT License

Copyright (c) 2020-2025 Jimmy Everling

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## aioaquarea (https://github.com/cjaliaga/aioaquarea)

Read as documentation for the Aquarea API (`device_manager.py`,
`device_control.py`, `consumption_manager.py`, `data.py`, `const.py`): the
transfer proxy, the status fields and codes, the commands, the consumption
request. No code of it is copied.

```text
MIT License

Copyright (c) 2022 Carlos J. Aliaga
```

(The full MIT terms are the same as above.)

## HeishaMon (https://github.com/Egyras/HeishaMon)

The MQTT topics, values and commands in `src/heishamon/` follow its
documentation (`MQTT-Topics.md`). The repository carries no licence: nothing is
copied from it, and the test fixtures are written for this project.

## heishamon-homeassistant (https://github.com/kamaradclimber/heishamon-homeassistant)

Apache License 2.0. Read for the mapping choices (cooling offered on every
HeishaMon heat pump, the extra power block); no code of it is copied.
