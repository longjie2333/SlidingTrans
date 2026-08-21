import { describe, expect, it } from "vitest";
import { readSelection, refreshSelectionSnapshot } from "./selection";

describe("selection extraction", () => {
  it("reads a bounded selection from a text input", () => {
    const input = document.createElement("input");
    input.value = "hello selected word in context";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(6, 14);

    const selection = readSelection(document);

    expect(selection?.source).toBe("input");
    expect(selection?.text).toBe("selected");
    expect(selection?.contextText).toContain("hello selected word in context");
    input.remove();
  });

  it("ignores password input selections", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "secret";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    expect(readSelection(document)).toBeNull();
    input.remove();
  });

  it("keeps nearby context aligned when an adjacent element is empty", () => {
    document.body.innerHTML = '<div></div><p id="selected">Hello selected text</p><p>After context</p>';
    const textNode = document.querySelector("#selected")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 14);
    Object.defineProperty(range, "getClientRects", {
      value: () => [new DOMRect(10, 10, 80, 20)],
    });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelection(document)?.contextText).toBe("Hello selected text\nAfter context");
    selection.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("marks a contenteditable selection as editable", () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">editable text</div>';
    const textNode = document.querySelector("#editor")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    Object.defineProperty(range, "getClientRects", { value: () => [new DOMRect(10, 10, 80, 20)] });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelection(document)?.source).toBe("editable");
    selection.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("refreshes selection geometry without changing its identity", () => {
    document.body.innerHTML = '<p id="selected">moving text</p>';
    const textNode = document.querySelector("#selected")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    Object.defineProperty(range, "getClientRects", { value: () => [new DOMRect(30, 40, 90, 20)] });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const snapshot = { ...readSelection(document)!, id: "stable" };

    expect(refreshSelectionSnapshot(snapshot)?.id).toBe("stable");
    expect(refreshSelectionSnapshot(snapshot)?.rect.top).toBe(40);
    selection.removeAllRanges();
    document.body.innerHTML = "";
  });
});
