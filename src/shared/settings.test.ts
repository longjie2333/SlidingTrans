import { describe, expect, it } from "vitest";
import { createDefaultSettings, isHostBlocked, normalizeHost, parseContentSettings, parseSettings } from "./settings";

describe("settings", () => {
  it("uses a Chinese default language and mini hover trigger", () => {
    const settings = createDefaultSettings("zh-CN");
    expect(settings.targetLanguage).toBe("zh-CN");
    expect(settings.triggerMode).toBe("mini");
    expect(settings.triggerActivation).toBe("hover");
    expect(settings.services[0]?.protocol).toBe("openai-chat-completions");
    expect(settings.systemPrompt).toContain("{{targetLanguage}}");
    expect(settings.ignoreInputSelections).toBe(true);
  });

  it("matches a blocked domain and its subdomains", () => {
    expect(normalizeHost("HTTPS://Example.com/path")).toBe("example.com");
    expect(isHostBlocked("docs.example.com", ["example.com"])).toBe(true);
    expect(isHostBlocked("example.net", ["example.com"])).toBe(false);
  });

  it("falls back to defaults for malformed persisted settings", () => {
    expect(parseSettings({ enabled: "yes" }, "").enabled).toBe(true);
  });

  it("accepts the default HTTPS API URL", () => {
    const settings = createDefaultSettings();
    const contentSettings = { ...settings, services: settings.services.map(({ apiKey: _, ...service }) => service) };
    const parsed = parseSettings(contentSettings, { openai: "test-key" });
    expect(parsed.services[0]?.baseUrl).toBe("https://api.openai.com/v1");
    expect(parsed.services[0]?.apiKey).toBe("test-key");
    expect(parseContentSettings(contentSettings).services[0]).not.toHaveProperty("apiKey");
  });

  it("supports several services and an active service", () => {
    const settings = createDefaultSettings();
    const second = { ...settings.services[0]!, id: "local", name: "本地服务", baseUrl: "https://example.com/v1" };
    const { apiKey: _secondApiKey, ...publicSecond } = second;
    const contentSettings = { ...settings, services: settings.services.map(({ apiKey: _, ...service }) => service).concat(publicSecond) };
    const parsed = parseSettings({ ...contentSettings, activeServiceId: "local" }, { openai: "one", local: "two" });
    expect(parsed.activeServiceId).toBe("local");
    expect(parsed.services.find((service) => service.id === "local")?.apiKey).toBe("two");
    expect(parseContentSettings(contentSettings)).not.toHaveProperty("systemPrompt");
  });

  it("accepts a DeepLX service without a model name", () => {
    const settings = createDefaultSettings();
    const service = {
      ...settings.services[0]!,
      id: "deeplx",
      name: "DeepLX",
      protocol: "deeplx" as const,
      baseUrl: "http://localhost:1188",
      model: "",
    };
    const { apiKey: _, ...publicService } = service;
    const contentSettings = {
      ...settings,
      services: settings.services.map(({ apiKey: _apiKey, ...current }) => current).concat(publicService),
      activeServiceId: "deeplx",
    };
    const parsed = parseSettings(contentSettings, { openai: "one", deeplx: "" });
    expect(parsed.services.find((candidate) => candidate.id === "deeplx")).toMatchObject({
      protocol: "deeplx",
      baseUrl: "http://localhost:1188",
      model: "",
    });
  });
});
