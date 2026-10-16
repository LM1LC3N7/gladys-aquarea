// -----------------------------------------------------------------------------
// The Panasonic cloud: endpoints, application identity and the values of the
// Aquarea API, as the Comfort Cloud Android application (which carries the
// Aquarea heat pumps since 2024) and the reference clients use them:
// cjaliaga/aioaquarea and sockless-coding/aio-panasonic-comfort-cloud (both
// MIT, read as documentation, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

export const AUTH_BASE = 'https://authglb.digital.panasonic.com';
export const ACC_BASE = 'https://accsmart.panasonic.com';

// The Auth0 client of the Android application; `a2w.control` opens the Aquarea API.
export const APP_CLIENT_ID = 'Xmy6xIYIitMxngjB2rHvlm6HSDNnaMJx';
export const AUTH0_CLIENT =
  'eyJuYW1lIjoiQXV0aDAuQW5kcm9pZCIsImVudiI6eyJhbmRyb2lkIjoiMzAifSwidmVyc2lvbiI6IjIuOS4zIn0=';
export const REDIRECT_URI =
  'panasonic-iot-cfc://authglb.digital.panasonic.com/android/com.panasonic.ACCsmart/callback';
export const AUDIENCE = `https://digital.panasonic.com/${APP_CLIENT_ID}/api/v1/`;
export const SCOPE = 'openid offline_access comfortcloud.control a2w.control';
export const AUTH_TENANT = 'pdpauthglb-a1';
export const AUTH_CONNECTION = 'PanasonicID-Authentication';
export const API_USER_AGENT = 'okhttp/4.10.0';
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36';

// API headers.
export const APP_NAME = 'Comfort Cloud';
export const API_KEY_SALT = '521325fb2dd486bf4831b47644317fca';

// Version of the application announced until a store tells a newer one
// (aioaquarea's, May 2026). Panasonic refuses an outdated one with error 4106:
// the version is then read again from the stores, or taken from the setting.
export const DEFAULT_APP_VERSION = '4.3.0';
export const APP_VERSION_MAX_AGE_MS = 2 * 24 * 3600_000;
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.panasonic.ACCsmart';
export const APPBRAIN_URL =
  'https://www.appbrain.com/app/panasonic-comfort-cloud/com.panasonic.ACCsmart';

// Error codes found in the body of a refusal.
export const API_ERROR = {
  // The announced application version is too old.
  NEW_VERSION: '4106',
  // New terms of use or privacy policy to accept in the application.
  AGREEMENT: '4103',
};

// The Aquarea API is reached through this proxy of the Comfort Cloud API.
export const TRANSFER_PATH = '/remote/v1/app/common/transfer';
export const DEVICES_API = '/remote/v1/api/devices';
export const CONSUMPTION_API = '/remote/v1/api/consumption';

/** deviceType of an Aquarea air-to-water heat pump in /device/group. */
export const AQUAREA_DEVICE_TYPE = '2';

/** Whole unit, zone or tank. */
export const OPERATION_STATUS = { OFF: 0, ON: 1 };
/** operationMode as the status reports it. */
export const STATUS_MODE = { OFF: 0, HEAT: 1, COOL: 2, AUTO_HEAT: 3, AUTO_COOL: 4 };
/** operationMode as a command sets it. */
export const UPDATE_MODE = { OFF: 0, HEAT: 2, COOL: 3, AUTO: 8 };
/** direction: what the compressor works for. */
export const DIRECTION = { IDLE: 0, ROOM: 1, WATER: 2 };
/** dataMode of the consumption: one entry per day of the month of `date`. */
export const CONSUMPTION_MONTH = 1;

/** A temperature the unit does not measure. */
export const INVALID_TEMPERATURE = 126;
/** A consumption the history does not have (yet). */
export const NO_CONSUMPTION = -255;
