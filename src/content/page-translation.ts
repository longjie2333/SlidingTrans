import type { PageTranslationMode, TranslationResult } from "../shared/types";

const MIN_TEXT_LENGTH = 2;
const MAX_TEXT_LENGTH = 800;
const SCAN_DEBOUNCE_MS = 120;
const RETRY_DELAY_MS = 5000;

export interface PageTranslationOptions {
  mode: PageTranslationMode;
  translate: (text: string, requestId: string, signal: AbortSignal) => Promise<TranslationResult>;
  shouldTranslate?: (text: string) => boolean;
}

interface PageTranslationRecord {
  id: string;
  node: Text;
  sourceText: string;
  status: "idle" | "queued" | "loading" | "complete" | "error";
  translation?: string;
  renderedText?: string;
  translationElement?: HTMLSpanElement;
  controller?: AbortController;
  retryAt?: number;
  renderedMode?: PageTranslationMode;
}

function hasReadableText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function preserveBoundaryWhitespace(source: string, translation: string): string {
  const leading = source.match(/^\s*/u)?.[0] ?? "";
  const trailing = source.match(/\s*$/u)?.[0] ?? "";
  return `${leading}${translation.trim()}${trailing}`;
}

export function isVisibleRect(rect: DOMRect | DOMRectReadOnly, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight): boolean {
  return rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < viewportHeight
    && rect.left < viewportWidth;
}

export function isPageTextCandidate(node: Node): node is Text {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent?.trim() ?? "";
  if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH || !hasReadableText(text)) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest("script, style, noscript, template, textarea, input, select, option, button, [contenteditable='true'], [contenteditable='']")) return false;
  if (parent.closest("sliding-trans, [data-sliding-trans-page-translation]")) return false;
  if (parent.closest("[aria-hidden='true']")) return false;
  return true;
}

function textNodeRect(node: Text): DOMRect | null {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function createRecordId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class PageTranslationManager {
  private mode: PageTranslationMode;
  private readonly translate: PageTranslationOptions["translate"];
  private readonly shouldTranslate: (text: string) => boolean;
  private readonly records = new WeakMap<Text, PageTranslationRecord>();
  private readonly queue: PageTranslationRecord[] = [];
  private readonly controllers = new Set<AbortController>();
  private observer: MutationObserver | undefined;
  private scanTimer: number | undefined;
  private draining = false;
  private disposed = false;

  constructor(options: PageTranslationOptions) {
    this.mode = options.mode;
    this.translate = options.translate;
    this.shouldTranslate = options.shouldTranslate ?? (() => true);
  }

  start(): void {
    if (this.disposed) return;
    document.addEventListener("scroll", this.scheduleScan, true);
    window.addEventListener("resize", this.scheduleScan);
    this.observer = new MutationObserver(this.scheduleScan);
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    this.scan();
  }

  setMode(mode: PageTranslationMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.recordsForDocument().forEach((record) => {
      if (record.status === "complete" && record.translation) this.render(record);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.scanTimer) window.clearTimeout(this.scanTimer);
    this.observer?.disconnect();
    document.removeEventListener("scroll", this.scheduleScan, true);
    window.removeEventListener("resize", this.scheduleScan);
    this.controllers.forEach((controller) => controller.abort());
    this.recordsForDocument().forEach((record) => this.clearRendered(record));
    this.queue.length = 0;
  }

  private scheduleScan = (): void => {
    if (this.disposed || this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, SCAN_DEBOUNCE_MS);
  };

  private scan(): void {
    if (this.disposed) return;
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      if (isPageTextCandidate(node)) {
        this.inspect(node);
      }
      node = walker.nextNode();
    }
    void this.drain();
  }

  private inspect(node: Text): void {
    const text = node.textContent ?? "";
    let record = this.records.get(node);
    if (record && record.status === "complete" && record.renderedText === node.data) return;
    if (record && record.status === "complete") {
      this.clearRendered(record);
      record.sourceText = text;
      record.status = "idle";
      record.translation = undefined;
      record.renderedText = undefined;
    }
    if (!record) {
      record = { id: createRecordId(), node, sourceText: text, status: "idle" };
      this.records.set(node, record);
    }
    if (record.sourceText !== text && record.status !== "loading" && record.status !== "queued") {
      this.clearRendered(record);
      record.sourceText = text;
      record.translation = undefined;
      record.renderedText = undefined;
      record.status = "idle";
    }
    const rect = textNodeRect(node);
    if (!rect || !isVisibleRect(rect) || !this.shouldTranslate(text)) return;
    if (record.status === "idle" || (record.status === "error" && Date.now() >= (record.retryAt ?? 0))) {
      record.status = "queued";
      this.queue.push(record);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.disposed) {
        const record = this.queue.shift()!;
        if (record.status !== "queued") continue;
        const rect = textNodeRect(record.node);
        if (!rect || !isVisibleRect(rect)) {
          record.status = "idle";
          continue;
        }
        record.status = "loading";
        const controller = new AbortController();
        record.controller = controller;
        this.controllers.add(controller);
        try {
          const result = await this.translate(record.sourceText.trim(), record.id, controller.signal);
          if (this.disposed || controller.signal.aborted) continue;
          record.translation = result.translation;
          record.status = "complete";
          this.render(record);
        } catch (error) {
          if (!controller.signal.aborted && !this.disposed) {
            record.status = "error";
            record.retryAt = Date.now() + RETRY_DELAY_MS;
          }
        } finally {
          this.controllers.delete(controller);
          record.controller = undefined;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private render(record: PageTranslationRecord): void {
    if (!record.translation || !record.node.isConnected) return;
    this.clearRendered(record);
    if (this.mode === "replace") {
      record.node.data = preserveBoundaryWhitespace(record.sourceText, record.translation);
      record.renderedText = record.node.data;
      record.renderedMode = "replace";
      return;
    }
    const element = document.createElement("span");
    element.className = "st-page-translation";
    element.dataset.slidingTransPageTranslation = record.id;
    element.dir = "auto";
    element.textContent = record.translation.trim();
    record.node.parentNode?.insertBefore(element, record.node.nextSibling);
    record.translationElement = element;
    record.renderedText = record.node.data;
    record.renderedMode = "below";
  }

  private clearRendered(record: PageTranslationRecord): void {
    record.translationElement?.remove();
    record.translationElement = undefined;
    if (record.renderedText !== undefined && record.renderedMode === "replace" && record.node.data === record.renderedText) {
      record.node.data = record.sourceText;
    }
    record.renderedText = undefined;
    record.renderedMode = undefined;
  }

  private recordsForDocument(): PageTranslationRecord[] {
    const records: PageTranslationRecord[] = [];
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      if (node instanceof Text) {
        const record = this.records.get(node);
        if (record) records.push(record);
      }
      node = walker.nextNode();
    }
    return records;
  }
}
