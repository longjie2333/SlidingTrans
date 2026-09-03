import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExternalLink, Languages, Settings2 } from "lucide-react";
import { getActiveService, isHostBlocked, loadSettings, saveSettings, SERVICE_KEYS_KEY, SETTINGS_KEY, TARGET_LANGUAGES } from "../../src/shared/settings";
import type { SlidingTransSettings } from "../../src/shared/types";
import { Button } from "../../src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../src/ui/select";
import "../../src/ui/tailwind.css";
import "./style.css";

async function getCurrentHostname(): Promise<string> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const activeTab = tabs.find((tab) => tab.active && /^https?:\/\//u.test(tab.url ?? ""));
  const fallbackTab = tabs.find((tab) => /^https?:\/\//u.test(tab.url ?? ""));
  const url = activeTab?.url ?? fallbackTab?.url;
  if (!url) return "";
  try { return new URL(url).hostname; } catch { return ""; }
}

function PopupApp() {
  const [settings, setSettings] = useState<SlidingTransSettings>();
  const [hostname, setHostname] = useState("");
  useEffect(() => {
    const syncSettings = () => void loadSettings().then(setSettings);
    syncSettings();
    void getCurrentHostname().then(setHostname);
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (SETTINGS_KEY in changes || SERVICE_KEYS_KEY in changes) void syncSettings();
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);
  if (!settings) return <main className="popup loading">正在读取设置…</main>;
  const activeService = getActiveService(settings);
  const siteBlocked = hostname ? isHostBlocked(hostname, settings.blockedHosts) : false;
  const siteAutoTranslated = Boolean(hostname && settings.pageTranslationEnabled && settings.pageTranslationHosts.some((host) => isHostBlocked(hostname, [host])));
  const needsSetup = activeService.protocol === "deeplx"
    ? !activeService.baseUrl.trim()
    : !activeService.apiKey || !activeService.model;
  const update = async (patch: Partial<SlidingTransSettings>) => {
    const next = { ...(await loadSettings()), ...patch };
    setSettings(next);
    await saveSettings(next);
  };
  const toggleSite = () => {
    if (!hostname) return;
    const blockedHosts = siteBlocked
      ? settings.blockedHosts.filter((host) => !isHostBlocked(hostname, [host]))
      : [...settings.blockedHosts, hostname];
    void update({ blockedHosts });
  };
  const togglePageTranslation = () => {
    if (!hostname || needsSetup) return;
    const pageTranslationHosts = siteAutoTranslated
      ? settings.pageTranslationHosts.filter((host) => !isHostBlocked(hostname, [host]))
      : [...settings.pageTranslationHosts, hostname];
    void update({ pageTranslationEnabled: true, pageTranslationHosts });
  };
  return (
    <main className="popup">
      <header className="popup-header">
        <div className="popup-brand"><img className="popup-logo" src="/logo-round.png" alt="" /><div><strong>SlidingTrans</strong><small>AI 划词翻译</small></div></div>
        <Button className={`toggle ${settings.enabled ? "on" : ""}`} variant="ghost" size="icon" type="button" aria-label="启用或关闭" onClick={() => void update({ enabled: !settings.enabled })}><span /></Button>
      </header>
      <section className="popup-section">
        <label htmlFor="target-language">目标语言</label>
        <Select value={settings.targetLanguage} onValueChange={(value) => void update({ targetLanguage: value })}>
          <SelectTrigger id="target-language"><SelectValue /></SelectTrigger>
          <SelectContent>{TARGET_LANGUAGES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </section>
      <section className="popup-section popup-site-section">
        <div><strong>{hostname || "当前页面"}</strong><small>{hostname ? (siteBlocked ? "当前网站已禁用" : "当前网站已启用") : "浏览器内部页面不支持注入"}</small></div>
        {hostname ? <Button className={`site-toggle ${siteBlocked ? "blocked" : ""}`} variant="outline" size="sm" type="button" onClick={toggleSite}>{siteBlocked ? "启用" : "禁用"}</Button> : null}
      </section>
      {hostname ? (
        <section className="popup-page-translation">
          <div className="popup-page-translation-copy"><Languages size={17} /><div><strong>{siteAutoTranslated ? "当前网站已自动翻译" : "翻译当前网站"}</strong><small>{siteAutoTranslated ? "刷新页面后仍会自动翻译" : "点击后记住此网站"}</small></div></div>
          <Button className="page-translation-toggle" variant={siteAutoTranslated ? "outline" : "default"} size="sm" type="button" disabled={needsSetup || siteBlocked} onClick={togglePageTranslation}>{siteAutoTranslated ? "显示原文" : "翻译此页"}</Button>
        </section>
      ) : null}
      {needsSetup ? <div className="setup-notice">请先在设置页完成服务配置。</div> : null}
      <footer className="popup-footer">
        <Button variant="ghost" size="sm" type="button" onClick={() => void browser.runtime.openOptionsPage()}><Settings2 size={15} /> 设置</Button>
        <a href="https://github.com/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> SlidingTrans</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<PopupApp />);
