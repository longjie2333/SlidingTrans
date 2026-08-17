import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { Copy, LoaderCircle, LockKeyhole, Menu, Mic, Pin, PinOff, RefreshCw, Volume2, X } from "lucide-react";
import { isLikelySameLanguage, SelectionController } from "../src/content/selection";
import { getModalPlacement, getTriggerPoint } from "../src/content/position";
import { isHostBlocked, isHostPausedForSession, loadContentSettings, pauseHostForSession, saveContentSettings } from "../src/shared/settings";
import type { ContentSettings, SelectionSnapshot, TranslationResult, TranslationStreamEvent } from "../src/shared/types";

import "../src/content/content.css";

interface TranslationRecord {
  selection: SelectionSnapshot;
  status: "loading" | "complete" | "error" | "aborted";
  partial?: string;
  result?: TranslationResult;
  error?: string;
}

const logoUrl = `${browser.runtime.getURL("/")}logo-round.png`;

function readResultText(record: TranslationRecord): string {
  if (record.result?.translation) return record.result.translation;
  return record.partial ?? "";
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

function LoadingBody({ partial }: { partial?: string }) {
  return (
    <div className="st-loading-body">
      <LoaderCircle className="st-spin" size={18} />
      <span>{partial || "正在翻译…"}</span>
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
        <button type="button" className="st-secondary-button" onClick={onRetry}>
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    );
  }
  if (record.status === "loading" && !result) return <LoadingBody partial={record.partial} />;
  if (!result) return <LoadingBody partial={record.partial} />;
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
            <button type="button" aria-label="朗读原文" title="朗读原文" onClick={() => speak(source, result.sourceLanguage)}>
              <Volume2 size={15} />
            </button>
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
          <div className="st-sentence-translation">{translation}</div>
          <ResultActions text={translation} language={settings.targetLanguage} />
          {result.contextualAnalysis ? <p className="st-context">{result.contextualAnalysis}</p> : null}
        </>
      )}
      {record.status === "loading" ? <span className="st-streaming">正在生成…</span> : null}
    </div>
  );
}

function ResultActions({ text, language }: { text: string; language: string }) {
  return (
    <div className="st-result-actions">
      <button type="button" aria-label="朗读译文" title="朗读译文" onClick={() => speak(text, language)}>
        <Volume2 size={14} />
      </button>
      <button type="button" aria-label="复制译文" title="复制译文" onClick={() => copyText(text)}>
        <Copy size={14} />
      </button>
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
      <button type="button" aria-label="更多设置" title="更多设置" onClick={() => setOpen((value) => !value)}>
        <Menu size={16} />
      </button>
      {open ? (
        <div className="st-menu" onClick={() => setOpen(false)}>
          <button type="button" onClick={onAutoRead}>
            <Volume2 size={14} /> {settings.autoReadWord ? "关闭自动朗读" : "开启自动朗读"}
          </button>
          <button type="button" onClick={onPauseOnce}><LockKeyhole size={14} /> 本次关闭</button>
          <button type="button" onClick={onBlockSite}><LockKeyhole size={14} /> 当前网站禁用</button>
          <button type="button" onClick={onDisable}><X size={14} /> 永久关闭</button>
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
  return (
    <div
      ref={modalRef}
      className={`st-modal ${pinned ? "st-modal-pinned" : ""}`}
      style={{ left: placement.left + dragOffset.x, top: placement.top + dragOffset.y, width: placement.width }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="st-modal-header" onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}>
        <div className="st-brand"><img className="st-logo" src={logoUrl} alt="" /><span>SlidingTrans</span></div>
        <div className="st-model">{settings.model || "未配置模型"}</div>
        <div className="st-header-actions">
          {records.length > 1 ? (
            <div className="st-history">
              <button type="button" aria-label="上一条" onClick={() => onIndex(Math.max(0, index - 1))}>‹</button>
              <span>{index + 1}/{records.length}</span>
              <button type="button" aria-label="下一条" onClick={() => onIndex(Math.min(records.length - 1, index + 1))}>›</button>
            </div>
          ) : null}
          <button type="button" aria-label={pinned ? "取消固定" : "固定弹窗"} title={pinned ? "取消固定" : "固定弹窗"} onClick={onPin}>
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <MoreMenu settings={settings} onAutoRead={onAutoRead} onPauseOnce={onPauseOnce} onBlockSite={onBlockSite} onDisable={onDisable} />
          <button type="button" aria-label="关闭" title="关闭" onPointerDown={(event) => { event.stopPropagation(); onClose(); }}><X size={16} /></button>
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
  const port = useMemo(() => browser.runtime.connect({ name: "sliding-trans" }), []);
  const controllerRef = useRef<SelectionController | undefined>(undefined);
  const requestIds = useRef(new Set<string>());

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
      if (!selection || !currentSettings || isHostBlocked(location.hostname, currentSettings.blockedHosts)) {
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
  }, [settings?.enabled, settings?.triggerMode]);

  useEffect(() => {
    const onMessage = (event: TranslationStreamEvent) => {
      if (event.type === "connection-ok" || event.type === "models") return;
      if (!requestIds.current.has(event.requestId)) return;
      setRecords((current) => current.map((record) => {
        if (record.selection.id !== event.requestId) return record;
        if (event.type === "partial") return { ...record, partial: event.translation };
        if (event.type === "complete") {
          if (settingsRef.current?.autoReadWord && event.result.kind === "word" && event.result.phonetic) {
            speak(record.selection.text, event.result.sourceLanguage);
          }
          return { ...record, status: "complete", result: event.result, partial: undefined };
        }
        if (event.type === "error") return { ...record, status: "error", error: event.message };
        return { ...record, status: "aborted" };
      }));
      if (event.type === "complete" || event.type === "error" || event.type === "aborted") requestIds.current.delete(event.requestId);
    };
    port.onMessage.addListener(onMessage);
    return () => port.onMessage.removeListener(onMessage);
  }, [port]);

  useEffect(() => () => port.disconnect(), [port]);

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
    const requestId = selection.id;
    requestIds.current.forEach((id) => port.postMessage({ type: "abort", requestId: id }));
    requestIds.current = new Set([requestId]);
    setTriggerSelection(null);
    setRecords((current) => {
      const next = [...current, { selection, status: "loading" as const }].slice(-20);
      setActiveIndex(next.length - 1);
      return next;
    });
    setPinned(false);
    port.postMessage({ type: "translate", requestId, text: selection.text, contextText: selection.contextText, targetLanguage: currentSettings.targetLanguage });
  };

  const close = () => {
    requestIds.current.forEach((id) => port.postMessage({ type: "abort", requestId: id }));
    requestIds.current.clear();
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
    <>
      {triggerSelection ? <Trigger selection={triggerSelection} mode={settings.triggerMode} activation={settings.triggerActivation} onTrigger={() => void startTranslation(triggerSelection)} /> : null}
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
    </>
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
