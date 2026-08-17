import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Eye, EyeOff, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { loadSettings, normalizeHost, saveSettings, TARGET_LANGUAGES } from "../../src/shared/settings";
import { API_PROTOCOLS, TRIGGER_ACTIVATIONS, TRIGGER_MODES, type SlidingTransSettings, type TranslationStreamEvent } from "../../src/shared/types";
import "./style.css";

function OptionsApp() {
  const [settings, setSettings] = useState<SlidingTransSettings>();
  const [showKey, setShowKey] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { void loadSettings().then(setSettings); }, []);
  if (!settings) return <main className="options loading">正在读取设置…</main>;
  const update = (patch: Partial<SlidingTransSettings>) => setSettings((current) => current ? { ...current, ...patch } : current);
  const save = async () => {
    try {
      await saveSettings(settings);
      setMessage({ type: "success", text: "设置已保存" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "设置无效" });
    }
  };
  const testConnection = async () => {
    const testRequestId = crypto.randomUUID();
    setTesting(true);
    setMessage(undefined);
    try {
      await saveSettings(settings);
    } catch (error) {
      setTesting(false);
      setMessage({ type: "error", text: error instanceof Error ? error.message : "设置无效" });
      return;
    }
    const port = browser.runtime.connect({ name: "sliding-trans" });
    let settled = false;
    let timeoutId: number | undefined;
    const finish = (nextMessage: { type: "success" | "error"; text: string }) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      port.onMessage.removeListener(listener);
      port.disconnect();
      setTesting(false);
      setMessage(nextMessage);
    };
    const listener = (event: TranslationStreamEvent) => {
      if (event.requestId !== testRequestId) return;
      finish(event.type === "connection-ok"
        ? { type: "success", text: `连接成功：${event.model}` }
        : { type: "error", text: event.type === "error" ? event.message : "连接失败" });
    };
    port.onMessage.addListener(listener);
    port.postMessage({ type: "test-connection", requestId: testRequestId });
    timeoutId = window.setTimeout(() => finish({ type: "error", text: "连接超时" }), 30000);
  };
  const fetchModels = async () => {
    const requestId = crypto.randomUUID();
    setLoadingModels(true);
    setMessage(undefined);
    try {
      await saveSettings(settings);
    } catch (error) {
      setLoadingModels(false);
      setMessage({ type: "error", text: error instanceof Error ? error.message : "设置无效" });
      return;
    }
    const port = browser.runtime.connect({ name: "sliding-trans" });
    let settled = false;
    let timeoutId: number | undefined;
    const finish = (nextMessage: { type: "success" | "error"; text: string }, nextModels?: string[]) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      port.onMessage.removeListener(listener);
      port.disconnect();
      setLoadingModels(false);
      if (nextModels) setModels(nextModels);
      setMessage(nextMessage);
    };
    const listener = (event: TranslationStreamEvent) => {
      if (event.requestId !== requestId) return;
      if (event.type === "models") {
        finish({ type: "success", text: `已获取 ${event.models.length} 个模型` }, event.models);
      } else if (event.type === "error") {
        finish({ type: "error", text: event.message });
      }
    };
    port.onMessage.addListener(listener);
    port.postMessage({ type: "list-models", requestId });
    timeoutId = window.setTimeout(() => finish({ type: "error", text: "获取模型列表超时" }), 30000);
  };
  const addHost = () => {
    const host = normalizeHost(newHost);
    if (!host || settings.blockedHosts.includes(host)) return;
    update({ blockedHosts: [...settings.blockedHosts, host] });
    setNewHost("");
  };
  return (
    <main className="options">
      <header className="options-header">
        <div><div className="options-brand"><img src="/logo-round.png" alt="" /> SlidingTrans</div><p>选中文本，即刻获得 AI 翻译、词典释义和发音。</p></div>
        <button className="primary-button" type="button" onClick={() => void save()}><Save size={16} /> 保存设置</button>
      </header>
      {message ? <div className={`status ${message.type}`}><Check size={15} /> {message.text}</div> : null}
      <section className="settings-section">
        <h2>翻译服务</h2>
        <div className="form-grid">
          <label>协议<select value={settings.protocol} onChange={(event) => update({ protocol: event.target.value as SlidingTransSettings["protocol"] })}><option value={API_PROTOCOLS[0]}>Chat Completions</option><option value={API_PROTOCOLS[1]}>Responses</option></select></label>
          <label>模型<div className="model-picker"><input list="model-options" value={settings.model} placeholder="例如 gpt-5-mini" onChange={(event) => update({ model: event.target.value })} /><button className="icon-button" type="button" aria-label="获取可用模型" title="获取可用模型" disabled={loadingModels} onClick={() => void fetchModels()}><RefreshCw className={loadingModels ? "spin" : undefined} size={16} /></button></div></label>
          {models.length ? <datalist id="model-options">{models.map((model) => <option key={model} value={model} />)}</datalist> : null}
          <label className="full">API Base URL<input value={settings.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => update({ baseUrl: event.target.value })} /></label>
          <label className="full">API Key<div className="key-input"><input type={showKey ? "text" : "password"} value={settings.apiKey} onChange={(event) => update({ apiKey: event.target.value })} /><button type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        </div>
        <p className="hint">API Key 仅保存在此浏览器的本地扩展存储中，不会同步到云端，也不会发送到 SlidingTrans。浏览器本地存储未加密，请勿在共享设备上使用。</p>
        <button className="secondary-button" type="button" disabled={testing} onClick={() => void testConnection()}>{testing ? "测试中…" : "测试连接"}</button>
      </section>
      <section className="settings-section">
        <h2>划词翻译</h2>
        <div className="form-grid">
          <label>目标语言<select value={settings.targetLanguage} onChange={(event) => update({ targetLanguage: event.target.value })}>{TARGET_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>触发方式<select value={settings.triggerMode} onChange={(event) => update({ triggerMode: event.target.value as SlidingTransSettings["triggerMode"] })}>{TRIGGER_MODES.map((mode) => <option key={mode} value={mode}>{mode === "mini" ? "迷你圆点" : mode === "icon" ? "图标" : "直接触发"}</option>)}</select></label>
          {settings.triggerMode !== "direct" ? <label>图标触发<select value={settings.triggerActivation} onChange={(event) => update({ triggerActivation: event.target.value as SlidingTransSettings["triggerActivation"] })}>{TRIGGER_ACTIVATIONS.map((activation) => <option key={activation} value={activation}>{activation === "hover" ? "悬浮 200ms" : "点击"}</option>)}</select></label> : null}
        </div>
        <div className="check-list">
          <label><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} /> 启用划词翻译</label>
          <label><input type="checkbox" checked={settings.autoReadWord} onChange={(event) => update({ autoReadWord: event.target.checked })} /> 单词结果自动朗读</label>
          <label><input type="checkbox" checked={settings.enableWhenSameLanguage} onChange={(event) => update({ enableWhenSameLanguage: event.target.checked })} /> 原文与目标语言相同时仍允许查询</label>
        </div>
      </section>
      <section className="settings-section">
        <h2>禁用网站</h2>
        <p className="hint">匹配域名及其子域名。浏览器内部页面始终不会注入扩展。</p>
        <div className="host-add"><input value={newHost} placeholder="example.com" onChange={(event) => setNewHost(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addHost(); }} /><button className="secondary-button" type="button" onClick={addHost}><Plus size={15} /> 添加</button></div>
        <div className="host-list">{settings.blockedHosts.map((host) => <div className="host-row" key={host}><span>{host}</span><button type="button" aria-label={`移除 ${host}`} onClick={() => update({ blockedHosts: settings.blockedHosts.filter((value) => value !== host) })}><Trash2 size={15} /></button></div>)}</div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<OptionsApp />);
