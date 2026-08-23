import OpenAI from "openai";
import { defineBackground } from "wxt/utils/define-background";
import { translateWithDeepLx } from "./background/deeplx";
import { getActiveService, loadSettings } from "./shared/settings";
import { parseModelIds } from "./shared/models";
import { buildPrompts, extractPartialTranslation, normalizePartOfSpeech, parseTranslationResult } from "./shared/translation";
import type {
  BackgroundRequest,
  TranslationRequest,
  TranslationResult,
  TranslationStreamEvent,
} from "./shared/types";

interface ActiveRequest {
  controller: AbortController;
  port: chrome.runtime.Port;
}

const activeRequests = new Map<string, ActiveRequest>();

function post(port: chrome.runtime.Port, event: TranslationStreamEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // The content tab may close while a stream is in flight.
  }
}

function getClient(service: Awaited<ReturnType<typeof getActiveService>>): OpenAI {
  const client = getAuthenticatedClient(service);
  if (!service.model.trim()) throw new Error("请先在设置页填写模型名称");
  return client;
}

function getAuthenticatedClient(service: Awaited<ReturnType<typeof getActiveService>>): OpenAI {
  if (!service.apiKey.trim()) throw new Error("请先在设置页填写 API Key");
  return new OpenAI({
    apiKey: service.apiKey,
    baseURL: service.baseUrl,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: 30_000,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as { status?: number; code?: string };
  if (typeof candidate.status === "number") return String(candidate.status);
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function errorMessage(error: unknown): string {
  const candidate = error as { status?: number; code?: string; name?: string; message?: string };
  if (candidate.status === 401) return "API Key 无效，请检查后重试";
  if (candidate.status === 403) return "当前 API Key 没有访问该模型或接口的权限";
  if (candidate.status === 429) return "请求过于频繁或额度不足，请稍后重试";
  if (candidate.name === "APIConnectionTimeoutError" || candidate.name === "TimeoutError" || candidate.code === "ETIMEDOUT" || candidate.message?.toLowerCase().includes("timed out")) {
    return "连接翻译服务超时，请检查网络或接口地址";
  }
  if (candidate.name === "APIConnectionError") return "无法连接翻译服务，请检查网络和 API Base URL";
  if (candidate.name === "ZodError" || error instanceof SyntaxError) return "模型返回格式无法解析，请重试";
  if (error instanceof Error && error.message) return error.message;
  return "翻译请求失败，请稍后重试";
}

async function streamChatCompletion(
  client: OpenAI,
  model: string,
  request: TranslationRequest,
  targetLanguage: string,
  systemPrompt: string,
  signal: AbortSignal,
  onText: (value: string) => void,
): Promise<string> {
  const prompts = buildPrompts(request.text, request.contextText, targetLanguage, systemPrompt, request.segments);
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
    },
    { signal },
  );
  let buffer = "";
  for await (const chunk of stream) {
    if (signal.aborted) throw new DOMException("The request was aborted", "AbortError");
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (!delta) continue;
    buffer += delta;
    onText(buffer);
  }
  return buffer;
}

async function streamResponse(
  client: OpenAI,
  model: string,
  request: TranslationRequest,
  targetLanguage: string,
  systemPrompt: string,
  signal: AbortSignal,
  onText: (value: string) => void,
): Promise<string> {
  const prompts = buildPrompts(request.text, request.contextText, targetLanguage, systemPrompt, request.segments);
  const stream = await client.responses.create(
    {
      model,
      stream: true,
      instructions: prompts.system,
      input: prompts.user,
    },
    { signal },
  );
  let buffer = "";
  for await (const event of stream) {
    if (signal.aborted) throw new DOMException("The request was aborted", "AbortError");
    if (event.type !== "response.output_text.delta") continue;
    buffer += event.delta;
    onText(buffer);
  }
  return buffer;
}

async function runTranslation(
  request: TranslationRequest,
  port: chrome.runtime.Port,
): Promise<void> {
  const controller = new AbortController();
  activeRequests.set(request.requestId, { controller, port });
  try {
    const settings = await loadSettings();
    const service = getActiveService(settings);
    let result: TranslationResult;
    if (service.protocol === "deeplx") {
      result = await translateWithDeepLx(service, request.text, request.targetLanguage, controller.signal);
    } else {
      const client = getClient(service);
      let latestPartial = "";
      const onText = (buffer: string) => {
        const partial = extractPartialTranslation(buffer);
        if (partial === undefined || partial === latestPartial) return;
        latestPartial = partial;
        post(port, { type: "partial", requestId: request.requestId, translation: partial });
      };
      const raw = service.protocol === "openai-responses"
        ? await streamResponse(client, service.model, request, request.targetLanguage, settings.systemPrompt, controller.signal, onText)
        : await streamChatCompletion(client, service.model, request, request.targetLanguage, settings.systemPrompt, controller.signal, onText);
      result = normalizePartOfSpeech(parseTranslationResult(raw, request.segments), request.targetLanguage);
    }
    post(port, { type: "complete", requestId: request.requestId, result });
  } catch (error) {
    if (isAbortError(error)) {
      post(port, { type: "aborted", requestId: request.requestId });
    } else {
      post(port, {
        type: "error",
        requestId: request.requestId,
        message: errorMessage(error),
        ...(errorCode(error) ? { code: errorCode(error) } : {}),
      });
    }
  } finally {
    activeRequests.delete(request.requestId);
  }
}

export default defineBackground(() => {
  void browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "sliding-trans") return;
    port.onMessage.addListener((message: BackgroundRequest) => {
      if (message.type === "translate") {
        void runTranslation(message, port);
        return;
      }
      if (message.type === "abort") {
        activeRequests.get(message.requestId)?.controller.abort();
        return;
      }
      if (message.type === "test-connection") {
        void testConnection(message.requestId, port);
        return;
      }
      if (message.type === "list-models") {
        void listModels(message.requestId, port);
      }
    });
    port.onDisconnect.addListener(() => {
      for (const [requestId, request] of activeRequests) {
        if (request.port === port) {
          request.controller.abort();
          activeRequests.delete(requestId);
        }
      }
    });
  });
});

