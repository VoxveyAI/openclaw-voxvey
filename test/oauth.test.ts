import { describe, expect, it, vi } from "vitest";
import {
  VOXVEY_API_AUDIENCE,
  VOXVEY_AUTHORIZATION_URL,
  VOXVEY_CLIENT_ID,
  VOXVEY_REDIRECT_URI,
} from "../src/constants.js";
import {
  buildVoxveyAuthorizationUrl,
  buildVoxveyProviderAuthResult,
  exchangeVoxveyAuthorizationCode,
  fetchVoxveyUserInfo,
  parseVoxveyRedirectInput,
  refreshVoxveyToken,
} from "../src/oauth.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("Voxvey OAuth", () => {
  it("builds a PKCE authorization URL", () => {
    const url = new URL(
      buildVoxveyAuthorizationUrl({
        state: "state-123",
        challenge: "challenge-abc",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(VOXVEY_AUTHORIZATION_URL);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(VOXVEY_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(VOXVEY_REDIRECT_URI);
    expect(url.searchParams.get("audience")).toBe(VOXVEY_API_AUDIENCE);
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("parses pasted redirect URLs and rejects state mismatch", () => {
    expect(
      parseVoxveyRedirectInput(`${VOXVEY_REDIRECT_URI}?code=abc&state=expected`, "expected"),
    ).toEqual({ code: "abc", state: "expected" });

    expect(() =>
      parseVoxveyRedirectInput(`${VOXVEY_REDIRECT_URI}?code=abc&state=wrong`, "expected"),
    ).toThrow("OAuth state mismatch");
    expect(() => parseVoxveyRedirectInput("abc", "expected")).toThrow(
      "Paste the full redirect URL",
    );
  });

  it("exchanges authorization codes with verifier and redirect URI", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      expect(init.method).toBe("POST");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe(VOXVEY_CLIENT_ID);
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("code_verifier")).toBe("verifier");
      expect(body.get("redirect_uri")).toBe(VOXVEY_REDIRECT_URI);
      expect(body.get("audience")).toBe(VOXVEY_API_AUDIENCE);
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        id_token: "id-token",
        scope: "openid profile",
        token_type: "Bearer",
      });
    });

    await expect(
      exchangeVoxveyAuthorizationCode({
        code: "auth-code",
        verifier: "verifier",
        fetchFn: fetchFn as unknown as typeof fetch,
        now: 1_000,
      }),
    ).resolves.toEqual({
      access: "access-token",
      refresh: "refresh-token",
      expires: 3_601_000,
      idToken: "id-token",
      scope: "openid profile",
      tokenType: "Bearer",
    });
  });

  it("refreshes OAuth tokens with refresh_token grant", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe(VOXVEY_CLIENT_ID);
      expect(body.get("refresh_token")).toBe("old-refresh");
      expect(body.get("audience")).toBe(VOXVEY_API_AUDIENCE);
      return jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 60,
      });
    });

    await expect(
      refreshVoxveyToken({
        refreshToken: "old-refresh",
        fetchFn: fetchFn as unknown as typeof fetch,
        now: 2_000,
      }),
    ).resolves.toMatchObject({
      access: "new-access",
      refresh: "new-refresh",
      expires: 62_000,
    });
  });

  it("loads userinfo when available and tolerates unavailable userinfo", async () => {
    await expect(
      fetchVoxveyUserInfo({
        accessToken: "access-token",
        fetchFn: (async (_url: string, init: RequestInit) => {
          expect(init.headers).toMatchObject({ Authorization: "Bearer access-token" });
          return jsonResponse({ sub: "user-1", email: "a@example.com", name: "Ada" });
        }) as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ sub: "user-1", email: "a@example.com", name: "Ada" });

    await expect(
      fetchVoxveyUserInfo({
        accessToken: "access-token",
        fetchFn: (async () => jsonResponse({ error: "nope" }, { status: 401 })) as typeof fetch,
      }),
    ).resolves.toBeNull();
  });

  it("builds an OpenClaw OAuth auth profile result", () => {
    const result = buildVoxveyProviderAuthResult({
      tokens: {
        access: "access-token",
        refresh: "refresh-token",
        expires: 123,
        idToken: "id-token",
        scope: "openid",
        tokenType: "Bearer",
      },
      userInfo: { sub: "sub-1", email: "a@example.com", name: "Ada" },
      defaultModel: "voxvey/model-a",
    });

    expect(result.defaultModel).toBe("voxvey/model-a");
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.credential).toMatchObject({
      type: "oauth",
      provider: "voxvey",
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      email: "a@example.com",
      displayName: "Ada",
      accountId: "sub-1",
      idToken: "id-token",
      scope: "openid",
      tokenType: "Bearer",
    });
  });
});
