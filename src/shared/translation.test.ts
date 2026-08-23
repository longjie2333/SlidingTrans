import { describe, expect, it } from "vitest";
import { buildPrompts, extractPartialTranslation, normalizePartOfSpeech, parseTranslationResult, SELECTION_SYSTEM_PROMPT } from "./translation";

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
    const prompt = buildPrompts("Hello", "A nearby sentence", "简体中文", undefined, [{ id: "s0", text: "Hello" }]).user;
    expect(prompt).toContain("A nearby sentence");
    expect(prompt).toContain('"id":"s0"');
  });

  it("uses a custom system prompt and replaces the target language token", () => {
    expect(buildPrompts("Hello", "", "日语", "自定义 {{targetLanguage}}").system).toBe("自定义 日语");
  });

  it("requires code segments to be translated instead of preserved", () => {
    expect(SELECTION_SYSTEM_PROMPT).toContain("This includes code blocks, code lines, and inline code");
    expect(SELECTION_SYSTEM_PROMPT).not.toContain("Code is excluded");
  });

  it("normalizes English parts of speech to standard abbreviations", () => {
    const result = parseTranslationResult('{"kind":"word","sourceLanguage":"zh","translation":"quickly","definitions":[{"partOfSpeech":"adverb","meaning":"at speed"}]}');
    expect(normalizePartOfSpeech(result, "en").definitions?.[0]?.partOfSpeech).toBe("adv.");
  });

  it("validates and orders every structured translation segment", () => {
    const segments = [{ id: "s0", text: "First" }, { id: "s1", text: "Second" }];
    const result = parseTranslationResult(
      '{"kind":"text","sourceLanguage":"en","translation":"第一 第二","segmentTranslations":[{"id":"s1","translation":"第二"},{"id":"s0","translation":"第一"}]}',
      segments,
    );
    expect(result.segmentTranslations).toEqual([
      { id: "s0", translation: "第一" },
      { id: "s1", translation: "第二" },
    ]);
  });

  it("rejects incomplete structured translation segments", () => {
    expect(() => parseTranslationResult(
      '{"kind":"text","sourceLanguage":"en","translation":"第一","segmentTranslations":[{"id":"s0","translation":"第一"}]}',
      [{ id: "s0", text: "First" }, { id: "s1", text: "Second" }],
    )).toThrow("模型没有完整返回结构化译文");
  });
});
