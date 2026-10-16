// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration and their scenes), the values of the Gladys core the SDK does
// not export, and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  TWO_FACTOR: 'two_factor_code',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  ERROR: 'heat_pump_error',
};

/** Pace of the Aquarea Smart Cloud status reads (seconds), mirrored by the manifest. */
export const CLOUD_INTERVAL = { min: 60, max: 3600, default: 120 };

/** Pace of the HeishaMon `/json` reads (seconds), mirrored by the manifest. */
export const HTTP_INTERVAL = { min: 5, max: 600, default: 30 };

/** Minimum interval between two readings of a measurement (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 600, default: 30 };

/** HeishaMon's default MQTT base topic. */
export const DEFAULT_TOPIC = 'panasonic_heat_pump';

/** Device external id types: `ext:<selector>:<type>:<platform id>`. */
export const DEVICE_TYPES = { CLOUD: 'aquarea', HEISHAMON: 'heishamon' };

// Gladys core values (server/utils/constants.js), not exported by the SDK.
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };

/** The quiet levels of the heat pump (both transports): 0 off, 1 to 3 quieter. */
export const QUIET_LEVELS = ['0', '1', '2', '3'];
/** The powerful mode: off, or on for 30, 60 or 90 minutes. */
export const POWERFUL_LEVELS = ['0', '1', '2', '3'];

/** The text of the `error` feature when the heat pump reports none. */
export const NO_ERROR = 'OK';

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Scene events per minute (Gladys accepts 300). */
  sceneEventsPerMinute: 30,
  /** Size of an HTTP answer read (bytes). */
  responseBytes: 2 * 1024 * 1024,
  /** Size of an MQTT message read (bytes): HeishaMon values are a few bytes. */
  payloadBytes: 64 * 1024,
  /** Heat pumps of one account or one broker. */
  devices: 50,
  /** Text states and scene event strings sent to Gladys. */
  text: 500,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** One HTTP request. */
  requestTimeout: 20_000,
  /** The Aquarea device list is read again this often (renamed or new heat pumps). */
  cloudDevicesRefresh: 6 * 3600_000,
  /** The daily consumption is read this often (the cloud fills the day as it goes). */
  consumptionRefresh: 3600_000,
  /** After a command, the cloud status is read again this soon. */
  cloudCommandEcho: 5000,
  /** A live status read failed: cached reads for this many polls before trying live again. */
  cachedPolls: 10,
  /** Reconnection delays after a cloud failure (doubled each time, up to the max). */
  retryMin: 30_000,
  retryMax: 15 * 60_000,
  /** Refused credentials are retried slowly: the user has to change them. */
  authRetry: 30 * 60_000,
  /** MQTT: connection timeout and reconnection period. */
  connectTimeout: 15_000,
  reconnectPeriod: 10_000,
  /** HeishaMon: the device list is built once the burst of retained values settled. */
  heishamonSettle: 2000,
  /** HeishaMon republishes every value every 5 minutes by default: silent longer = stale. */
  heishamonStale: 15 * 60_000,
  /** The energy index is integrated over gaps up to this long (HeishaMon resends all every 5 min). */
  energyMaxGap: 15 * 60_000,
  /** The energy index is written to /data at most this often. */
  energySave: 5 * 60_000,
  /** The connection test waits this long for HeishaMon values on the broker. */
  testListen: 8000,
};
