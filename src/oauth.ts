import type { OAuthCredential } from "openclaw/plugin-sdk/provider-auth";
import { generateHexPkceVerifierChallenge } from "openclaw/plugin-sdk/provider-auth";
import { buildOauthProviderAuthResult } from "openclaw/plugin-sdk/provider-auth-result";
import {
  generateOAuthState,
  parseOAuthCallbackInput,
} from "openclaw/plugin-sdk/provider-auth-runtime";
import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk/plugin-entry";
import {
  PROVIDER_ID,
  VOXVEY_API_AUDIENCE,
  VOXVEY_AUTHORIZATION_URL,
  VOXVEY_CLIENT_ID,
  VOXVEY_FALLBACK_MODEL_REF,
  VOXVEY_REDIRECT_URI,
  VOXVEY_SCOPES,
  VOXVEY_TOKEN_URL,
  VOXVEY_USERINFO_URL,
} from "./constants.js";
import {
  expiresAtFromSeconds,
  formatOAuthErrorResponse,
  parseJsonObject,
  readJsonObjectResponse,
  readString,
} from "./http.js";
import { resolveDefaultVoxveyModelRef } from "./models.js";

export type VoxveyOAuthTokens = {
  access: string;
  refresh?: string;
  expires?: number;
  idToken?: string;
  scope?: string;
  tokenType?: string;
};

export type VoxveyUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
  nickname?: string;
};

export function buildVoxveyAuthorizationUrl(params: {
  state: string;
  challenge: string;
  redirectUri?: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: VOXVEY_CLIENT_ID,
    redirect_uri: params.redirectUri ?? VOXVEY_REDIRECT_URI,
    audience: VOXVEY_API_AUDIENCE,
    scope: VOXVEY_SCOPES.join(" "),
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  });
  return `${VOXVEY_AUTHORIZATION_URL}?${query.toString()}`;
}

export function parseVoxveyRedirectInput(input: string, expectedState: string) {
  const parsed = parseOAuthCallbackInput(input);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  if (parsed.state !== expectedState) {
    throw new Error("OAuth state mismatch");
  }
  return parsed;
}

function parseTokenResponse(body: Record<string, unknown>, now = Date.now()): VoxveyOAuthTokens {
  const access = readString(body.access_token);
  if (!access) {
    throw new Error("Voxvey token response missing access_token.");
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

async function postVoxveyTokenForm(params: {
  body: URLSearchParams;
  fetchFn?: typeof fetch;
  errorPrefix: string;
  now?: number;
}): Promise<VoxveyOAuthTokens> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(VOXVEY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.body,
  });
  const bodyText = await response.text();
  const body = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(
      formatOAuthErrorResponse({
        prefix: params.errorPrefix,
        status: response.status,
        body,
        bodyText,
      }),
    );
  }
  if (!body) {
    throw new Error(`${params.errorPrefix}: expected JSON object response.`);
  }
  return parseTokenResponse(body, params.now);
}

export async function exchangeVoxveyAuthorizationCode(params: {
  code: string;
  verifier: string;
  redirectUri?: string;
  fetchFn?: typeof fetch;
  now?: number;
}): Promise<VoxveyOAuthTokens> {
  return await postVoxveyTokenForm({
    fetchFn: params.fetchFn,
    now: params.now,
    errorPrefix: "Voxvey token exchange failed",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: VOXVEY_CLIENT_ID,
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri ?? VOXVEY_REDIRECT_URI,
      audience: VOXVEY_API_AUDIENCE,
    }),
  });
}

export async function refreshVoxveyToken(params: {
  refreshToken: string;
  fetchFn?: typeof fetch;
  now?: number;
}): Promise<VoxveyOAuthTokens> {
  return await postVoxveyTokenForm({
    fetchFn: params.fetchFn,
    now: params.now,
    errorPrefix: "Voxvey token refresh failed",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: VOXVEY_CLIENT_ID,
      refresh_token: params.refreshToken,
      audience: VOXVEY_API_AUDIENCE,
    }),
  });
}

