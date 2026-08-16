import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExternalLink, Settings2 } from "lucide-react";
import { isHostBlocked, loadSettings, saveSettings, TARGET_LANGUAGES } from "../../src/shared/settings";
import type { SlidingTransSettings } from "../../src/shared/types";
import "./style.css";

function PopupApp() {
  const [settings, setSettings] = useState<SlidingTransSettings>();
  const [hostname, setHostname] = useState("");
  useEffect(() => {
    void loadSettings().then(setSettings);
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.url) return;
      try { setHostname(new URL(tab.url).hostname); } catch { setHostname(""); }
    });
  }, []);
  if (!settings) return <main className="popup loading">正在读取设置…</main>;
  const siteBlocked = hostname ? isHostBlocked(hostname, settings.blockedHosts) : false;
  const update = async (patch: Partial<SlidingTransSettings>) => {
    const next = { ...settings, ...patch };
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
  return (
    <main className="popup">
      <header className="popup-header">
        <div className="popup-brand"><span className="popup-logo">S</span><div><strong>SlidingTrans</strong><small>AI 划词翻译</small></div></div>
        <button className={`toggle ${settings.enabled ? "on" : ""}`} type="button" aria-label="启用或关闭" onClick={() => void update({ enabled: !settings.enabled })}><span /></button>
      </header>
      <section className="popup-section">
        <label htmlFor="target-language">目标语言</label>
        <select id="target-language" value={settings.targetLanguage} onChange={(event) => void update({ targetLanguage: event.target.value })}>
          {TARGET_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>
      <section className="popup-section popup-site-section">
        <div><strong>{hostname || "当前页面"}</strong><small>{hostname ? (siteBlocked ? "当前网站已禁用" : "当前网站已启用") : "浏览器内部页面不支持注入"}</small></div>
        {hostname ? <button className={`site-toggle ${siteBlocked ? "blocked" : ""}`} type="button" onClick={toggleSite}>{siteBlocked ? "启用" : "禁用"}</button> : null}
      </section>
      {!settings.apiKey || !settings.model ? <div className="setup-notice">请先在设置页填写 API Key 和模型名称。</div> : null}
      <footer className="popup-footer">
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}><Settings2 size={15} /> 设置</button>
        <a href="https://github.com/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> SlidingTrans</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<PopupApp />);
