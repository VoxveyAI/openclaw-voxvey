import type { ProviderRuntimeModel } from "openclaw/plugin-sdk/plugin-entry";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  PROVIDER_ID,
  VOXVEY_API_BASE_URL,
  VOXVEY_FALLBACK_MODEL_ID,
  VOXVEY_MODELS_URL,
} from "./constants.js";
import { parseJsonObject, readString } from "./http.js";

export type VoxveyModelEntry = {
  id: string;
  name: string;
};

export function stripVoxveyProviderPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  const prefix = `${PROVIDER_ID}/`;
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

export function modelRefForVoxveyModel(modelId: string): string {
  return `${PROVIDER_ID}/${stripVoxveyProviderPrefix(modelId)}`;
}

export function buildVoxveyRuntimeModel(modelId: string): ProviderRuntimeModel {
  const id = stripVoxveyProviderPrefix(modelId);
  return {
    id,
    name: id,
    api: "openai-completions" as const,
    provider: PROVIDER_ID,
    baseUrl: VOXVEY_API_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

export function buildVoxveyModelDefinition(
  modelId: string,
  name = stripVoxveyProviderPrefix(modelId),
): ModelDefinitionConfig {
  const id = stripVoxveyProviderPrefix(modelId);
  return {
    id,
    name,
    api: "openai-completions",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

export function buildVoxveyProviderConfig(params: {
  apiKey?: string;
  models: readonly VoxveyModelEntry[];
}): ModelProviderConfig {
  const models =
    params.models.length > 0
      ? params.models.map((model) => buildVoxveyModelDefinition(model.id, model.name))
      : [buildVoxveyModelDefinition(VOXVEY_FALLBACK_MODEL_ID)];

  return {
    baseUrl: VOXVEY_API_BASE_URL,
    api: "openai-completions",
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
    models,
  };
}

export function parseVoxveyModelsResponse(value: unknown): VoxveyModelEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voxvey models response must be a JSON object.");
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error("Voxvey models response missing data array.");
  }

  const models: VoxveyModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const id = readString((item as Record<string, unknown>).id);
    if (!id) {
      continue;
    }
    const normalized = stripVoxveyProviderPrefix(id);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    models.push({
      id: normalized,
      name: readString((item as Record<string, unknown>).name) ?? normalized,
    });
  }
  return models;
}

export async function fetchVoxveyModels(params: {
  token: string;
  fetchFn?: typeof fetch;
}): Promise<VoxveyModelEntry[]> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(VOXVEY_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: "application/json",
    },
  });

  const bodyText = await response.text();
  const body = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(
      body?.error && typeof body.error === "string"
        ? `Voxvey models request failed: ${body.error}`
        : `Voxvey models request failed: HTTP ${response.status}`,
    );
  }
  if (!body) {
    throw new Error("Voxvey models response was not JSON.");
  }
  return parseVoxveyModelsResponse(body);
}

export async function resolveDefaultVoxveyModelRef(params: {
  token: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const models = await fetchVoxveyModels(params);
  return models[0] ? modelRefForVoxveyModel(models[0].id) : modelRefForVoxveyModel(VOXVEY_FALLBACK_MODEL_ID);
}
