import React, { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { Copy, LockKeyhole, Menu, Pin, PinOff, RefreshCw, Volume2, X } from "lucide-react";
import { play } from "cuelume";
import { Button } from "../src/ui/button";
import AILoader from "../src/components/smoothui/ai-loader";
import { getTranslationSegments, isLikelySameLanguage, refreshSelectionSnapshot, SelectionController } from "../src/content/selection";
import { clampModalPosition, getModalPlacement, getTriggerPoint, isRectVisible } from "../src/content/position";
import { isHostBlocked, isHostPausedForSession, loadContentSettings, pauseHostForSession, saveContentSettings } from "../src/shared/settings";
import type { ContentSettings, SelectionContentNode, SelectionSnapshot, TranslationResult, TranslationStreamEvent } from "../src/shared/types";

import "../src/content/content.css";

interface TranslationRecord {
  selection: SelectionSnapshot;
  status: "loading" | "complete" | "error" | "aborted";
  result?: TranslationResult;
  error?: string;
}

function sameSelectionRect(left: SelectionSnapshot["rect"], right: SelectionSnapshot["rect"]): boolean {
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left
    && left.width === right.width
    && left.height === right.height;
}

const logoUrl = `${browser.runtime.getURL("/")}logo-round.png`;

function readResultText(record: TranslationRecord): string {
  return record.result?.translation ?? "";
}

function speak(text: string, language: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  window.speechSynthesis.speak(utterance);
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function preserveBoundaryWhitespace(source: string, translation: string): string {
  const leading = source.match(/^\s*/u)?.[0] ?? "";
  const trailing = source.match(/\s*$/u)?.[0] ?? "";
  return `${leading}${translation.trim()}${trailing}`;
}

function StructuredTranslation({
  content,
  result,
}: {
  content: SelectionContentNode[];
  result: TranslationResult;
}) {
  if (result.segmentTranslations === undefined) {
    return <div className="st-structured-translation">{result.translation}</div>;
  }
  const translations = new Map(result.segmentTranslations?.map((segment) => [segment.id, segment.translation]));
  const renderNode = (node: SelectionContentNode, key: string): React.ReactNode => {
    if (node.type === "text") {
      const translation = node.segmentId ? translations.get(node.segmentId) : undefined;
      return <React.Fragment key={key}>{translation === undefined ? node.text : preserveBoundaryWhitespace(node.text, translation)}</React.Fragment>;
    }
    if (node.tag === "br") return <br key={key} />;
    return React.createElement(
      node.tag,
      { key, ...(node.tag === "ol" && node.start !== undefined ? { start: node.start } : {}) },
      node.children.map((child, index) => renderNode(child, `${key}-${index}`)),
    );
  };
  return <div className="st-structured-translation">{content.map((node, index) => renderNode(node, String(index)))}</div>;
}

function Trigger({
  selection,
  mode,
  activation,
  onTrigger,
}: {
  selection: SelectionSnapshot;
  mode: ContentSettings["triggerMode"];
  activation: ContentSettings["triggerActivation"];
  onTrigger: () => void;
}) {
  const point = getTriggerPoint(selection, mode);
  const timer = useRef<number | undefined>(undefined);
  const trigger = () => {
    if (timer.current) window.clearTimeout(timer.current);
    onTrigger();
  };
  const onEnter = () => {
    if (activation === "hover") timer.current = window.setTimeout(trigger, 200);
  };
  const onLeave = () => {
    if (timer.current) window.clearTimeout(timer.current);
  };
  return (
    <button
      className={`st-trigger st-trigger-${mode}`}
      style={{ left: point.left, top: point.top }}
      type="button"
      aria-label="翻译选中文本"
      onClick={trigger}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {mode === "icon" ? <img className="st-logo" src={logoUrl} alt="" /> : null}
    </button>
  );
}

function LoadingBody() {
  return (
    <div className="st-loading-body">
      <AILoader className="st-ai-loader" label="正在翻译" variant="grid" />
    </div>
  );
}

function ResultBody({
  record,
  settings,
  onRetry,
}: {
  record: TranslationRecord;
  settings: ContentSettings;
  onRetry: () => void;
}) {
  const result = record.result;
  if (record.status === "error") {
    return (
      <div className="st-error-body">
        <p>{record.error || "翻译请求失败"}</p>
        <Button type="button" className="st-secondary-button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={14} /> 重试
        </Button>
      </div>
    );
  }
  if (record.status === "loading" && !result) return <LoadingBody />;
  if (!result) return <LoadingBody />;
  const source = record.selection.text;
  const translation = readResultText(record);
  const isWord = result.kind === "word";
  return (
    <div className="st-result-body">
      {isWord ? (
        <>
          <div className="st-word-heading">
            <strong>{source}</strong>
            {result.phonetic ? <span>{result.phonetic}</span> : null}
            <Button variant="ghost" size="icon" type="button" aria-label="朗读原文" title="朗读原文" onClick={() => speak(source, result.sourceLanguage)}>
              <Volume2 size={15} />
            </Button>
          </div>
          <div className="st-definitions">
            {result.definitions?.map((definition, index) => (
              <div className="st-definition" key={`${definition.partOfSpeech}-${index}`}>
                <span className="st-pos">{definition.partOfSpeech}</span>
                <div>
                  <div>{definition.meaning}</div>
                  {definition.example ? (
                    <div className="st-example">
                      <span>{definition.example.source}</span>
                      <span>{definition.example.target}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="st-translation-line">
            <strong>{translation}</strong>
            <ResultActions text={translation} language={settings.targetLanguage} />
          </div>
          {result.contextualAnalysis ? <p className="st-context">{result.contextualAnalysis}</p> : null}
        </>
      ) : (
        <>
          <div className="st-sentence-translation">
            <StructuredTranslation content={record.selection.content} result={result} />
          </div>
          <ResultActions text={translation} language={settings.targetLanguage} />
          {result.contextualAnalysis ? <p className="st-context">{result.contextualAnalysis}</p> : null}
        </>
      )}
    </div>
  );
}

function ResultActions({ text, language }: { text: string; language: string }) {
  return (
    <div className="st-result-actions">
      <Button variant="ghost" size="icon" type="button" aria-label="朗读译文" title="朗读译文" onClick={() => speak(text, language)}>
        <Volume2 size={14} />
      </Button>
      <Button variant="ghost" size="icon" type="button" aria-label="复制译文" title="复制译文" onClick={() => copyText(text)}>
        <Copy size={14} />
      </Button>
    </div>
  );
}

function MoreMenu({
  settings,
  onAutoRead,
  onPauseOnce,
  onBlockSite,
  onDisable,
}: {
  settings: ContentSettings;
  onAutoRead: () => void;
  onPauseOnce: () => void;
  onBlockSite: () => void;
  onDisable: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="st-menu-wrap">
      <Button variant="ghost" size="icon" type="button" aria-label="更多设置" title="更多设置" onClick={() => setOpen((value) => !value)}>
        <Menu size={16} />
      </Button>
      {open ? (
        <div className="st-menu" onClick={() => setOpen(false)}>
          <Button variant="ghost" size="sm" type="button" onClick={onAutoRead}>
            <Volume2 size={14} /> {settings.autoReadWord ? "关闭自动朗读" : "开启自动朗读"}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onPauseOnce}><LockKeyhole size={14} /> 本次关闭</Button>
          <Button variant="ghost" size="sm" type="button" onClick={onBlockSite}><LockKeyhole size={14} /> 当前网站禁用</Button>
          <Button variant="ghost" size="sm" type="button" onClick={onDisable}><X size={14} /> 永久关闭</Button>
        </div>
      ) : null}
    </div>
  );
}

function Modal({
  record,
  records,
  index,
  settings,
  pinned,
  onIndex,
  onClose,
  onPin,
  onRetry,
  onAutoRead,
  onPauseOnce,
  onBlockSite,
  onDisable,
  onDragStart,
}: {
  record: TranslationRecord;
  records: TranslationRecord[];
  index: number;
  settings: ContentSettings;
  pinned: boolean;
  onIndex: (index: number) => void;
  onClose: () => void;
  onPin: () => void;
  onRetry: () => void;
  onAutoRead: () => void;
  onPauseOnce: () => void;
  onBlockSite: () => void;
  onDisable: () => void;
  onDragStart: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const activeService = settings.services.find((service) => service.id === settings.activeServiceId);
  const [placement, setPlacement] = useState(() => getModalPlacement(record.selection.rect));
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);
  useEffect(() => {
    const update = () => {
      const height = modalRef.current?.getBoundingClientRect().height ?? 260;
      setPlacement(getModalPlacement(record.selection.rect, 450, height));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [record.selection.rect, record.result, record.status]);
  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    onDragStart();
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: dragOffset.x, offsetY: dragOffset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setDragOffset({
      x: dragRef.current.offsetX + event.clientX - dragRef.current.x,
      y: dragRef.current.offsetY + event.clientY - dragRef.current.y,
    });
  };
  const onHeaderPointerUp = () => { dragRef.current = undefined; };
  const modalRect = modalRef.current?.getBoundingClientRect();
  const clampedPosition = clampModalPosition(
    placement.left + dragOffset.x,
    placement.top + dragOffset.y,
    placement.width,
    modalRect?.height ?? 260,
  );
  return (
    <div
      ref={modalRef}
      className={`st-modal ${pinned ? "st-modal-pinned" : ""}`}
      style={{ left: clampedPosition.left, top: clampedPosition.top, width: placement.width }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="st-modal-header" onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}>
        <div className="st-brand"><img className="st-logo" src={logoUrl} alt="" /><span>SlidingTrans</span></div>
        <div className="st-model">{activeService?.model || (activeService?.protocol === "deeplx" ? "DeepLX" : "未配置模型")}</div>
        <div className="st-header-actions">
          {records.length > 1 ? (
            <div className="st-history">
              <Button variant="ghost" size="icon" type="button" aria-label="上一条" onClick={() => onIndex(Math.max(0, index - 1))}>‹</Button>
              <span>{index + 1}/{records.length}</span>
              <Button variant="ghost" size="icon" type="button" aria-label="下一条" onClick={() => onIndex(Math.min(records.length - 1, index + 1))}>›</Button>
            </div>
          ) : null}
          <Button variant="ghost" size="icon" type="button" aria-label={pinned ? "取消固定" : "固定弹窗"} title={pinned ? "取消固定" : "固定弹窗"} onClick={onPin}>
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </Button>
          <MoreMenu settings={settings} onAutoRead={onAutoRead} onPauseOnce={onPauseOnce} onBlockSite={onBlockSite} onDisable={onDisable} />
          <Button variant="ghost" size="icon" type="button" aria-label="关闭" title="关闭" onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={16} /></Button>
        </div>
      </div>
      <div className="st-modal-body">
        <ResultBody record={record} settings={settings} onRetry={onRetry} />
      </div>
    </div>
  );
}

function ContentApp() {
  const [settings, setSettings] = useState<ContentSettings | null>(null);
  const settingsRef = useRef<ContentSettings | null>(null);
  const [triggerSelection, setTriggerSelection] = useState<SelectionSnapshot | null>(null);
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const controllerRef = useRef<SelectionController | undefined>(undefined);
  const requestPortRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const triggerSelectionRef = useRef<SelectionSnapshot | null>(null);
  const recordsRef = useRef<TranslationRecord[]>([]);
  const activeIndexRef = useRef(0);
  const pinnedRef = useRef(false);

  triggerSelectionRef.current = triggerSelection;
  recordsRef.current = records;
  activeIndexRef.current = activeIndex;
  pinnedRef.current = pinned;

  const failRequest = (requestId: string, message: string) => {
    if (activeRequestIdRef.current !== requestId) return;
    activeRequestIdRef.current = undefined;
    requestPortRef.current = undefined;
    play("error");
    setRecords((current) => current.map((record) => record.selection.id === requestId
      ? { ...record, status: "error", error: message }
      : record));
  };

  const disconnectRequest = (abort: boolean) => {
    const port = requestPortRef.current;
    const requestId = activeRequestIdRef.current;
    requestPortRef.current = undefined;
    activeRequestIdRef.current = undefined;
    if (!port) return;
    if (abort && requestId) {
      try { port.postMessage({ type: "abort", requestId }); } catch { /* Disconnect below still aborts in the worker. */ }
    }
    try { port.disconnect(); } catch { /* The worker may already be gone. */ }
  };

  const connectTranslation = (selection: SelectionSnapshot, currentSettings: ContentSettings, attempt = 0) => {
    if (activeRequestIdRef.current !== selection.id) return;
    const requestPort = browser.runtime.connect({ name: "sliding-trans" });
    requestPortRef.current = requestPort;
    let receivedEvent = false;

    const cleanup = () => {
      requestPort.onMessage.removeListener(onMessage);
      requestPort.onDisconnect.removeListener(onDisconnect);
    };
    const finish = () => {
      cleanup();
      if (requestPortRef.current === requestPort) requestPortRef.current = undefined;
      if (activeRequestIdRef.current === selection.id) activeRequestIdRef.current = undefined;
      try { requestPort.disconnect(); } catch { /* Already disconnected. */ }
    };
    const onMessage = (event: TranslationStreamEvent) => {
      if (event.type === "connection-ok" || event.type === "models" || event.requestId !== selection.id) return;
      if (activeRequestIdRef.current !== selection.id) return;
      receivedEvent = true;
      setRecords((current) => current.map((record) => {
        if (record.selection.id !== event.requestId) return record;
        if (event.type === "partial") return record;
        if (event.type === "complete") {
          play("success");
          if (settingsRef.current?.autoReadWord && event.result.kind === "word" && event.result.phonetic) {
            speak(record.selection.text, event.result.sourceLanguage);
          }
          return { ...record, status: "complete", result: event.result };
        }
        if (event.type === "error") {
          play("error");
          return { ...record, status: "error", error: event.message };
        }
        return { ...record, status: "aborted" };
      }));
      if (event.type === "complete" || event.type === "error" || event.type === "aborted") finish();
    };
    const onDisconnect = () => {
      cleanup();
      if (requestPortRef.current === requestPort) requestPortRef.current = undefined;
      if (activeRequestIdRef.current !== selection.id) return;
      if (!receivedEvent && attempt === 0) {
        window.setTimeout(() => connectTranslation(selection, currentSettings, 1), 0);
        return;
      }
      failRequest(selection.id, "翻译连接已断开，请重试");
    };
    requestPort.onMessage.addListener(onMessage);
    requestPort.onDisconnect.addListener(onDisconnect);
    try {
      const segments = getTranslationSegments(selection.content);
      requestPort.postMessage({
        type: "translate",
        requestId: selection.id,
        text: segments.map((segment) => segment.text).join("\n"),
        contextText: selection.contextText,
        segments,
        targetLanguage: currentSettings.targetLanguage,
      });
    } catch {
      cleanup();
      if (requestPortRef.current === requestPort) requestPortRef.current = undefined;
      try { requestPort.disconnect(); } catch { /* Already disconnected. */ }
      if (attempt === 0) window.setTimeout(() => connectTranslation(selection, currentSettings, 1), 0);
      else failRequest(selection.id, "无法连接翻译服务，请重试");
    }
  };

  useEffect(() => {
    void loadContentSettings().then((value) => {
      settingsRef.current = value;
      setSettings(value);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!changes.slidingTransSettings) return;
      void loadContentSettings().then((value) => {
        settingsRef.current = value;
        setSettings(value);
      });
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!settings) return;
    controllerRef.current = new SelectionController((selection) => {
      const currentSettings = settingsRef.current;
      if (!selection || !currentSettings?.enabled || isHostBlocked(location.hostname, currentSettings.blockedHosts)) {
        setTriggerSelection(null);
        return;
      }
      if (currentSettings.ignoreInputSelections && selection.source !== "document") {
        setTriggerSelection(null);
        return;
      }
      if (!currentSettings.enableWhenSameLanguage && isLikelySameLanguage(selection.text, currentSettings.targetLanguage)) {
        setTriggerSelection(null);
        return;
      }
      if (currentSettings.triggerMode === "direct") {
        void startTranslation(selection);
      } else {
        setTriggerSelection(selection);
      }
    });
    return () => controllerRef.current?.dispose();
  }, [Boolean(settings)]);

  useEffect(() => {
    const shouldTrack = Boolean(triggerSelection) || records.length > 0;
    if (!shouldTrack) return;
    let frameId = 0;
    const track = () => {
      const trigger = triggerSelectionRef.current;
      const activeRecord = recordsRef.current[activeIndexRef.current];
      const reference = trigger ?? activeRecord?.selection;
      const currentSelection = reference ? refreshSelectionSnapshot(reference) : null;
      const currentSettings = settingsRef.current;
      if (currentSelection && reference && currentSelection.text === reference.text) {
        const nextSelection = { ...currentSelection, id: reference.id };
        if (trigger) {
          const ignored = currentSettings?.ignoreInputSelections && nextSelection.source !== "document";
          if (ignored) setTriggerSelection(null);
          else if (!sameSelectionRect(trigger.rect, nextSelection.rect)) setTriggerSelection(nextSelection);
        } else if (!pinnedRef.current && activeRecord) {
          setRecords((current) => current.map((record, index) => index === activeIndexRef.current
            && !sameSelectionRect(record.selection.rect, nextSelection.rect)
            ? { ...record, selection: nextSelection }
            : record));
        }
      } else if (trigger) {
        setTriggerSelection(null);
      }
      frameId = window.requestAnimationFrame(track);
    };
    frameId = window.requestAnimationFrame(track);
    return () => window.cancelAnimationFrame(frameId);
  }, [Boolean(triggerSelection) || records.length > 0]);

  useEffect(() => () => disconnectRequest(true), []);

  useEffect(() => {
    if (!records.length) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (pinned) return;
      const path = event.composedPath();
      if (!path.some((node) => node instanceof HTMLElement && node.tagName.toLowerCase() === "sliding-trans")) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [records.length, pinned]);

  const startTranslation = async (selection: SelectionSnapshot) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings?.enabled || isHostBlocked(location.hostname, currentSettings.blockedHosts) || await isHostPausedForSession(location.hostname)) return;
    disconnectRequest(true);
    const segments = getTranslationSegments(selection.content);
    const codeOnly = segments.length === 0;
    activeRequestIdRef.current = codeOnly ? undefined : selection.id;
    setTriggerSelection(null);
    setRecords((current) => {
      const next = [...current, codeOnly
        ? {
            selection,
            status: "complete" as const,
            result: {
              kind: "text" as const,
              sourceLanguage: "auto",
              translation: selection.text,
              segmentTranslations: [],
            },
          }
        : { selection, status: "loading" as const }].slice(-20);
      setActiveIndex(next.length - 1);
      return next;
    });
    setPinned(false);
    play(codeOnly ? "success" : "loading");
    if (!codeOnly) connectTranslation(selection, currentSettings);
  };

  const close = () => {
    disconnectRequest(true);
    setTriggerSelection(null);
    setRecords([]);
    setPinned(false);
  };

  const updateSettings = async (patch: Partial<ContentSettings>) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await saveContentSettings(next);
  };

  if (!settings?.enabled || isHostBlocked(location.hostname, settings.blockedHosts)) return null;
  const active = records[activeIndex];
  return (
    <div className="st-ui-root">
      {triggerSelection && isRectVisible(triggerSelection.rect) ? <Trigger selection={triggerSelection} mode={settings.triggerMode} activation={settings.triggerActivation} onTrigger={() => void startTranslation(triggerSelection)} /> : null}
      {active ? (
        <Modal
          record={active}
          records={records}
          index={activeIndex}
          settings={settings}
          pinned={pinned}
          onIndex={setActiveIndex}
          onClose={close}
          onPin={() => setPinned((value) => !value)}
          onRetry={() => void startTranslation(active.selection)}
          onAutoRead={() => void updateSettings({ autoReadWord: !settings.autoReadWord })}
          onPauseOnce={() => { void pauseHostForSession(location.hostname); close(); }}
          onBlockSite={() => { void updateSettings({ blockedHosts: [...settings.blockedHosts, location.hostname] }); close(); }}
          onDisable={() => { void updateSettings({ enabled: false }); close(); }}
          onDragStart={() => setPinned(true)}
        />
      ) : null}
    </div>
  );
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  matchAboutBlank: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "sliding-trans",
      position: "overlay",
      zIndex: 2147483647,
      isolateEvents: ["keydown", "keyup", "keypress"],
      onMount(container) {
        const root: Root = createRoot(container);
        root.render(<ContentApp />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
