import { describe, expect, it } from "vitest";
import { parseModelIds } from "./models";

describe("model discovery response", () => {
  it("deduplicates and sorts model ids", () => {
    expect(parseModelIds({ data: [{ id: "gpt-z" }, { id: "gpt-a" }, { id: "gpt-z" }] })).toEqual(["gpt-a", "gpt-z"]);
  });

  it("rejects malformed provider responses", () => {
    expect(() => parseModelIds({ data: [{ name: "missing-id" }] })).toThrow();
  });
});
