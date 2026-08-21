import { describe, expect, it, vi } from "vitest";
import { clampModalPosition, getModalPlacement, getTriggerPoint, isRectVisible } from "./position";
import { isLikelySameLanguage } from "./selection";
import type { SelectionSnapshot } from "../shared/types";

const selection: SelectionSnapshot = {
  id: "test",
  text: "hello",
  contextText: "",
  content: [{ type: "text", text: "hello", segmentId: "s0" }],
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

  it("tracks viewport visibility and clamps a dragged modal", () => {
    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 600);
    expect(isRectVisible(selection.rect)).toBe(true);
    expect(isRectVisible({ ...selection.rect, top: 700, bottom: 720 })).toBe(false);
    expect(clampModalPosition(760, 580, 300, 200)).toEqual({ left: 488, top: 388 });
  });
});

describe("same-language guard", () => {
  it("recognizes common matching scripts", () => {
    expect(isLikelySameLanguage("hello world", "en")).toBe(true);
    expect(isLikelySameLanguage("你好世界", "zh-CN")).toBe(true);
    expect(isLikelySameLanguage("hello world", "zh-CN")).toBe(false);
  });
});
