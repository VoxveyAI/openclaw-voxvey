import { describe, expect, it, vi } from "vitest";
import { VOXVEY_MODELS_URL } from "../src/constants.js";
import {
  buildVoxveyProviderConfig,
  fetchVoxveyModels,
  modelRefForVoxveyModel,
  parseVoxveyModelsResponse,
  resolveDefaultVoxveyModelRef,
  stripVoxveyProviderPrefix,
} from "../src/models.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("Voxvey models", () => {
  it("normalizes model ids and refs", () => {
    expect(stripVoxveyProviderPrefix("voxvey/model-a")).toBe("model-a");
    expect(stripVoxveyProviderPrefix("model-a")).toBe("model-a");
    expect(modelRefForVoxveyModel("voxvey/model-a")).toBe("voxvey/model-a");
    expect(modelRefForVoxveyModel("model-a")).toBe("voxvey/model-a");
  });

  it("parses OpenAI-compatible models responses", () => {
    expect(
      parseVoxveyModelsResponse({
        object: "list",
        data: [
          { id: "model-a", name: "Model A" },
          { id: "voxvey/model-b" },
          { id: "model-a" },
          { object: "model" },
        ],
      }),
    ).toEqual([
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "model-b" },
    ]);

    expect(() => parseVoxveyModelsResponse({ data: "nope" })).toThrow("data array");
  });

  it("fetches models with bearer auth", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(VOXVEY_MODELS_URL);
      expect(init.headers).toMatchObject({ Authorization: "Bearer user-token" });
      return jsonResponse({ data: [{ id: "model-a" }] });
    });

    await expect(
      fetchVoxveyModels({ token: "user-token", fetchFn: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual([{ id: "model-a", name: "model-a" }]);
  });

  it("chooses the first fetched model as default and falls back for empty lists", async () => {
    await expect(
      resolveDefaultVoxveyModelRef({
        token: "user-token",
        fetchFn: (async () => jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] })) as typeof fetch,
      }),
    ).resolves.toBe("voxvey/model-a");

    await expect(
      resolveDefaultVoxveyModelRef({
        token: "user-token",
        fetchFn: (async () => jsonResponse({ data: [] })) as typeof fetch,
      }),
    ).resolves.toBe("voxvey/default");
  });

  it("builds provider config with fallback model when live catalog is empty", () => {
    const fallbackConfig = buildVoxveyProviderConfig({ models: [] });
    expect(fallbackConfig).toMatchObject({
      baseUrl: "https://api.voxvey.com/v1",
      api: "openai-responses",
    });
    expect(fallbackConfig.models[0]).toMatchObject({ id: "default", api: "openai-responses" });
    expect(fallbackConfig.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openai/gpt-realtime-2", realtime: true }),
        expect.objectContaining({ id: "xai/grok-voice-latest", realtime: true }),
      ]),
    );

    const liveConfig = buildVoxveyProviderConfig({
      apiKey: "token",
      models: [{ id: "model-a", name: "Model A" }],
    });
    expect(liveConfig.apiKey).toBe("token");
    expect(liveConfig.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model-a", name: "Model A" }),
        expect.objectContaining({ id: "openai/gpt-realtime-2", realtime: true }),
      ]),
    );
  });
});
