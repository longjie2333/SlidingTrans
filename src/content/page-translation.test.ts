import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationResult } from "../shared/types";
import { PageTranslationManager, isPageTextCandidate, isVisibleRect, preserveBoundaryWhitespace } from "./page-translation";

const originalRect = Range.prototype.getBoundingClientRect;
const rects = new Map<string, DOMRect>();

function result(translation: string): TranslationResult {
  return { kind: "text", sourceLanguage: "en", translation };
}

afterEach(() => {
  Range.prototype.getBoundingClientRect = originalRect;
  rects.clear();
  document.body.innerHTML = "";
});

describe("page translation", () => {
  it("recognizes visible text and preserves boundary whitespace", () => {
    expect(isVisibleRect(new DOMRect(10, 10, 80, 20))).toBe(true);
    expect(isVisibleRect(new DOMRect(10, 900, 80, 20))).toBe(false);
    expect(preserveBoundaryWhitespace("  Hello  ", "你好")).toBe("  你好  ");
    const text = document.createTextNode("Hello");
    document.body.append(text);
    expect(isPageTextCandidate(text)).toBe(true);
    expect(isPageTextCandidate(document.createTextNode(" "))).toBe(false);
  });

  it("translates only visible nodes and continues after a new node enters the viewport", async () => {
    document.body.innerHTML = '<p id="first">First paragraph</p><p id="second">Second paragraph</p>';
    rects.set("first", new DOMRect(10, 10, 200, 20));
    rects.set("second", new DOMRect(10, 1000, 200, 20));
    Range.prototype.getBoundingClientRect = function () {
      const parent = this.startContainer.parentElement;
      return rects.get(parent?.id ?? "") ?? new DOMRect();
    };
    const translate = vi.fn(async (text: string) => result(`译文：${text}`));
    const manager = new PageTranslationManager({ mode: "below", translate });
    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#first .st-page-translation")?.textContent).toBe("译文：First paragraph");
    expect(document.querySelector("#second .st-page-translation")).toBeNull();

    rects.set("second", new DOMRect(10, 20, 200, 20));
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(translate).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#second .st-page-translation")?.textContent).toBe("译文：Second paragraph");
    manager.dispose();
  });

  it("replaces visible text and restores the source on dispose", async () => {
    document.body.innerHTML = '<p id="source">  Hello world  </p>';
    rects.set("source", new DOMRect(10, 10, 200, 20));
    Range.prototype.getBoundingClientRect = function () {
      return rects.get(this.startContainer.parentElement?.id ?? "") ?? new DOMRect();
    };
    const manager = new PageTranslationManager({ mode: "replace", translate: async () => result("你好世界") });
    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector("#source")?.textContent).toBe("  你好世界  ");
    manager.dispose();
    expect(document.querySelector("#source")?.textContent).toBe("  Hello world  ");
  });
});
