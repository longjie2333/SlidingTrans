import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationService } from "../shared/types";
import { deepLxTargetLanguage, parseDeepLxResponse, translateWithDeepLx } from "./deeplx";

function createService(): TranslationService {
  return {
    id: "deeplx",
    name: "DeepLX",
    protocol: "deeplx",
    baseUrl: "http://localhost:1188",
    apiKey: "test-token",
    model: "",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepLX client", () => {
  it("maps target languages to DeepLX codes", () => {
    expect(deepLxTargetLanguage("zh-CN")).toBe("ZH");
    expect(deepLxTargetLanguage("zh-TW")).toBe("ZH-HANT");
    expect(deepLxTargetLanguage("en")).toBe("EN");
    expect(deepLxTargetLanguage("ja")).toBe("JA");
    expect(deepLxTargetLanguage("unknown")).toBe("ZH");
  });

  it("parses the DeepLX response payload", () => {
    expect(parseDeepLxResponse({
      code: 200,
      data: "你好",
      source_lang: "EN",
      method: "Free",
    })).toEqual({ translation: "你好", sourceLanguage: "EN" });
  });

  it("rejects DeepLX error bodies returned over HTTP 200", () => {
    expect(() => parseDeepLxResponse({
      code: 401,
      data: "Invalid access token",
      source_lang: "EN",
    })).toThrow("翻译服务返回错误 401");
  });

  it("posts the token to /translate and returns a plain text result", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      code: 200,
      data: "你好",
      source_lang: "EN",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateWithDeepLx(createService(), "Hello", "zh-CN", new AbortController().signal);

    expect(result).toEqual({ kind: "text", sourceLanguage: "EN", translation: "你好" });
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("http://localhost:1188/translate?token=test-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Hello",
      source_lang: "auto",
      target_lang: "ZH",
    });
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("keeps query parameters from the DeepLX base URL", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      code: 200,
      data: "你好",
      source_lang: "EN",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await translateWithDeepLx(
      { ...createService(), baseUrl: "https://example.com/translate?foo=1" },
      "Hello",
      "zh-CN",
      new AbortController().signal,
    );

    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://example.com/translate?foo=1&token=test-token");
  });

  it("surfaces DeepLX HTTP error bodies", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ message: "Invalid access token" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(translateWithDeepLx(createService(), "Hello", "zh-CN", new AbortController().signal))
      .rejects.toMatchObject({ status: 401, message: "Invalid access token" });
  });
});
