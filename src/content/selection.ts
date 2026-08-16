import type { SelectionSnapshot, ViewportRect } from "../shared/types";

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
    rect: rectFromDomRect(active.getBoundingClientRect()),
    source: "input",
    frameUrl: location.href,
  };
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
    rect,
    source: "document",
    frameUrl: location.href,
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
