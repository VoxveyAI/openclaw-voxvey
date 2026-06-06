import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/image-generation-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { PROVIDER_ID } from "./constants.js";

export type VoxveyAuthResolutionContext = {
  cfg?: OpenClawConfig;
  agentDir?: string;
  authStore?: unknown;
  workspaceDir?: string;
};

export async function resolveVoxveyAccessToken(ctx: VoxveyAuthResolutionContext): Promise<string> {
  const auth = await resolveApiKeyForProvider({
    provider: PROVIDER_ID,
    cfg: ctx.cfg,
    agentDir: ctx.agentDir,
    workspaceDir: ctx.workspaceDir,
    store: ctx.authStore as never,
    modelApi: "openai-responses",
  });
  if (!auth.apiKey) {
    throw new Error("Voxvey login required. Run `openclaw models auth login --provider voxvey`.");
  }
  return auth.apiKey;
}

export async function hasVoxveyAccessToken(ctx: VoxveyAuthResolutionContext): Promise<boolean> {
  try {
    return Boolean(await resolveVoxveyAccessToken(ctx));
  } catch {
    return false;
  }
}
