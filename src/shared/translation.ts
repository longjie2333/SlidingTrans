import { z } from "zod";
import type { TranslationDefinition, TranslationResult, TranslationSegment } from "./types";

const rawDefinitionSchema = z.object({
  partOfSpeech: z.string().optional(),
  pos: z.string().optional(),
  meaning: z.string().optional(),
  example: z
    .object({
      source: z.string().optional(),
      target: z.string().optional(),
    })
    .optional(),
});

const rawResultSchema = z.object({
  kind: z.enum(["word", "text"]).optional(),
  type: z.enum(["word", "text"]).optional(),
  sourceLanguage: z.string().optional(),
  source_language: z.string().optional(),
  translation: z.string().optional(),
  phonetic: z.string().optional(),
  definitions: z.array(rawDefinitionSchema).optional(),
  contextualAnalysis: z.string().optional(),
  contextual_analysis: z.string().optional(),
  segmentTranslations: z.array(z.object({
    id: z.string().trim().min(1),
    translation: z.string().min(1),
  })).optional(),
});

export const SELECTION_SYSTEM_PROMPT = `You are a professional multilingual translation engine.
Translate selected text from its detected source language into {{targetLanguage}}.
Return only valid JSON, never Markdown or commentary.
For a single word, return kind "word", a sourceLanguage, phonetic notation in the source language, a concise translation, definitions grouped by part of speech, natural example sentences, and contextualAnalysis.
For a single word, partOfSpeech must use the standard abbreviation of {{targetLanguage}}. For English use forms such as n., v., adj., adv., prep., pron., conj., and interj.; never spell out the English part of speech.
For a phrase or sentence, return kind "text", sourceLanguage, translation, and segmentTranslations. Translate every supplied segment exactly once, preserve its ID, and never merge or omit segments. This includes code blocks, code lines, and inline code; never return a supplied code segment unchanged.
All explanations, definitions, examples, contextualAnalysis, and translation must be in {{targetLanguage}}.
Use this exact shape:
{"kind":"word|text","sourceLanguage":"en","translation":"...","phonetic":"...","definitions":[{"partOfSpeech":"noun","meaning":"...","example":{"source":"...","target":"..."}}],"contextualAnalysis":"...","segmentTranslations":[{"id":"s0","translation":"..."}]}`;

export function buildPrompts(
  text: string,
  contextText: string,
  targetLanguage: string,
  systemPrompt = SELECTION_SYSTEM_PROMPT,
  segments: TranslationSegment[] = [],
) {
  const segmentInstruction = segments.length
    ? `\n\n[Translatable segments]\n${JSON.stringify(segments)}\nReturn one segmentTranslations item for every supplied ID. Translate only these segments; preserve each ID exactly.`
    : "";
  return {
    system: systemPrompt.replaceAll("{{targetLanguage}}", targetLanguage),
    user: `[Selected translatable text]\n${text}\n\n[Nearby context]\n${contextText || "(none)"}${segmentInstruction}`,
  };
}

export function extractPartialTranslation(buffer: string): string | undefined {
  const match = buffer.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)/i);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replaceAll("\\n", "\n").replaceAll('\\"', '"');
  }
}

function cleanJsonCandidate(value: string): string {
  const trimmed = value.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  return first >= 0 && last > first ? withoutFence.slice(first, last + 1) : withoutFence;
}

export function parseTranslationResult(value: string, expectedSegments: TranslationSegment[] = []): TranslationResult {
  const parsed = rawResultSchema.parse(JSON.parse(cleanJsonCandidate(value)));
  const definitions: TranslationDefinition[] | undefined = parsed.definitions
    ?.map((definition) => {
      const meaning = definition.meaning?.trim() ?? "";
      if (!meaning) return undefined;
      const example = definition.example?.source && definition.example.target
        ? { source: definition.example.source, target: definition.example.target }
        : undefined;
      return {
        partOfSpeech: definition.partOfSpeech ?? definition.pos ?? "",
        meaning,
        ...(example ? { example } : {}),
      };
    })
    .filter((definition): definition is TranslationDefinition => Boolean(definition));
  const translation = parsed.translation?.trim() ?? "";
  if (!translation) throw new Error("模型没有返回有效译文");
  const kind = parsed.kind ?? parsed.type ?? (definitions?.length || parsed.phonetic ? "word" : "text");
  let segmentTranslations: TranslationResult["segmentTranslations"];
  if (kind === "text" && expectedSegments.length) {
    const expectedIds = new Set(expectedSegments.map((segment) => segment.id));
    const supplied = parsed.segmentTranslations ?? [];
    const suppliedIds = new Set(supplied.map((segment) => segment.id));
    if (supplied.length !== suppliedIds.size
      || supplied.length !== expectedIds.size
      || supplied.some((segment) => !expectedIds.has(segment.id))) {
      throw new Error("模型没有完整返回结构化译文");
    }
    const translationsById = new Map(supplied.map((segment) => [segment.id, segment.translation]));
    segmentTranslations = expectedSegments.map((segment) => ({
      id: segment.id,
      translation: translationsById.get(segment.id)!,
    }));
  }
  return {
    kind,
    sourceLanguage: parsed.sourceLanguage ?? parsed.source_language ?? "auto",
    translation,
    ...(parsed.phonetic ? { phonetic: parsed.phonetic } : {}),
    ...(definitions?.length ? { definitions } : {}),
    ...(parsed.contextualAnalysis || parsed.contextual_analysis
      ? { contextualAnalysis: parsed.contextualAnalysis ?? parsed.contextual_analysis }
      : {}),
    ...(segmentTranslations ? { segmentTranslations } : {}),
  };
}

const ENGLISH_PART_OF_SPEECH = new Map([
  ["noun", "n."],
  ["n", "n."],
  ["verb", "v."],
  ["v", "v."],
  ["adjective", "adj."],
  ["adj", "adj."],
  ["adverb", "adv."],
  ["adv", "adv."],
  ["preposition", "prep."],
  ["prep", "prep."],
  ["pronoun", "pron."],
  ["pron", "pron."],
  ["conjunction", "conj."],
  ["conj", "conj."],
  ["interjection", "interj."],
  ["interj", "interj."],
  ["determiner", "det."],
  ["det", "det."],
  ["article", "art."],
  ["art", "art."],
  ["numeral", "num."],
  ["num", "num."],
]);

export function normalizePartOfSpeech(result: TranslationResult, targetLanguage: string): TranslationResult {
  if (!targetLanguage.toLowerCase().startsWith("en") || !result.definitions?.length) return result;
  return {
    ...result,
    definitions: result.definitions.map((definition) => {
      const key = definition.partOfSpeech.trim().toLowerCase().replace(/\.+$/u, "");
      return { ...definition, partOfSpeech: ENGLISH_PART_OF_SPEECH.get(key) ?? definition.partOfSpeech };
    }),
  };
}
