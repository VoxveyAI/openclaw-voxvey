import { describe, expect, it, vi } from "vitest";
import { buildVoxveyImageGenerationProvider, buildVoxveyVideoGenerationProvider } from "../src/media.js";

vi.mock("openclaw/plugin-sdk/image-generation-core", () => ({
  resolveApiKeyForProvider: vi.fn(async () => ({ apiKey: "user-token", mode: "oauth" })),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("Voxvey media providers", () => {
  it("posts image generations to Voxvey with OAuth bearer auth", async () => {
    const originalFetch = globalThis.fetch;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.voxvey.com/v1/images/generations");
      expect(init.headers).toBeInstanceOf(Headers);
      expect((init.headers as Headers).get("Authorization")).toBe("Bearer user-token");
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "openai/gpt-image-1",
        prompt: "make a chart",
        n: 1,
      });
      return jsonResponse({ data: [{ b64_json: Buffer.from("fakepng").toString("base64") }] });
    });
    vi.stubGlobal("fetch", fetchFn);
    try {
      const result = await buildVoxveyImageGenerationProvider().generateImage({
        provider: "voxvey",
        model: "voxvey/openai/gpt-image-1",
        prompt: "make a chart",
        cfg: {},
      });
      expect(result.images).toHaveLength(1);
      expect(result.model).toBe("openai/gpt-image-1");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("posts video generations to Voxvey", async () => {
    const originalFetch = globalThis.fetch;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.voxvey.com/v1/videos/generations");
      expect((init.headers as Headers).get("Authorization")).toBe("Bearer user-token");
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "xai/grok-imagine-video",
        prompt: "make it move",
        duration: 5,
      });
      return jsonResponse({ data: [{ url: "https://example.com/video.mp4" }] });
    });
    vi.stubGlobal("fetch", fetchFn);
    try {
      const result = await buildVoxveyVideoGenerationProvider().generateVideo({
        provider: "voxvey",
        model: "xai/grok-imagine-video",
        prompt: "make it move",
        durationSeconds: 5,
        cfg: {},
      });
      expect(result.videos).toEqual([
        expect.objectContaining({ url: "https://example.com/video.mp4", mimeType: "video/mp4" }),
      ]);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
