import { describe, expect, it } from "vitest";
import { getTranslationSegments, normalizeLineBreaks, readSelection, refreshSelectionSnapshot } from "./selection";

function contentText(nodes: NonNullable<ReturnType<typeof readSelection>>["content"]): string {
  return nodes.map((node) => {
    if (node.type === "text") return node.text;
    if (node.tag === "br") return "\n";
    return contentText(node.children);
  }).join("");
}

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

  it("captures list and inline formatting while excluding code from translation segments", () => {
    document.body.innerHTML = `
      <ol id="selected-list" start="3">
        <li>First <strong>bold</strong></li>
        <li><code>const value = 1</code> and <em>italic</em><ul><li>Nested option</li></ul></li>
      </ol>`;
    const list = document.querySelector("#selected-list")!;
    const range = document.createRange();
    range.selectNodeContents(list);
    Object.defineProperty(range, "getClientRects", { value: () => [new DOMRect(10, 10, 180, 60)] });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const snapshot = readSelection(document)!;
    expect(snapshot.content[0]).toMatchObject({ type: "element", tag: "ol", start: 3 });
    expect(JSON.stringify(snapshot.content)).toContain('"tag":"strong"');
    expect(JSON.stringify(snapshot.content)).toContain('"tag":"em"');
    expect(JSON.stringify(snapshot.content)).toContain('"tag":"code"');
    expect(JSON.stringify(snapshot.content)).toContain('"tag":"ul"');
    expect(getTranslationSegments(snapshot.content).map((segment) => segment.text)).toEqual([
      "First",
      "bold",
      "and",
      "italic",
      "Nested option",
    ]);

    selection.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("keeps a code-only selection local and creates no translation segments", () => {
    document.body.innerHTML = '<pre><code id="source">const answer = 42;</code></pre>';
    const source = document.querySelector("#source")!;
    const range = document.createRange();
    range.selectNodeContents(source);
    Object.defineProperty(range, "getClientRects", { value: () => [new DOMRect(10, 10, 180, 20)] });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const snapshot = readSelection(document)!;
    expect(getTranslationSegments(snapshot.content)).toEqual([]);
    expect(JSON.stringify(snapshot.content)).toContain('"tag":"code"');

    selection.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("preserves line breaks while collapsing multiple blank lines to one", () => {
    expect(normalizeLineBreaks("First\r\nSecond\n\n\n\nThird")).toBe("First\nSecond\n\nThird");
    document.body.innerHTML = `<div id="lines">First<br>Second<br>
      <br>
      <br><br>Third</div>`;
    const lines = document.querySelector("#lines")!;
    const range = document.createRange();
    range.selectNodeContents(lines);
    Object.defineProperty(range, "getClientRects", { value: () => [new DOMRect(10, 10, 180, 80)] });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const snapshot = readSelection(document)!;
    expect(contentText(snapshot.content)).toBe("First\nSecond\n\nThird");
    expect(getTranslationSegments(snapshot.content).map((segment) => segment.text)).toEqual(["First", "Second", "Third"]);

    selection.removeAllRanges();
    document.body.innerHTML = "";
  });
});
