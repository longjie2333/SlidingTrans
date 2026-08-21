import { z } from "zod";
import type { TranslationDefinition, TranslationResult } from "./types";

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
});

export const SELECTION_SYSTEM_PROMPT = `You are a professional multilingual translation engine.
Translate selected text from its detected source language into {{targetLanguage}}.
Return only valid JSON, never Markdown or commentary.
For a single word, return kind "word", a sourceLanguage, phonetic notation in the source language, a concise translation, definitions grouped by part of speech, natural example sentences, and contextualAnalysis.
For a single word, partOfSpeech must use the standard abbreviation of {{targetLanguage}}. For English use forms such as n., v., adj., adv., prep., pron., conj., and interj.; never spell out the English part of speech.
For a phrase or sentence, return kind "text", sourceLanguage, and translation only.
All explanations, definitions, examples, contextualAnalysis, and translation must be in {{targetLanguage}}.
Use this exact shape:
{"kind":"word|text","sourceLanguage":"en","translation":"...","phonetic":"...","definitions":[{"partOfSpeech":"noun","meaning":"...","example":{"source":"...","target":"..."}}],"contextualAnalysis":"..."}`;

export function buildPrompts(text: string, contextText: string, targetLanguage: string, systemPrompt = SELECTION_SYSTEM_PROMPT) {
  return {
    system: systemPrompt.replaceAll("{{targetLanguage}}", targetLanguage),
    user: `[Selected text]\n${text}\n\n[Nearby context]\n${contextText || "(none)"}`,
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

export function parseTranslationResult(value: string): TranslationResult {
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
  return {
    kind,
    sourceLanguage: parsed.sourceLanguage ?? parsed.source_language ?? "auto",
    translation,
    ...(parsed.phonetic ? { phonetic: parsed.phonetic } : {}),
    ...(definitions?.length ? { definitions } : {}),
    ...(parsed.contextualAnalysis || parsed.contextual_analysis
      ? { contextualAnalysis: parsed.contextualAnalysis ?? parsed.contextual_analysis }
      : {}),
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
