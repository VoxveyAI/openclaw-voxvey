import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search";
import {
  buildSearchCacheKey,
  readCachedSearchPayload,
  readPositiveIntegerParam,
  readStringParam,
  resolveSearchCacheTtlMs,
  resolveSearchTimeoutSeconds,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";
import {
  PROVIDER_ID,
  VOXVEY_FIRECRAWL_BASE_URL,
  VOXVEY_SEARCH_PROVIDER_ID,
  VOXVEY_SEARCH_PROVIDER_LABEL,
} from "./constants.js";
import { resolveVoxveyAccessToken } from "./auth.js";
import { parseJsonObject, readString } from "./http.js";

function firecrawlResultsToContent(payload: Record<string, unknown>): string {
  const data = payload.data;
  if (!Array.isArray(data)) {
    return JSON.stringify(payload, null, 2);
  }
  return data
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      const entry = item as Record<string, unknown>;
      const title = readString(entry.title) ?? readString(entry.url) ?? `Result ${index + 1}`;
      const url = readString(entry.url);
      const description = readString(entry.description) ?? readString(entry.markdown) ?? readString(entry.content);
      return [`${index + 1}. ${title}`, url, description].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function firecrawlCitations(payload: Record<string, unknown>): string[] {
  const data = payload.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? readString((item as Record<string, unknown>).url) : undefined))
    .filter((url): url is string => Boolean(url));
}

export function buildVoxveySearchProvider(): WebSearchProviderPlugin {
  return {
    id: VOXVEY_SEARCH_PROVIDER_ID,
    label: VOXVEY_SEARCH_PROVIDER_LABEL,
    hint: "Search the web through Voxvey's Firecrawl-compatible API",
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    authProviderId: PROVIDER_ID,
    credentialLabel: "Voxvey login",
    envVars: [],
    placeholder: "Uses your Voxvey login",
    signupUrl: "https://voxvey.com",
    docsUrl: "https://api.voxvey.com/openapi.json",
    credentialPath: "tools.web.search.voxvey.apiKey",
    getCredentialValue: () => undefined,
    setCredentialValue: () => {},
    createTool: (ctx) => ({
      name: "web_search",
      description: "Search the web with Voxvey Search.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search query." },
          count: { type: "integer", minimum: 1, maximum: 10, description: "Number of results." },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = readStringParam(args, "query", { required: true });
        const count = readPositiveIntegerParam(args, "count", { max: 10 }) ?? 5;
        const cacheKey = buildSearchCacheKey([VOXVEY_SEARCH_PROVIDER_ID, query, count]);
        const cached = readCachedSearchPayload(cacheKey);
        if (cached) {
          return cached;
        }
        const token = await resolveVoxveyAccessToken({
          cfg: ctx.config,
          agentDir: ctx.agentDir,
        });
        const response = await fetch(`${VOXVEY_FIRECRAWL_BASE_URL}/search`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, limit: count }),
          signal: AbortSignal.timeout(resolveSearchTimeoutSeconds(ctx.searchConfig) * 1000),
        });
        const bodyText = await response.text();
        const payload = parseJsonObject(bodyText);
        if (!response.ok) {
          return {
            error: "voxvey_search_failed",
            message: `Voxvey Search failed: HTTP ${response.status}`,
            provider: VOXVEY_SEARCH_PROVIDER_ID,
          };
        }
        if (!payload) {
          return {
            error: "voxvey_search_malformed",
            message: "Voxvey Search returned a non-JSON response.",
            provider: VOXVEY_SEARCH_PROVIDER_ID,
          };
        }
        const result = {
          query,
          provider: VOXVEY_SEARCH_PROVIDER_ID,
          externalContent: {
            untrusted: true,
            source: "web_search",
            provider: VOXVEY_SEARCH_PROVIDER_ID,
            wrapped: true,
          },
          content: wrapWebContent(firecrawlResultsToContent(payload)),
          citations: firecrawlCitations(payload),
          raw: payload,
        };
        writeCachedSearchPayload(cacheKey, result, resolveSearchCacheTtlMs(ctx.searchConfig));
        return result;
      },
    }),
  };
}
