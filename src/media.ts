import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationSourceImage,
} from "openclaw/plugin-sdk/image-generation";
import { parseOpenAiCompatibleImageResponse } from "openclaw/plugin-sdk/image-generation";
import type {
  GeneratedVideoAsset,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationSourceAsset,
} from "openclaw/plugin-sdk/video-generation";
import {
  PROVIDER_ID,
  PROVIDER_LABEL,
  VOXVEY_API_BASE_URL,
  VOXVEY_DEFAULT_IMAGE_MODEL,
  VOXVEY_DEFAULT_VIDEO_MODEL,
  VOXVEY_IMAGE_MODELS,
  VOXVEY_VIDEO_MODELS,
} from "./constants.js";
import { parseJsonObject } from "./http.js";
import { resolveVoxveyAccessToken } from "./auth.js";

function trimVoxveyModel(model: string | undefined, fallback: string): string {
  const raw = (model ?? fallback).trim() || fallback;
  const prefix = `${PROVIDER_ID}/`;
  return raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function jsonHeaders(token: string): Headers {
  return new Headers({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  });
}

async function readJsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = parseJsonObject(text);
  if (!response.ok) {
    const message =
      body && typeof body.error === "object" && body.error && "message" in body.error
        ? String((body.error as Record<string, unknown>).message)
        : `HTTP ${response.status}`;
    throw new Error(`${label}: ${message}`);
  }
  if (!body) {
    throw new Error(`${label}: response was not JSON`);
  }
  return body;
}

function imageDataUrl(image: ImageGenerationSourceImage): string | undefined {
  if (!image.buffer) {
    return undefined;
  }
  const mimeType = image.mimeType?.trim() || "image/png";
  return `data:${mimeType};base64,${Buffer.from(image.buffer).toString("base64")}`;
}

function imageOutputExtension(req: ImageGenerationRequest): string {
  if (req.outputFormat === "jpeg") {
    return "jpg";
  }
  if (req.outputFormat === "webp") {
    return "webp";
  }
  return "png";
}

export function buildVoxveyImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    defaultModel: VOXVEY_DEFAULT_IMAGE_MODEL,
    models: [...VOXVEY_IMAGE_MODELS],
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: false,
      },
      edit: {
        enabled: true,
        maxCount: 4,
        maxInputImages: 8,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: false,
      },
      geometry: {
        sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      },
      output: {
        formats: ["png", "jpeg", "webp"],
        qualities: ["low", "medium", "high", "auto"],
        backgrounds: ["transparent", "opaque", "auto"],
      },
    },
    isConfigured: () => true,
    async generateImage(req) {
      const token = await resolveVoxveyAccessToken(req);
      const inputImages = req.inputImages ?? [];
      const model = trimVoxveyModel(req.model, VOXVEY_DEFAULT_IMAGE_MODEL);
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        n: req.count ?? 1,
        ...(req.size ? { size: req.size } : {}),
        ...(req.quality ? { quality: req.quality } : {}),
        ...(req.outputFormat ? { output_format: req.outputFormat } : {}),
        ...(req.background ? { background: req.background } : {}),
        ...(req.providerOptions ?? {}),
      };
      let route = "/images/generations";
      if (inputImages.length > 0) {
        route = "/images/edits";
        body.image = inputImages.map(imageDataUrl).filter(Boolean);
      }
      const response = await fetch(`${VOXVEY_API_BASE_URL}${route}`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      });
      const payload = await readJsonResponse(response, "Voxvey image generation failed");
      const extension = imageOutputExtension(req);
      const images: GeneratedImageAsset[] = parseOpenAiCompatibleImageResponse(payload, {
        defaultMimeType: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
        fileNamePrefix: "voxvey-image",
        sniffMimeType: true,
      }).map((image, index) => ({
        ...image,
        fileName: image.fileName ?? `voxvey-image-${index + 1}.${extension}`,
      }));
      if (images.length === 0) {
        throw new Error("Voxvey image generation response missing image data");
      }
      return { images, model };
    },
  };
}

function sourceAssetUrl(asset: VideoGenerationSourceAsset): string | undefined {
  if (asset.url) {
    return asset.url;
  }
  if (!asset.buffer) {
    return undefined;
  }
  const mimeType = asset.mimeType?.trim() || "application/octet-stream";
  return `data:${mimeType};base64,${Buffer.from(asset.buffer).toString("base64")}`;
}

function extractVideoAssets(payload: Record<string, unknown>): GeneratedVideoAsset[] {
  const assets: GeneratedVideoAsset[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === "string" && value) {
      assets.push({ url: value, mimeType: "video/mp4", fileName: `voxvey-video-${assets.length + 1}.mp4` });
    }
  };
  pushUrl(payload.url);
  pushUrl(payload.video_url);
  const output = payload.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    pushUrl((output as Record<string, unknown>).video_url);
    const results = (output as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const result of results) {
        if (result && typeof result === "object" && !Array.isArray(result)) {
          pushUrl((result as Record<string, unknown>).video_url);
          pushUrl((result as Record<string, unknown>).url);
        }
      }
    }
  }
  const data = payload.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        pushUrl((item as Record<string, unknown>).url);
        pushUrl((item as Record<string, unknown>).video_url);
      }
    }
  }
  return assets;
}

export function buildVoxveyVideoGenerationProvider(): VideoGenerationProvider {
  return {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    defaultModel: VOXVEY_DEFAULT_VIDEO_MODEL,
    models: [...VOXVEY_VIDEO_MODELS],
    defaultTimeoutMs: 120_000,
    capabilities: {
      maxVideos: 1,
      maxDurationSeconds: 20,
      sizes: ["1280x720", "720x1280", "1024x1024"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["720P", "1080P"],
      supportsSize: true,
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsAudio: true,
      imageToVideo: {
        enabled: true,
        maxInputImages: 8,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsAudio: true,
      },
      videoToVideo: {
        enabled: true,
        maxInputVideos: 1,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsAudio: true,
      },
    },
    isConfigured: () => true,
    async generateVideo(req: VideoGenerationRequest) {
      const token = await resolveVoxveyAccessToken(req);
      const model = trimVoxveyModel(req.model, VOXVEY_DEFAULT_VIDEO_MODEL);
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        ...(req.size ? { size: req.size } : {}),
        ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
        ...(req.resolution ? { resolution: req.resolution } : {}),
        ...(req.durationSeconds ? { duration: req.durationSeconds } : {}),
        ...(req.audio !== undefined ? { audio: req.audio } : {}),
        ...(req.watermark !== undefined ? { watermark: req.watermark } : {}),
        ...(req.providerOptions ?? {}),
      };
      const imageUrls = (req.inputImages ?? []).map(sourceAssetUrl).filter(Boolean);
      const videoUrls = (req.inputVideos ?? []).map(sourceAssetUrl).filter(Boolean);
      if (imageUrls.length > 0) {
        body.image = imageUrls.length === 1 ? imageUrls[0] : imageUrls;
      }
      if (videoUrls.length > 0) {
        body.video = videoUrls.length === 1 ? videoUrls[0] : videoUrls;
      }
      const response = await fetch(`${VOXVEY_API_BASE_URL}/videos/generations`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      });
      const payload = await readJsonResponse(response, "Voxvey video generation failed");
      const videos = extractVideoAssets(payload);
      return {
        videos,
        model,
        metadata: videos.length === 0 ? payload : { response: payload },
      };
    },
  };
}
