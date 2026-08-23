import type {
  SelectionContentNode,
  SelectionContentTag,
  SelectionSnapshot,
  TranslationSegment,
  ViewportRect,
} from "../shared/types";

const MAX_TEXT_LENGTH = 5000;
const CONTEXT_LIMIT = 200;

function rectFromDomRect(rect: DOMRect | DOMRectReadOnly): ViewportRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function unionRects(rects: DOMRect[]): ViewportRect | null {
  const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (!visible.length) return null;
  const left = Math.min(...visible.map((rect) => rect.left));
  const top = Math.min(...visible.map((rect) => rect.top));
  const right = Math.max(...visible.map((rect) => rect.right));
  const bottom = Math.max(...visible.map((rect) => rect.bottom));
  return { top, right, bottom, left, width: right - left, height: bottom - top };
}

function trimContext(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CONTEXT_LIMIT);
}

function elementText(element: Element | null): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  return clone.textContent ?? "";
}

function getNearbyContext(element: Element, selectedText: string): string {
  const [previous, current, next] = [element.previousElementSibling, element, element.nextElementSibling]
    .map((sibling) => trimContext(elementText(sibling)));
  return [previous, current || trimContext(selectedText), next].filter(Boolean).join("\n").slice(0, CONTEXT_LIMIT * 3);
}

function isExtensionUi(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.tagName.toLowerCase() === "sliding-trans") return true;
    current = current instanceof ShadowRoot ? current.host : current.parentNode;
  }
  return false;
}

function createSelectionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

const ELEMENT_TAGS = new Map<string, SelectionContentTag>([
  ["DIV", "div"],
  ["P", "p"],
  ["OL", "ol"],
  ["UL", "ul"],
  ["LI", "li"],
  ["STRONG", "strong"],
  ["B", "strong"],
  ["EM", "em"],
  ["I", "em"],
  ["CODE", "code"],
  ["PRE", "pre"],
  ["BR", "br"],
  ["BLOCKQUOTE", "blockquote"],
]);

const WRAPPABLE_ANCESTOR_TAGS = new Set<SelectionContentTag>([
  "div",
  "p",
  "ol",
  "ul",
  "li",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
]);

function hasTranslatableText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function normalizeLineBreaks(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/\n(?:[\t ]*\n){2,}/gu, "\n\n");
}

function serializeText(
  value: string,
  state: { nextSegment: number },
): SelectionContentNode[] {
  const text = normalizeLineBreaks(value);
  if (!text) return [];
  return text.split(/(\n[\t ]*)/u).filter(Boolean).map((part) => ({
    type: "text" as const,
    text: part,
    ...(hasTranslatableText(part) ? { segmentId: `s${state.nextSegment++}` } : {}),
  }));
}

