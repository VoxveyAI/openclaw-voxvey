import { describe, expect, it, vi } from "vitest";
import {
  VOXVEY_API_AUDIENCE,
  VOXVEY_CLIENT_ID,
  VOXVEY_DEVICE_AUTHORIZATION_URL,
  VOXVEY_TOKEN_URL,
} from "../src/constants.js";
import {
  loginVoxveyDeviceCode,
  pollVoxveyDeviceCode,
  requestVoxveyDeviceCode,
} from "../src/device-code.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("Voxvey device code", () => {
  it("requests a standard OAuth device code", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(VOXVEY_DEVICE_AUTHORIZATION_URL);
      expect(init.method).toBe("POST");
      const body = init.body as URLSearchParams;
      expect(body.get("client_id")).toBe(VOXVEY_CLIENT_ID);
      expect(body.get("audience")).toBe(VOXVEY_API_AUDIENCE);
      expect(body.get("scope")).toBe("openid profile email offline_access");
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://login.onehelio.com/activate",
        verification_uri_complete: "https://login.onehelio.com/activate?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 2,
      });
    });

    await expect(requestVoxveyDeviceCode({ fetchFn: fetchFn as unknown as typeof fetch })).resolves.toEqual({
      deviceCode: "device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://login.onehelio.com/activate",
      verificationUriComplete: "https://login.onehelio.com/activate?user_code=ABCD-EFGH",
      expiresInMs: 600_000,
      intervalMs: 2_000,
    });
  });

  it("polls pending and slow_down before returning tokens", async () => {
    const responses = [
      jsonResponse({ error: "authorization_pending" }, { status: 400 }),
      jsonResponse({ error: "slow_down" }, { status: 400 }),
      jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 10 }),
    ];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(VOXVEY_TOKEN_URL);
      const body = init.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
      expect(body.get("client_id")).toBe(VOXVEY_CLIENT_ID);
      expect(body.get("audience")).toBe(VOXVEY_API_AUDIENCE);
      expect(body.get("device_code")).toBe("device-code");
      return responses.shift()!;
    });
    const sleeps: number[] = [];

    await expect(
      pollVoxveyDeviceCode({
        deviceCode: "device-code",
        expiresInMs: 60_000,
        intervalMs: 1_000,
        fetchFn: fetchFn as unknown as typeof fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1_000,
      }),
    ).resolves.toMatchObject({
      access: "access",
      refresh: "refresh",
    });
    expect(sleeps).toEqual([1_000, 6_000]);
  });

  it("fails expired and denied device authorizations", async () => {
    await expect(
      pollVoxveyDeviceCode({
        deviceCode: "device-code",
        expiresInMs: 60_000,
        intervalMs: 1_000,
        fetchFn: (async () => jsonResponse({ error: "expired_token" }, { status: 400 })) as typeof fetch,
        sleep: async () => undefined,
        now: () => 1_000,
      }),
    ).rejects.toThrow("expired");

    await expect(
      pollVoxveyDeviceCode({
        deviceCode: "device-code",
        expiresInMs: 60_000,
        intervalMs: 1_000,
        fetchFn: (async () => jsonResponse({ error: "access_denied" }, { status: 400 })) as typeof fetch,
        sleep: async () => undefined,
        now: () => 1_000,
      }),
    ).rejects.toThrow("denied");
  });

  it("runs the full login helper", async () => {
    const responses = [
      jsonResponse({
        device_code: "device-code",
        user_code: "CODE",
        verification_uri: "https://login.onehelio.com/activate",
        expires_in: 600,
        interval: 1,
      }),
      jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 10 }),
    ];
    const onVerification = vi.fn();

    await expect(
      loginVoxveyDeviceCode({
        fetchFn: (async () => responses.shift()!) as typeof fetch,
        sleep: async () => undefined,
        now: () => 1_000,
        onVerification,
      }),
    ).resolves.toMatchObject({
      access: "access",
      refresh: "refresh",
    });
    expect(onVerification).toHaveBeenCalledWith(
      expect.objectContaining({ userCode: "CODE", deviceCode: "device-code" }),
    );
  });
});