async function listModels(requestId: string, port: chrome.runtime.Port): Promise<void> {
  try {
    const settings = await loadSettings();
    const service = getActiveService(settings);
    if (service.protocol === "deeplx") {
      post(port, { type: "error", requestId, message: "DeepLX 协议不支持模型列表" });
      return;
    }
    const models = parseModelIds(await getAuthenticatedClient(service).models.list());
    if (!models.length) throw new Error("接口没有返回可用模型");
    post(port, { type: "models", requestId, models });
  } catch (error) {
    post(port, { type: "error", requestId, message: errorMessage(error), ...(errorCode(error) ? { code: errorCode(error) } : {}) });
  }
}

async function testConnection(requestId: string, port: chrome.runtime.Port): Promise<void> {
  try {
    const settings = await loadSettings();
    const service = getActiveService(settings);
    if (service.protocol === "deeplx") {
      const controller = new AbortController();
      await translateWithDeepLx(service, "hello", settings.targetLanguage, controller.signal);
      post(port, { type: "connection-ok", requestId, model: "DeepLX" });
      return;
    }
    const request: TranslationRequest = {
      type: "translate",
      requestId,
      text: "hello",
      contextText: "",
      segments: [{ id: "s0", text: "hello" }],
      targetLanguage: settings.targetLanguage,
    };
    const controller = new AbortController();
    const client = getClient(service);
    const prompts = buildPrompts(request.text, "", settings.targetLanguage, settings.systemPrompt, request.segments);
    if (service.protocol === "openai-responses") {
      await client.responses.create({ model: service.model, instructions: prompts.system, input: prompts.user }, { signal: controller.signal });
    } else {
      await client.chat.completions.create({ model: service.model, messages: [{ role: "system", content: prompts.system }, { role: "user", content: prompts.user }] }, { signal: controller.signal });
    }
    post(port, { type: "connection-ok", requestId, model: service.model });
  } catch (error) {
    post(port, { type: "error", requestId, message: errorMessage(error), ...(errorCode(error) ? { code: errorCode(error) } : {}) });
  }
}
