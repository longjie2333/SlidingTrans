import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { play } from "cuelume";
import { toast } from "sonner";
import { loadSettings, normalizeHost, saveSettings, TARGET_LANGUAGES } from "../../src/shared/settings";
import { API_PROTOCOLS, TRIGGER_ACTIVATIONS, TRIGGER_MODES, type SlidingTransSettings, type TranslationService, type TranslationStreamEvent } from "../../src/shared/types";
import { Button } from "../../src/ui/button";
import { Card } from "../../src/ui/card";
import { Checkbox } from "../../src/ui/checkbox";
import { Input } from "../../src/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../src/ui/select";
import { Toaster } from "../../src/ui/sonner";
import "../../src/ui/tailwind.css";
import "./style.css";

const CUSTOM_MODEL_VALUE = "__custom_model__";

function OptionsApp() {
  const [settings, setSettings] = useState<SlidingTransSettings>();
  const [showKey, setShowKey] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasAutoSaved = useRef(false);

  useEffect(() => {
    void loadSettings().then((value) => {
      setSettings(value);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded || !settings) return;
    const timeoutId = window.setTimeout(() => {
      void saveSettings(settings)
        .then(() => {
          if (hasAutoSaved.current) {
            play("success");
            toast.success("设置已自动保存");
          }
          hasAutoSaved.current = true;
        })
        .catch((error) => {
          play("error");
          toast.error(error instanceof Error ? error.message : "设置无效");
        });
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [loaded, settings]);
  if (!settings) return <main className="options loading">正在读取设置…</main>;
  const activeService = settings.services.find((service) => service.id === settings.activeServiceId) ?? settings.services[0];
  const activeModel = activeService?.model ?? "";
  const modelChoice = customModel || !models.includes(activeModel) ? CUSTOM_MODEL_VALUE : activeModel;
  const update = (patch: Partial<SlidingTransSettings>) => setSettings((current) => current ? { ...current, ...patch } : current);
  const updateActiveService = (patch: Partial<TranslationService>) => {
    if (!activeService) return;
    update({ services: settings.services.map((service) => service.id === activeService.id ? { ...service, ...patch } : service) });
  };
  const selectService = (serviceId: string) => {
    update({ activeServiceId: serviceId });
    setModels([]);
    setCustomModel(false);
  };
  const createService = () => {
    const service: TranslationService = {
      id: crypto.randomUUID(),
      name: `服务 ${settings.services.length + 1}`,
      protocol: "chat-completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "",
    };
    update({ services: [...settings.services, service], activeServiceId: service.id });
    setModels([]);
    setCustomModel(false);
    toast.success("已创建服务配置，请填写后保存");
  };
  const removeService = (serviceId: string) => {
    if (settings.services.length <= 1) return;
    const remaining = settings.services.filter((service) => service.id !== serviceId);
    const nextActiveServiceId = settings.activeServiceId === serviceId ? remaining[0]!.id : settings.activeServiceId;
    update({ services: remaining, activeServiceId: nextActiveServiceId });
    setModels([]);
    setCustomModel(false);
  };
  const testConnection = async () => {
    const testRequestId = crypto.randomUUID();
    setTesting(true);
    play("loading");
    try {
      await saveSettings(settings);
    } catch (error) {
      setTesting(false);
      toast.error(error instanceof Error ? error.message : "设置无效");
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
      if (nextMessage.type === "success") toast.success(nextMessage.text);
      else toast.error(nextMessage.text);
      play(nextMessage.type === "success" ? "success" : "error");
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
    play("loading");
    try {
      await saveSettings(settings);
    } catch (error) {
      setLoadingModels(false);
      toast.error(error instanceof Error ? error.message : "设置无效");
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
      if (nextMessage.type === "success") toast.success(nextMessage.text);
      else toast.error(nextMessage.text);
      play(nextMessage.type === "success" ? "success" : "error");
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
      <Toaster position="top-center" richColors />
      <header className="options-header">
        <div><div className="options-brand">SlidingTrans</div><p>选中文本，即刻获得 AI 翻译、词典释义和发音。</p></div>
      </header>
      <Card className="settings-section service-section">
        <h2>翻译服务</h2>
        <div className="service-layout">
          <aside className="service-sidebar">
            <div className="service-list" role="list" aria-label="翻译服务配置">
              {settings.services.map((service) => (
                <div className={`service-item${service.id === settings.activeServiceId ? " active" : ""}`} key={service.id} role="listitem">
                  <Button className="service-item-main" variant="ghost" size="sm" type="button" onClick={() => selectService(service.id)}>
                    <span className="service-item-name">{service.name}</span>
                    {service.id === settings.activeServiceId ? <span className="service-item-current">当前</span> : null}
                  </Button>
                  <div className="service-item-actions">
                    <Button className="service-item-action" variant="ghost" size="icon" type="button" aria-label={`使用 ${service.name}`} title={`使用 ${service.name}`} onClick={() => selectService(service.id)}><Check size={15} /></Button>
                    <Button className="service-item-action" variant="ghost" size="icon" type="button" aria-label={`删除 ${service.name}`} title={`删除 ${service.name}`} disabled={settings.services.length <= 1} onClick={() => removeService(service.id)}><Trash2 size={15} /></Button>
                  </div>
                </div>
              ))}
            </div>
            <Button className="service-new-button text-brand border-brand bg-background hover:bg-brand-soft" variant="outline" size="sm" type="button" onClick={createService}><Plus size={15} /> 新建</Button>
          </aside>
          <div className="service-details">
            <div className="form-grid">
              <label>服务名称<Input value={activeService?.name ?? ""} placeholder="例如 OpenAI" onChange={(event) => updateActiveService({ name: event.target.value })} /></label>
              <label>协议<Select value={activeService?.protocol ?? API_PROTOCOLS[0]} onValueChange={(value) => updateActiveService({ protocol: value as TranslationService["protocol"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={API_PROTOCOLS[0]}>Chat Completions</SelectItem><SelectItem value={API_PROTOCOLS[1]}>Responses</SelectItem></SelectContent></Select></label>
              <label>模型<div className="model-picker"><div className="model-choice-controls"><Select value={modelChoice} onValueChange={(value) => { setCustomModel(value === CUSTOM_MODEL_VALUE); updateActiveService({ model: value === CUSTOM_MODEL_VALUE ? "" : value }); }}><SelectTrigger id="model-selector" aria-label="选择模型"><SelectValue placeholder="选择模型" /></SelectTrigger><SelectContent>{models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}<SelectItem value={CUSTOM_MODEL_VALUE}>自定义模型</SelectItem></SelectContent></Select><Button className="model-discover-button" variant="outline" size="icon" type="button" aria-label="获取可用模型" title="获取可用模型" disabled={loadingModels} onClick={() => void fetchModels()}><RefreshCw className={loadingModels ? "spin" : undefined} size={16} /></Button></div>{modelChoice === CUSTOM_MODEL_VALUE ? <Input className="custom-model-input" value={activeModel} placeholder="输入自定义模型名称" onChange={(event) => updateActiveService({ model: event.target.value })} /> : null}</div></label>
              <label className="full">API Base URL<Input value={activeService?.baseUrl ?? ""} placeholder="https://api.openai.com/v1" onChange={(event) => updateActiveService({ baseUrl: event.target.value })} /></label>
              <div className="connection-row full"><label className="api-key-field">API Key<div className="key-input"><Input className="key-input-field" type={showKey ? "text" : "password"} value={activeService?.apiKey ?? ""} onChange={(event) => updateActiveService({ apiKey: event.target.value })} /><Button className="key-visibility-button" variant="outline" size="icon" type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div></label><Button className="connection-button secondary-button text-brand border-brand bg-background hover:bg-brand-soft" variant="outline" type="button" disabled={testing} onClick={() => void testConnection()}>{testing ? "测试中…" : "测试连接"}</Button></div>
            </div>
            <p className="hint">API Key 仅保存在此浏览器的本地扩展存储中，不会同步到云端，也不会发送到 SlidingTrans。浏览器本地存储未加密，请勿在共享设备上使用。</p>
          </div>
        </div>
      </Card>
      <Card className="settings-section">
        <h2>划词翻译</h2>
        <div className="form-grid">
          <label>目标语言<Select value={settings.targetLanguage} onValueChange={(value) => update({ targetLanguage: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TARGET_LANGUAGES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
          <label>触发方式<Select value={settings.triggerMode} onValueChange={(value) => update({ triggerMode: value as SlidingTransSettings["triggerMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TRIGGER_MODES.map((mode) => <SelectItem key={mode} value={mode}>{mode === "mini" ? "迷你圆点" : mode === "icon" ? "图标" : "直接触发"}</SelectItem>)}</SelectContent></Select></label>
          {settings.triggerMode !== "direct" ? <label>图标触发<Select value={settings.triggerActivation} onValueChange={(value) => update({ triggerActivation: value as SlidingTransSettings["triggerActivation"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TRIGGER_ACTIVATIONS.map((activation) => <SelectItem key={activation} value={activation}>{activation === "hover" ? "悬浮 200ms" : "点击"}</SelectItem>)}</SelectContent></Select></label> : null}
        </div>
        <div className="check-list">
          <label><Checkbox checked={settings.enabled} onCheckedChange={(checked) => update({ enabled: checked === true })} /> 启用划词翻译</label>
          <label><Checkbox checked={settings.autoReadWord} onCheckedChange={(checked) => update({ autoReadWord: checked === true })} /> 单词结果自动朗读</label>
          <label><Checkbox checked={settings.enableWhenSameLanguage} onCheckedChange={(checked) => update({ enableWhenSameLanguage: checked === true })} /> 原文与目标语言相同时仍允许查询</label>
        </div>
      </Card>
      <Card className="settings-section">
        <h2>禁用网站</h2>
        <p className="hint">匹配域名及其子域名。浏览器内部页面始终不会注入扩展。</p>
        <div className="host-add"><Input value={newHost} placeholder="example.com" onChange={(event) => setNewHost(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addHost(); }} /><Button className="secondary-button text-brand border-brand bg-background hover:bg-brand-soft" variant="outline" type="button" onClick={addHost}><Plus size={15} /> 添加</Button></div>
        <div className="host-list">{settings.blockedHosts.map((host) => <div className="host-row" key={host}><span>{host}</span><Button variant="ghost" size="icon" type="button" aria-label={`移除 ${host}`} onClick={() => update({ blockedHosts: settings.blockedHosts.filter((value) => value !== host) })}><Trash2 size={15} /></Button></div>)}</div>
      </Card>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<OptionsApp />);
