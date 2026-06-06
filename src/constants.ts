export const PROVIDER_ID = "voxvey";
export const PROVIDER_LABEL = "Voxvey";

export const VOXVEY_API_BASE_URL = "https://api.voxvey.com/v1";
export const VOXVEY_MODELS_URL = `${VOXVEY_API_BASE_URL}/models`;
export const VOXVEY_API_AUDIENCE = "https://api.voxvey.com";

export const VOXVEY_ISSUER = "https://login.onehelio.com/";
export const VOXVEY_AUTHORIZATION_URL = "https://login.onehelio.com/authorize";
export const VOXVEY_TOKEN_URL = "https://login.onehelio.com/oauth/token";
export const VOXVEY_DEVICE_AUTHORIZATION_URL =
  "https://login.onehelio.com/oauth/device/code";
export const VOXVEY_USERINFO_URL = "https://login.onehelio.com/userinfo";

export const VOXVEY_CLIENT_ID = "7KQEibIeoh7N6vZLbUbbUtbQTlVDuRJv";
export const VOXVEY_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export const VOXVEY_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const VOXVEY_FALLBACK_MODEL_ID = "default";
export const VOXVEY_FALLBACK_MODEL_REF = `${PROVIDER_ID}/${VOXVEY_FALLBACK_MODEL_ID}`;

export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 8_192;
export const DEFAULT_DEVICE_CODE_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_DEVICE_CODE_INTERVAL_MS = 5_000;
export const MIN_DEVICE_CODE_INTERVAL_MS = 1_000;
export const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5_000;
