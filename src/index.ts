import { definePluginEntry, type ProviderAuthMethod } from "openclaw/plugin-sdk/plugin-entry";
import type { ProviderPlugin } from "openclaw/plugin-sdk/provider-model-shared";
import { runVoxveyDeviceCodeLogin } from "./device-code.js";
import { PROVIDER_ID, PROVIDER_LABEL } from "./constants.js";
import { buildVoxveyProviderConfig, buildVoxveyRuntimeModel, fetchVoxveyModels } from "./models.js";
import { refreshVoxveyOAuthCredential, runVoxveyOAuthLogin } from "./oauth.js";

const VOXVEY_WIZARD_GROUP = {
  groupId: "voxvey",
  groupLabel: "Voxvey",
  groupHint: "Voxvey sign-in",
} as const;

export function buildVoxveyAuthMethods(): ProviderAuthMethod[] {
  return [
    {
      id: "oauth",
      label: "Voxvey Login",
      hint: "Sign in with your Voxvey account",
      kind: "oauth",
      wizard: {
        choiceId: "voxvey",
        choiceLabel: "Voxvey Login",
        choiceHint: "Sign in with your Voxvey account",
        assistantPriority: -30,
        onboardingFeatured: true,
        ...VOXVEY_WIZARD_GROUP,
      },
      run: async (ctx) => await runVoxveyOAuthLogin(ctx),
    },
    {
      id: "device-code",
      label: "Voxvey Device Pairing",
      hint: "Pair your Voxvey account in browser with a device code",
      kind: "device_code",
      wizard: {
        choiceId: "voxvey-device-code",
        choiceLabel: "Voxvey Device Pairing",
        choiceHint: "Pair your Voxvey account in browser with a device code",
        assistantPriority: -10,
        assistantVisibility: "manual-only",
        ...VOXVEY_WIZARD_GROUP,
      },
      run: async (ctx) => await runVoxveyDeviceCodeLogin(ctx),
    },
  ];
}

export function buildVoxveyProvider(): ProviderPlugin {
  return {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    docsPath: "/providers/models",
    auth: buildVoxveyAuthMethods(),
    catalog: {
      order: "simple",
      run: async (ctx) => {
        const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
        if (!apiKey) {
          return null;
        }
        const models = await fetchVoxveyModels({ token: apiKey });
        return {
          provider: buildVoxveyProviderConfig({ apiKey, models }),
        };
      },
    },
    staticCatalog: {
      order: "simple",
      run: async () => ({
        provider: buildVoxveyProviderConfig({ models: [] }),
      }),
    },
    resolveDynamicModel: (ctx) => buildVoxveyRuntimeModel(ctx.modelId),
    normalizeResolvedModel: (ctx) => {
      if (ctx.model.provider !== PROVIDER_ID) {
        return undefined;
      }
      return buildVoxveyRuntimeModel(ctx.model.id);
    },
    formatApiKey: (credential) => (credential.type === "oauth" ? credential.access : ""),
    refreshOAuth: async (credential) => await refreshVoxveyOAuthCredential(credential),
    isModernModelRef: () => true,
  };
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: PROVIDER_LABEL,
  description: "Voxvey OpenAI-compatible model provider",
  register(api) {
    api.registerProvider(buildVoxveyProvider());
  },
});
