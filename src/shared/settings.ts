import { z } from "zod";
import type { ContentSettings, SlidingTransSettings } from "./types";

export const SETTINGS_KEY = "slidingTransSettings";
export const API_KEY_KEY = "slidingTransApiKey";
export const PAUSED_HOSTS_KEY = "slidingTransPausedHosts";

const apiKeySchema = z.string().max(4096);
const settingsSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: z.string().trim().min(2).max(32),
  protocol: z.enum(["chat-completions", "responses"]),
  baseUrl: z.url({ protocol: /^(https?)$/ }),
  apiKey: apiKeySchema,
  model: z.string().trim().max(200),
  triggerMode: z.enum(["mini", "icon", "direct"]),
  triggerActivation: z.enum(["hover", "click"]),
  autoReadWord: z.boolean(),
  enableWhenSameLanguage: z.boolean(),
  blockedHosts: z.array(z.string().trim().min(1).max(253)).max(500),
});
const contentSettingsSchema = settingsSchema.omit({ apiKey: true });

export const TARGET_LANGUAGES = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁体中文"],
  ["en", "英语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
  ["pt", "葡萄牙语"],
  ["it", "意大利语"],
  ["ru", "俄语"],
  ["ar", "阿拉伯语"],
] as const;

function normalizeUiLanguage(language: string): string {
  const lower = language.toLowerCase();
  if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) return "zh-TW";
  if (lower.startsWith("zh")) return "zh-CN";
  const base = lower.split("-")[0] ?? "";
  return TARGET_LANGUAGES.some(([code]) => code === base) ? base : "zh-CN";
}

export function createDefaultSettings(uiLanguage = "zh-CN"): SlidingTransSettings {
  return {
    enabled: true,
    targetLanguage: normalizeUiLanguage(uiLanguage),
    protocol: "chat-completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    triggerMode: "mini",
    triggerActivation: "hover",
    autoReadWord: false,
    enableWhenSameLanguage: true,
    blockedHosts: [],
  };
}

export function createDefaultContentSettings(uiLanguage = "zh-CN"): ContentSettings {
  const { apiKey: _, ...settings } = createDefaultSettings(uiLanguage);
  return settings;
}

export function parseContentSettings(
  value: unknown,
  defaults = createDefaultContentSettings(),
): ContentSettings {
  const parsed = contentSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaults;
}

export function parseSettings(
  value: unknown,
  apiKey: unknown,
  defaults = createDefaultSettings(),
): SlidingTransSettings {
  const content = contentSettingsSchema.safeParse(value);
  const parsedApiKey = apiKeySchema.safeParse(apiKey);
  return content.success && parsedApiKey.success
    ? { ...content.data, apiKey: parsedApiKey.data }
    : defaults;
}

export async function loadSettings(): Promise<SlidingTransSettings> {
  const defaults = createDefaultSettings(browser.i18n.getUILanguage());
  const stored = await browser.storage.local.get([SETTINGS_KEY, API_KEY_KEY]);
  return parseSettings(stored[SETTINGS_KEY], stored[API_KEY_KEY] ?? "", defaults);
}

export async function loadContentSettings(): Promise<ContentSettings> {
  const defaults = createDefaultContentSettings(browser.i18n.getUILanguage());
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return parseContentSettings(stored[SETTINGS_KEY], defaults);
}

export async function saveSettings(settings: SlidingTransSettings): Promise<void> {
  const parsed = settingsSchema.parse(settings);
  const { apiKey, ...contentSettings } = parsed;
  await browser.storage.local.set({
    [SETTINGS_KEY]: contentSettings,
    [API_KEY_KEY]: apiKey,
  });
}

export async function saveContentSettings(settings: ContentSettings): Promise<void> {
  const parsed = contentSettingsSchema.parse(settings);
  await browser.storage.local.set({ [SETTINGS_KEY]: parsed });
}

export function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return "";
  }
}

export function isHostBlocked(hostname: string, blockedHosts: string[]): boolean {
  const current = normalizeHost(hostname);
  return blockedHosts.some((entry) => {
    const blocked = normalizeHost(entry);
    return blocked !== "" && (current === blocked || current.endsWith(`.${blocked}`));
  });
}

export async function pauseHostForSession(hostname: string): Promise<void> {
  const host = normalizeHost(hostname);
  if (!host) return;
  const current = await browser.storage.session.get(PAUSED_HOSTS_KEY);
  const paused = new Set<string>(
    Array.isArray(current[PAUSED_HOSTS_KEY]) ? current[PAUSED_HOSTS_KEY] : [],
  );
  paused.add(host);
  await browser.storage.session.set({ [PAUSED_HOSTS_KEY]: [...paused] });
}

export async function isHostPausedForSession(hostname: string): Promise<boolean> {
  const current = await browser.storage.session.get(PAUSED_HOSTS_KEY);
  const paused = Array.isArray(current[PAUSED_HOSTS_KEY])
    ? (current[PAUSED_HOSTS_KEY] as string[])
    : [];
  return isHostBlocked(hostname, paused);
}