export async function fetchVoxveyUserInfo(params: {
  accessToken: string;
  fetchFn?: typeof fetch;
}): Promise<VoxveyUserInfo | null> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(VOXVEY_USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }
  const body = await readJsonObjectResponse(response).catch(() => null);
  if (!body) {
    return null;
  }
  return {
    ...(readString(body.sub) ? { sub: readString(body.sub) } : {}),
    ...(readString(body.email) ? { email: readString(body.email) } : {}),
    ...(readString(body.name) ? { name: readString(body.name) } : {}),
    ...(readString(body.nickname) ? { nickname: readString(body.nickname) } : {}),
  };
}

export function buildVoxveyProviderAuthResult(params: {
  tokens: VoxveyOAuthTokens;
  userInfo?: VoxveyUserInfo | null;
  defaultModel: string;
}): ProviderAuthResult {
  const displayName = params.userInfo?.name ?? params.userInfo?.nickname;
  return buildOauthProviderAuthResult({
    providerId: PROVIDER_ID,
    defaultModel: params.defaultModel,
    access: params.tokens.access,
    refresh: params.tokens.refresh,
    expires: params.tokens.expires,
    email: params.userInfo?.email,
    displayName,
    profileName: params.userInfo?.email ?? params.userInfo?.sub,
    credentialExtra: {
      ...(params.userInfo?.sub ? { accountId: params.userInfo.sub } : {}),
      ...(params.tokens.idToken ? { idToken: params.tokens.idToken } : {}),
      ...(params.tokens.scope ? { scope: params.tokens.scope } : {}),
      ...(params.tokens.tokenType ? { tokenType: params.tokens.tokenType } : {}),
    },
  });
}

export async function refreshVoxveyOAuthCredential(
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  if (!credential.refresh) {
    throw new Error("Voxvey OAuth profile has no refresh token. Run login again.");
  }
  const refreshed = await refreshVoxveyToken({ refreshToken: credential.refresh });
  return {
    ...credential,
    access: refreshed.access,
    refresh: refreshed.refresh ?? credential.refresh,
    ...(refreshed.expires !== undefined ? { expires: refreshed.expires } : {}),
    ...(refreshed.idToken ? { idToken: refreshed.idToken } : {}),
    ...(refreshed.scope ? { scope: refreshed.scope } : {}),
    ...(refreshed.tokenType ? { tokenType: refreshed.tokenType } : {}),
  } as OAuthCredential;
}

export async function runVoxveyOAuthLogin(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  const spin = ctx.prompter.progress("Starting Voxvey OAuth...");
  try {
    const state = generateOAuthState();
    const pkce = generateHexPkceVerifierChallenge();
    const authUrl = buildVoxveyAuthorizationUrl({
      state,
      challenge: pkce.challenge,
    });

    await ctx.prompter.note(
      [
        ctx.isRemote
          ? "Open this URL in your local browser, complete sign-in, then paste the full redirect URL."
          : "Open this URL in your browser, complete sign-in, then paste the full redirect URL.",
        "",
        authUrl,
      ].join("\n"),
      "Voxvey login",
    );

    try {
      if (!ctx.isRemote) {
        await ctx.openUrl(authUrl);
      }
    } catch {
      ctx.runtime.log(`Open manually: ${authUrl}`);
    }

    spin.update("Waiting for pasted redirect URL...");
    const redirectInput = await ctx.prompter.text({
      message: "Paste the full redirect URL:",
    });
    const parsed = parseVoxveyRedirectInput(redirectInput, state);

    spin.update("Exchanging authorization code...");
    const tokens = await exchangeVoxveyAuthorizationCode({
      code: parsed.code,
      verifier: pkce.verifier,
    });

    spin.update("Loading Voxvey profile...");
    const userInfo = await fetchVoxveyUserInfo({ accessToken: tokens.access });
    const defaultModel = await resolveDefaultVoxveyModelRef({ token: tokens.access }).catch(
      (error) => {
        ctx.runtime.log(
          `Voxvey model discovery failed during login: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return VOXVEY_FALLBACK_MODEL_REF;
      },
    );

    spin.stop("Voxvey OAuth complete");
    return buildVoxveyProviderAuthResult({ tokens, userInfo, defaultModel });
  } catch (error) {
    spin.stop("Voxvey OAuth failed");
    throw error;
  }
}
