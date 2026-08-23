import { z } from "zod";
import type { TranslationResult, TranslationService } from "../shared/types";

const DEEPLX_TIMEOUT_MS = 30_000;

const deepLxResponseSchema = z.object({
  code: z.number(),
  data: z.string().min(1),
  source_lang: z.string().optional(),
});

const SUPPORTED_TARGET_LANGUAGES = new Set(["AR", "DE", "EN", "ES", "FR", "IT", "JA", "KO", "PT", "RU", "ZH"]);

export function deepLxTargetLanguage(targetLanguage: string): string {
  switch (targetLanguage.toLowerCase()) {
    case "zh-cn":
      return "ZH";
    case "zh-tw":
      return "ZH-HANT";
    default:
      const code = targetLanguage.split("-")[0]?.toUpperCase() ?? "";
      return SUPPORTED_TARGET_LANGUAGES.has(code) ? code : "ZH";
  }
}

export function parseDeepLxResponse(value: unknown): { translation: string; sourceLanguage: string } {
  const parsed = deepLxResponseSchema.parse(value);
  if (parsed.code < 200 || parsed.code >= 300) {
    throw new DeepLxError(`翻译服务返回错误 ${parsed.code}`, parsed.code);
  }
  return {
    translation: parsed.data,
    sourceLanguage: parsed.source_lang?.trim() || "auto",
  };
}

class DeepLxError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeepLxError";
    this.status = status;
  }
}

function createDeadline(signal: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    DEEPLX_TIMEOUT_MS,
  );
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", abort);
    },
  };
}

function deepLxEndpoint(baseUrl: string, apiKey: string): string {
  const url = new URL(baseUrl);
  if (!/\/translate\/?$/u.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/translate`;
  }
  const token = apiKey.trim();
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export async function translateWithDeepLx(
  service: TranslationService,
  text: string,
  targetLanguage: string,
  signal: AbortSignal,
): Promise<TranslationResult> {
  const deadline = createDeadline(signal);
  try {
    const response = await fetch(deepLxEndpoint(service.baseUrl, service.apiKey), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        source_lang: "auto",
        target_lang: deepLxTargetLanguage(targetLanguage),
      }),
      signal: deadline.signal,
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (raw as { message?: unknown } | null)?.message;
      throw new DeepLxError(
        typeof message === "string" && message ? message : `翻译服务返回 HTTP ${response.status}`,
        response.status,
      );
    }
    const parsed = parseDeepLxResponse(raw);
    return {
      kind: "text",
      sourceLanguage: parsed.sourceLanguage,
      translation: parsed.translation,
    };
  } finally {
    deadline.dispose();
  }
}
