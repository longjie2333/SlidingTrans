export const API_PROTOCOLS = ["chat-completions", "responses"] as const;
export const TRIGGER_MODES = ["mini", "icon", "direct"] as const;
export const TRIGGER_ACTIVATIONS = ["hover", "click"] as const;

export type ApiProtocol = (typeof API_PROTOCOLS)[number];
export type TriggerMode = (typeof TRIGGER_MODES)[number];
export type TriggerActivation = (typeof TRIGGER_ACTIVATIONS)[number];

export interface SlidingTransSettings {
  enabled: boolean;
  targetLanguage: string;
  protocol: ApiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  triggerMode: TriggerMode;
  triggerActivation: TriggerActivation;
  autoReadWord: boolean;
  enableWhenSameLanguage: boolean;
  blockedHosts: string[];
}

export type ContentSettings = Omit<SlidingTransSettings, "apiKey">;

export interface ViewportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export type SelectionSource = "document" | "input";

export interface SelectionSnapshot {
  id: string;
  text: string;
  contextText: string;
  rect: ViewportRect;
  source: SelectionSource;
  frameUrl: string;
}

export interface TranslationDefinition {
  partOfSpeech: string;
  meaning: string;
  example?: {
    source: string;
    target: string;
  };
}

export interface TranslationResult {
  kind: "word" | "text";
  sourceLanguage: string;
  translation: string;
  phonetic?: string;
  definitions?: TranslationDefinition[];
  contextualAnalysis?: string;
}

export interface TranslationRequest {
  type: "translate";
  requestId: string;
  text: string;
  contextText: string;
  targetLanguage: string;
}

export interface AbortTranslationRequest {
  type: "abort";
  requestId: string;
}

export interface TestConnectionRequest {
  type: "test-connection";
  requestId: string;
}

export interface ListModelsRequest {
  type: "list-models";
  requestId: string;
}

export type BackgroundRequest =
  | TranslationRequest
  | AbortTranslationRequest
  | TestConnectionRequest
  | ListModelsRequest;

export type TranslationStreamEvent =
  | { type: "partial"; requestId: string; translation: string }
  | { type: "complete"; requestId: string; result: TranslationResult }
  | { type: "error"; requestId: string; message: string; code?: string }
  | { type: "aborted"; requestId: string }
  | { type: "connection-ok"; requestId: string; model: string }
  | { type: "models"; requestId: string; models: string[] };
