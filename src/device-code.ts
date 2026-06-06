import { buildVoxveyProviderAuthResult, fetchVoxveyUserInfo, type VoxveyOAuthTokens } from "./oauth.js";
import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk/plugin-entry";
import {
  DEFAULT_DEVICE_CODE_INTERVAL_MS,
  DEFAULT_DEVICE_CODE_TIMEOUT_MS,
  MIN_DEVICE_CODE_INTERVAL_MS,
  SLOW_DOWN_INTERVAL_INCREMENT_MS,
  VOXVEY_API_AUDIENCE,
  VOXVEY_CLIENT_ID,
  VOXVEY_DEVICE_AUTHORIZATION_URL,
  VOXVEY_FALLBACK_MODEL_REF,
  VOXVEY_SCOPES,
  VOXVEY_TOKEN_URL,
} from "./constants.js";
import {
  expiresAtFromSeconds,
  formatOAuthErrorResponse,
  parseJsonObject,
  readPositiveInteger,
  readString,
} from "./http.js";
import { resolveDefaultVoxveyModelRef } from "./models.js";

export type VoxveyDeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInMs: number;
  intervalMs: number;
};

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

function parseDeviceCodeResponse(body: Record<string, unknown>): VoxveyDeviceCode {
  const deviceCode = readString(body.device_code);
  const userCode = readString(body.user_code);
  const verificationUri = readString(body.verification_uri) ?? readString(body.verification_url);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("Voxvey device code response missing required fields.");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(readString(body.verification_uri_complete)
      ? { verificationUriComplete: readString(body.verification_uri_complete) }
      : {}),
    expiresInMs:
      (readPositiveInteger(body.expires_in) ?? DEFAULT_DEVICE_CODE_TIMEOUT_MS / 1000) * 1000,
    intervalMs: Math.max(
      MIN_DEVICE_CODE_INTERVAL_MS,
      (readPositiveInteger(body.interval) ?? DEFAULT_DEVICE_CODE_INTERVAL_MS / 1000) * 1000,
    ),
  };
}

function parseDeviceCodeTokenResponse(
  body: Record<string, unknown>,
  now = Date.now(),
): VoxveyOAuthTokens {
  const access = readString(body.access_token);
  if (!access) {
    throw new Error("Voxvey device token response missing access_token.");
  }
  return {
    access,
    ...(readString(body.refresh_token) ? { refresh: readString(body.refresh_token) } : {}),
    ...(expiresAtFromSeconds(body.expires_in, now) !== undefined
      ? { expires: expiresAtFromSeconds(body.expires_in, now) }
      : {}),
    ...(readString(body.id_token) ? { idToken: readString(body.id_token) } : {}),
    ...(readString(body.scope) ? { scope: readString(body.scope) } : {}),
    ...(readString(body.token_type) ? { tokenType: readString(body.token_type) } : {}),
  };
}

export async function requestVoxveyDeviceCode(params: {
  fetchFn?: typeof fetch;
} = {}): Promise<VoxveyDeviceCode> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(VOXVEY_DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: VOXVEY_CLIENT_ID,
      audience: VOXVEY_API_AUDIENCE,
      scope: VOXVEY_SCOPES.join(" "),
    }),
  });

  const bodyText = await response.text();
  const body = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(
      formatOAuthErrorResponse({
        prefix: "Voxvey device code request failed",
        status: response.status,
        body,
        bodyText,
      }),
    );
  }
  if (!body) {
    throw new Error("Voxvey device code response was not JSON.");
  }
  return parseDeviceCodeResponse(body);
}

