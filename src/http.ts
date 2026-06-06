export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

export function expiresAtFromSeconds(expiresIn: unknown, now = Date.now()): number | undefined {
  const seconds = readPositiveInteger(expiresIn);
  return seconds === undefined ? undefined : now + seconds * 1000;
}

export async function readJsonObjectResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = parseJsonObject(text);
  if (!body) {
    throw new Error("Expected JSON object response");
  }
  return body;
}

export function formatOAuthErrorResponse(params: {
  prefix: string;
  status: number;
  body: Record<string, unknown> | null;
  bodyText: string;
}): string {
  const error = readString(params.body?.error);
  const description = readString(params.body?.error_description);
  if (error && description) {
    return `${params.prefix}: ${error} (${description})`;
  }
  if (error) {
    return `${params.prefix}: ${error}`;
  }
  const fallback = params.bodyText.trim().replace(/\s+/g, " ");
  return fallback
    ? `${params.prefix}: HTTP ${params.status} ${fallback}`
    : `${params.prefix}: HTTP ${params.status}`;
}
