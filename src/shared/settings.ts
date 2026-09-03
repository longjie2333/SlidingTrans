import { z } from "zod";
import type { ContentSettings, PublicTranslationService, SlidingTransSettings, TranslationService } from "./types";
import { SELECTION_SYSTEM_PROMPT } from "./translation";

export const SETTINGS_KEY = "slidingTransSettings";
export const SERVICE_KEYS_KEY = "slidingTransServiceKeys";
export const PAUSED_HOSTS_KEY = "slidingTransPausedHosts";

const apiKeySchema = z.string().max(4096);
const serviceIdSchema = z.string().trim().min(1).max(100);
const serviceNameSchema = z.string().trim().min(1).max(100);
const serviceSchema = z.object({
  id: serviceIdSchema,
  name: serviceNameSchema,
  protocol: z.enum(["openai-chat-completions", "openai-responses", "deeplx"]),
  baseUrl: z.url({ protocol: /^(https?)$/ }),
  apiKey: apiKeySchema,
  model: z.string().trim().max(200),
});
const publicServiceSchema = serviceSchema.omit({ apiKey: true });
const settingsSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: z.string().trim().min(2).max(32),
  systemPrompt: z.string().trim().min(1).max(20000).default(SELECTION_SYSTEM_PROMPT),
  services: z.array(serviceSchema).min(1).max(20),
  activeServiceId: serviceIdSchema,
  triggerMode: z.enum(["mini", "icon", "direct"]),
  triggerActivation: z.enum(["hover", "click"]),
  autoReadWord: z.boolean(),
  enableWhenSameLanguage: z.boolean(),
  ignoreInputSelections: z.boolean(),
  pageTranslationEnabled: z.boolean().default(false),
  pageTranslationMode: z.enum(["below", "replace"]).default("below"),
  blockedHosts: z.array(z.string().trim().min(1).max(253)).max(500),
});
const contentSettingsSchema = settingsSchema.omit({ services: true, systemPrompt: true }).extend({ services: z.array(publicServiceSchema).min(1).max(20) });
const storedSettingsSchema = settingsSchema.omit({ services: true }).extend({ services: z.array(publicServiceSchema).min(1).max(20) });
const serviceKeysSchema = z.record(serviceIdSchema, apiKeySchema);

function createDefaultService(): TranslationService {
  return {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-chat-completions",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
  };
}

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
  const service = createDefaultService();
  return {
    enabled: true,
    targetLanguage: normalizeUiLanguage(uiLanguage),
    systemPrompt: SELECTION_SYSTEM_PROMPT,
    services: [service],
    activeServiceId: service.id,
    triggerMode: "mini",
    triggerActivation: "hover",
    autoReadWord: false,
    enableWhenSameLanguage: true,
    ignoreInputSelections: true,
    pageTranslationEnabled: false,
    pageTranslationMode: "below",
    blockedHosts: [],
  };
}

export function createDefaultContentSettings(uiLanguage = "zh-CN"): ContentSettings {
  const settings = createDefaultSettings(uiLanguage);
  const { systemPrompt: _, ...contentSettings } = settings;
  return { ...contentSettings, services: settings.services.map(({ apiKey: _apiKey, ...service }) => service) };
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
  serviceKeys: unknown,
  defaults = createDefaultSettings(),
): SlidingTransSettings {
  const content = storedSettingsSchema.safeParse(value);
  const parsedKeys = serviceKeysSchema.safeParse(serviceKeys);
  if (!content.success || !parsedKeys.success || !content.data.services.some((service) => service.id === content.data.activeServiceId)) return defaults;
  const services = content.data.services.map((service) => ({ ...service, apiKey: parsedKeys.data[service.id] ?? "" }));
  return { ...content.data, services };
}

export async function loadSettings(): Promise<SlidingTransSettings> {
  const defaults = createDefaultSettings(browser.i18n.getUILanguage());
  const stored = await browser.storage.local.get([SETTINGS_KEY, SERVICE_KEYS_KEY]);
  return parseSettings(stored[SETTINGS_KEY], stored[SERVICE_KEYS_KEY] ?? {}, defaults);
}

export async function loadContentSettings(): Promise<ContentSettings> {
  const defaults = createDefaultContentSettings(browser.i18n.getUILanguage());
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return parseContentSettings(stored[SETTINGS_KEY], defaults);
}

export async function saveSettings(settings: SlidingTransSettings): Promise<void> {
  const parsed = settingsSchema.parse(settings);
  if (!parsed.services.some((service) => service.id === parsed.activeServiceId)) throw new Error("请选择有效的翻译服务");
  const services = parsed.services.map(({ apiKey: _, ...service }) => service);
  const serviceKeys = Object.fromEntries(parsed.services.map((service) => [service.id, service.apiKey]));
  await browser.storage.local.set({
    [SETTINGS_KEY]: { ...parsed, services },
    [SERVICE_KEYS_KEY]: serviceKeys,
  });
}

export async function saveContentSettings(settings: ContentSettings): Promise<void> {
  const parsed = contentSettingsSchema.parse(settings);
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const current = storedSettingsSchema.safeParse(stored[SETTINGS_KEY]);
  await browser.storage.local.set({
    [SETTINGS_KEY]: {
      ...parsed,
      systemPrompt: current.success ? current.data.systemPrompt : SELECTION_SYSTEM_PROMPT,
    },
  });
}

export function getActiveService(settings: SlidingTransSettings): TranslationService {
  const service = settings.services.find((candidate) => candidate.id === settings.activeServiceId);
  if (!service) throw new Error("请选择有效的翻译服务");
  return service;
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