export async function pollVoxveyDeviceCode(params: {
  deviceCode: string;
  expiresInMs: number;
  intervalMs: number;
  fetchFn?: typeof fetch;
  sleep?: SleepFn;
  now?: () => number;
}): Promise<VoxveyOAuthTokens> {
  const fetchFn = params.fetchFn ?? fetch;
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const deadline = now() + params.expiresInMs;
  let intervalMs = Math.max(MIN_DEVICE_CODE_INTERVAL_MS, params.intervalMs);

  while (now() < deadline) {
    const response = await fetchFn(VOXVEY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: VOXVEY_CLIENT_ID,
        audience: VOXVEY_API_AUDIENCE,
        device_code: params.deviceCode,
      }),
    });
    const bodyText = await response.text();
    const body = parseJsonObject(bodyText);
    if (response.ok) {
      if (!body) {
        throw new Error("Voxvey device token response was not JSON.");
      }
      return parseDeviceCodeTokenResponse(body);
    }

    const error = readString(body?.error);
    if (error === "authorization_pending") {
      await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
      continue;
    }
    if (error === "slow_down") {
      intervalMs += SLOW_DOWN_INTERVAL_INCREMENT_MS;
      await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
      continue;
    }
    if (error === "expired_token") {
      throw new Error("Voxvey device code expired. Run login again.");
    }
    if (error === "access_denied") {
      throw new Error("Voxvey device code was denied.");
    }

    throw new Error(
      formatOAuthErrorResponse({
        prefix: "Voxvey device authorization failed",
        status: response.status,
        body,
        bodyText,
      }),
    );
  }

  throw new Error("Voxvey device authorization timed out.");
}

export async function loginVoxveyDeviceCode(params: {
  fetchFn?: typeof fetch;
  sleep?: SleepFn;
  now?: () => number;
  onVerification: (device: VoxveyDeviceCode) => Promise<void> | void;
  onProgress?: (message: string) => void;
}): Promise<VoxveyOAuthTokens> {
  params.onProgress?.("Requesting device code...");
  const device = await requestVoxveyDeviceCode({ fetchFn: params.fetchFn });
  await params.onVerification(device);
  params.onProgress?.("Waiting for device authorization...");
  return await pollVoxveyDeviceCode({
    deviceCode: device.deviceCode,
    expiresInMs: device.expiresInMs,
    intervalMs: device.intervalMs,
    fetchFn: params.fetchFn,
    sleep: params.sleep,
    now: params.now,
  });
}

export async function runVoxveyDeviceCodeLogin(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  const spin = ctx.prompter.progress("Starting Voxvey device code flow...");
  try {
    const tokens = await loginVoxveyDeviceCode({
      onProgress: (message) => spin.update(message),
      onVerification: async (device) => {
        const verificationUrl = device.verificationUriComplete ?? device.verificationUri;
        const expiresInMinutes = Math.max(1, Math.round(device.expiresInMs / 60_000));
        await ctx.prompter.note(
          [
            ctx.isRemote
              ? "Open this URL in your local browser and enter the code below."
              : "Open this URL in your browser and enter the code below.",
            `URL: ${verificationUrl}`,
            `Code: ${device.userCode}`,
            `Code expires in ${expiresInMinutes} minutes. Never share it.`,
          ].join("\n"),
          "Voxvey device code",
        );
        if (!ctx.isRemote) {
          try {
            await ctx.openUrl(verificationUrl);
          } catch {
            ctx.runtime.log(`Open manually: ${verificationUrl}`);
          }
        } else {
          ctx.runtime.log(`Open this URL in your local browser: ${verificationUrl}`);
        }
      },
    });

    spin.update("Loading Voxvey profile...");
    const userInfo = await fetchVoxveyUserInfo({ accessToken: tokens.access });
    const defaultModel = await resolveDefaultVoxveyModelRef({ token: tokens.access }).catch(
      (error) => {
        ctx.runtime.log(
          `Voxvey model discovery failed during device login: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return VOXVEY_FALLBACK_MODEL_REF;
      },
    );
    spin.stop("Voxvey device code complete");
    return buildVoxveyProviderAuthResult({ tokens, userInfo, defaultModel });
  } catch (error) {
    spin.stop("Voxvey device code failed");
    throw error;
  }
}
