import { describe, expect, it, vi } from "vitest";
import { buildVoxveySearchProvider } from "../src/search.js";

vi.mock("openclaw/plugin-sdk/image-generation-core", () => ({
  resolveApiKeyForProvider: vi.fn(async () => ({ apiKey: "user-token", mode: "oauth" })),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("Voxvey Search provider", () => {
  it("posts Firecrawl-compatible searches through Voxvey", async () => {
    const originalFetch = globalThis.fetch;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.voxvey.com/v1/v2/search");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      expect(JSON.parse(String(init.body))).toEqual({ query: "latest ai news", limit: 3 });
      return jsonResponse({
        data: [{ title: "Result", url: "https://example.com", description: "Summary" }],
      });
    });
    vi.stubGlobal("fetch", fetchFn);
    try {
      const provider = buildVoxveySearchProvider();
      const tool = provider.createTool({
        config: {},
        agentDir: "/tmp/agent",
        searchConfig: { cacheTtlMinutes: 0 },
      } as never);
      await expect(tool?.execute({ query: "latest ai news", count: 3 })).resolves.toMatchObject({
        provider: "voxvey-search",
        citations: ["https://example.com"],
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
