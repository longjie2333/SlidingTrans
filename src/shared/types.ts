export const API_PROTOCOLS = ["chat-completions", "responses"] as const;
export const TRIGGER_MODES = ["mini", "icon", "direct"] as const;
export const TRIGGER_ACTIVATIONS = ["hover", "click"] as const;

export type ApiProtocol = (typeof API_PROTOCOLS)[number];
export type TriggerMode = (typeof TRIGGER_MODES)[number];
export type TriggerActivation = (typeof TRIGGER_ACTIVATIONS)[number];

export interface TranslationService {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type PublicTranslationService = Omit<TranslationService, "apiKey">;

export interface SlidingTransSettings {
  enabled: boolean;
  targetLanguage: string;
  systemPrompt: string;
  services: TranslationService[];
  activeServiceId: string;
  triggerMode: TriggerMode;
  triggerActivation: TriggerActivation;
  autoReadWord: boolean;
  enableWhenSameLanguage: boolean;
  ignoreInputSelections: boolean;
  blockedHosts: string[];
}

export type ContentSettings = Omit<SlidingTransSettings, "services" | "systemPrompt"> & { services: PublicTranslationService[] };

export interface ViewportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export type SelectionSource = "document" | "input" | "editable";

export type SelectionContentTag =
  | "div"
  | "p"
  | "ol"
  | "ul"
  | "li"
  | "strong"
  | "em"
  | "code"
  | "pre"
  | "br"
  | "blockquote";

export type SelectionContentNode =
  | { type: "text"; text: string; segmentId?: string }
  | { type: "element"; tag: SelectionContentTag; children: SelectionContentNode[]; start?: number };

export interface TranslationSegment {
  id: string;
  text: string;
}

export interface SelectionSnapshot {
  id: string;
  text: string;
  contextText: string;
  content: SelectionContentNode[];
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
  segmentTranslations?: Array<{
    id: string;
    translation: string;
  }>;
}

export interface TranslationRequest {
  type: "translate";
  requestId: string;
  text: string;
  contextText: string;
  segments: TranslationSegment[];
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
