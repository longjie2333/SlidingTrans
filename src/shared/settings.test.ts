import { describe, expect, it } from "vitest";
import { createDefaultSettings, isHostBlocked, normalizeHost, parseContentSettings, parseSettings } from "./settings";

describe("settings", () => {
  it("uses a Chinese default language and mini hover trigger", () => {
    const settings = createDefaultSettings("zh-CN");
    expect(settings.targetLanguage).toBe("zh-CN");
    expect(settings.triggerMode).toBe("mini");
    expect(settings.triggerActivation).toBe("hover");
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
    const { apiKey, ...contentSettings } = settings;
    expect(parseSettings(contentSettings, apiKey).baseUrl).toBe("https://api.openai.com/v1");
    expect(parseContentSettings(contentSettings)).not.toHaveProperty("apiKey");
  });
});
