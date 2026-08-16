import { describe, expect, it } from "vitest";
import { buildPrompts, extractPartialTranslation, parseTranslationResult } from "./translation";

describe("selection translation response", () => {
  it("parses a dictionary result", () => {
    const result = parseTranslationResult(`
      {"kind":"word","sourceLanguage":"en","translation":"你好","phonetic":"/həˈloʊ/","definitions":[{"partOfSpeech":"interjection","meaning":"问候","example":{"source":"Hello there","target":"你好"}}],"contextualAnalysis":"用于问候。"}
    `);
    expect(result.kind).toBe("word");
    expect(result.definitions?.[0]?.partOfSpeech).toBe("interjection");
    expect(result.contextualAnalysis).toBe("用于问候。");
  });

  it("accepts fenced JSON and legacy field names", () => {
    const result = parseTranslationResult("```json\n{\"type\":\"text\",\"source_language\":\"en\",\"translation\":\"你好\"}\n```");
    expect(result).toEqual({ kind: "text", sourceLanguage: "en", translation: "你好" });
  });

  it("extracts a streaming translation without waiting for the closing JSON", () => {
    expect(extractPartialTranslation('{"kind":"text","translation":"Hello')).toBe("Hello");
    expect(buildPrompts("Hello", "A nearby sentence", "简体中文").user).toContain("A nearby sentence");
  });
});