function serializeSelectionNode(
  node: Node,
  state: { nextSegment: number },
): SelectionContentNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return serializeText(node.textContent ?? "", state);
  }
  if (!(node instanceof Element || node instanceof DocumentFragment)) return [];
  if (node instanceof Element && ["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName)) return [];
  const tag = node instanceof Element ? ELEMENT_TAGS.get(node.tagName) : undefined;
  const children = Array.from(node.childNodes).flatMap((child) => serializeSelectionNode(child, state));
  if (!tag) return children;
  return [{
    type: "element",
    tag,
    children: normalizeBlockChildren(tag, children),
    ...(tag === "ol" && node instanceof HTMLOListElement && node.start !== 1 ? { start: node.start } : {}),
  }];
}

function contentHasOuterTag(content: SelectionContentNode[], tag: SelectionContentTag): boolean {
  return content.length === 1 && content[0]?.type === "element" && content[0].tag === tag;
}

const BLOCK_TAGS = new Set<SelectionContentTag>(["div", "p", "ol", "ul", "li", "pre", "blockquote"]);

function isBlockNode(node: SelectionContentNode | undefined): boolean {
  return node?.type === "element" && BLOCK_TAGS.has(node.tag);
}

function normalizeBlockChildren(tag: SelectionContentTag | undefined, children: SelectionContentNode[]): SelectionContentNode[] {
  const withoutSourceIndentation = children.filter((node, index) => {
    if (node.type !== "text" || node.text.trim() !== "") return true;
    if (tag === "ol" || tag === "ul") return false;
    return !node.text.includes("\n") || (!isBlockNode(children[index - 1]) && !isBlockNode(children[index + 1]));
  });
  let consecutiveBreaks = 0;
  return withoutSourceIndentation.flatMap((node): SelectionContentNode[] => {
    if (node.type === "element" && node.tag === "br") {
      if (consecutiveBreaks >= 2) return [];
      consecutiveBreaks += 1;
      return [node];
    }
    if (node.type === "text" && !node.segmentId && /\n/u.test(node.text) && node.text.trim() === "") {
      const allowed = Math.min(2 - consecutiveBreaks, node.text.match(/\n/gu)?.length ?? 0);
      if (allowed <= 0) return [];
      consecutiveBreaks += allowed;
      return [{ ...node, text: "\n".repeat(allowed) }];
    }
    consecutiveBreaks = 0;
    return [node];
  });
}

function selectionContent(range: Range): SelectionContentNode[] {
  const state = { nextSegment: 0 };
  let content = serializeSelectionNode(range.cloneContents(), state);
  let ancestor = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const tag = ELEMENT_TAGS.get(ancestor.tagName);
    if (tag && WRAPPABLE_ANCESTOR_TAGS.has(tag) && !contentHasOuterTag(content, tag)) {
      content = [{
        type: "element",
        tag,
        children: normalizeBlockChildren(tag, content),
        ...(tag === "ol" && ancestor instanceof HTMLOListElement && ancestor.start !== 1 ? { start: ancestor.start } : {}),
      }];
    }
    if (tag === "div" || tag === "ol" || tag === "ul" || tag === "p" || tag === "pre" || tag === "blockquote") break;
    ancestor = ancestor.parentElement;
  }
  return normalizeBlockChildren(undefined, content);
}

export function getTranslationSegments(content: SelectionContentNode[]): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const visit = (node: SelectionContentNode) => {
    if (node.type === "text") {
      if (node.segmentId) segments.push({ id: node.segmentId, text: node.text.trim() });
      return;
    }
    node.children.forEach(visit);
  };
  content.forEach(visit);
  return segments;
}

function getSelectionFromRoot(root: Document | ShadowRoot): Selection | null {
  if (root instanceof Document) return root.getSelection();
  const shadowSelection = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
  return shadowSelection ?? document.getSelection();
}

function inputSnapshot(active: HTMLInputElement | HTMLTextAreaElement): SelectionSnapshot | null {
  if (active instanceof HTMLInputElement && active.type === "password") return null;
  const start = active.selectionStart ?? 0;
  const end = active.selectionEnd ?? 0;
  if (start === end) return null;
  const text = active.value.slice(start, end).trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  const valueStart = Math.max(0, start - CONTEXT_LIMIT);
  const valueEnd = Math.min(active.value.length, end + CONTEXT_LIMIT);
  return {
    id: createSelectionId(),
    text,
    contextText: active.value.slice(valueStart, valueEnd).slice(0, CONTEXT_LIMIT * 3),
    content: serializeText(text, { nextSegment: 0 }),
    rect: rectFromDomRect(active.getBoundingClientRect()),
    source: "input",
    frameUrl: location.href,
  };
}

function isEditableElement(element: Element): boolean {
  return element instanceof HTMLElement && (
    element.isContentEditable
    || Boolean(element.closest("[contenteditable]:not([contenteditable='false'])"))
  );
}

