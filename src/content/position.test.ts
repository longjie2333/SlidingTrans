import { describe, expect, it, vi } from "vitest";
import { getModalPlacement, getTriggerPoint } from "./position";
import { isLikelySameLanguage } from "./selection";
import type { SelectionSnapshot } from "../shared/types";

const selection: SelectionSnapshot = {
  id: "test",
  text: "hello",
  contextText: "",
  source: "document",
  frameUrl: "https://example.com",
  rect: { top: 100, right: 300, bottom: 120, left: 240, width: 60, height: 20 },
};

describe("selection positioning", () => {
  it("keeps the trigger point inside the viewport", () => {
    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 600);
    const point = getTriggerPoint(selection, "mini");
    expect(point.left).toBeGreaterThan(0);
    expect(point.top).toBeGreaterThan(0);
    expect(point.left).toBeLessThan(800);
  });

  it("flips the modal above a selection near the bottom edge", () => {
    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 600);
    const placement = getModalPlacement({ ...selection.rect, top: 560, bottom: 580 }, 450, 180);
    expect(placement.placement).toBe("top");
    expect(placement.top).toBeLessThan(560);
  });
});

describe("same-language guard", () => {
  it("recognizes common matching scripts", () => {
    expect(isLikelySameLanguage("hello world", "en")).toBe(true);
    expect(isLikelySameLanguage("你好世界", "zh-CN")).toBe(true);
    expect(isLikelySameLanguage("hello world", "zh-CN")).toBe(false);
  });
});