export function readSelection(target: Document = document): SelectionSnapshot | null {
  const active = target.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return inputSnapshot(active);
  }
  const selection = getSelectionFromRoot(target);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  const range = selection.getRangeAt(0);
  if (isExtensionUi(range.commonAncestorContainer)) return null;
  const rect = unionRects(Array.from(range.getClientRects()));
  if (!rect) return null;
  const element = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!element || element.closest("input, textarea, select, [contenteditable='false']")) return null;
  return {
    id: createSelectionId(),
    text,
    contextText: getNearbyContext(element, text),
    content: selectionContent(range),
    rect,
    source: isEditableElement(element) || target.designMode === "on" ? "editable" : "document",
    frameUrl: location.href,
  };
}

export function refreshSelectionSnapshot(snapshot: SelectionSnapshot, target: Document = document): SelectionSnapshot | null {
  const active = target.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const current = inputSnapshot(active);
    return current?.text === snapshot.text ? { ...snapshot, rect: current.rect, source: current.source } : null;
  }
  const selection = getSelectionFromRoot(target);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || selection.toString().trim() !== snapshot.text) return null;
  const range = selection.getRangeAt(0);
  if (isExtensionUi(range.commonAncestorContainer)) return null;
  const rect = unionRects(Array.from(range.getClientRects()));
  if (!rect) return null;
  const element = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!element) return null;
  return {
    ...snapshot,
    rect,
    source: isEditableElement(element) || target.designMode === "on" ? "editable" : "document",
  };
}

export function isLikelySameLanguage(text: string, targetLanguage: string): boolean {
  const value = text.trim();
  if (!value || !(value.match(/[\p{L}]/gu) ?? []).length) return false;
  const target = targetLanguage.toLowerCase();
  if (target.startsWith("zh")) return /[\u3400-\u9fff]/u.test(value) && !/[\u3040-\u30ff]/u.test(value) && !/[a-z]/i.test(value);
  if (target.startsWith("ja")) return /[\u3040-\u30ff]/u.test(value);
  if (target.startsWith("ko")) return /[\uac00-\ud7af]/u.test(value);
  if (target.startsWith("ar")) return /[\u0600-\u06ff]/u.test(value);
  if (target.startsWith("ru")) return /[\u0400-\u04ff]/u.test(value);
  if (target.startsWith("en")) return /^[\u0000-\u024f\s\d\p{P}\p{S}]+$/u.test(value) && /[a-z]/i.test(value);
  return false;
}

export class SelectionController {
  private timer: number | undefined;
  private disposed = false;
  private ignoreUntil = 0;
  private readonly onSelectionReady: (selection: SelectionSnapshot | null) => void;

  constructor(onSelectionReady: (selection: SelectionSnapshot | null) => void) {
    this.onSelectionReady = onSelectionReady;
    document.addEventListener("selectionchange", this.handleSelectionChange, true);
    document.addEventListener("select", this.handleSelectionChange, true);
    document.addEventListener("mouseup", this.handlePointerUp, true);
    document.addEventListener("keyup", this.handleKeyUp, true);
    document.addEventListener("mousedown", this.handlePointerDown, true);
  }

  ignoreFor(ms = 400): void {
    this.ignoreUntil = Date.now() + ms;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) window.clearTimeout(this.timer);
    document.removeEventListener("selectionchange", this.handleSelectionChange, true);
    document.removeEventListener("select", this.handleSelectionChange, true);
    document.removeEventListener("mouseup", this.handlePointerUp, true);
    document.removeEventListener("keyup", this.handleKeyUp, true);
    document.removeEventListener("mousedown", this.handlePointerDown, true);
  }

  private schedule = (): void => {
    if (this.disposed || Date.now() < this.ignoreUntil) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.onSelectionReady(readSelection());
    }, 300);
  };

  private handleSelectionChange = (): void => this.schedule();
  private handlePointerUp = (event: MouseEvent): void => {
    if (event.button === 0) this.schedule();
  };
  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.shiftKey || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      this.schedule();
    }
  };
  private handlePointerDown = (event: MouseEvent): void => {
    if ((event.target as HTMLElement | null)?.closest("sliding-trans")) this.ignoreFor();
  };
}
