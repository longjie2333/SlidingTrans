import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const extensionPath = path.resolve(".output/chrome-mv3");
const newline = String.fromCharCode(10, 10);

async function findChromiumExecutable() {
  const preferred = process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath();
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith("chromium-")).reverse()) {
      const candidates = [
        path.join(root, entry.name, "chrome-win64", "chrome.exe"),
        path.join(root, entry.name, "chrome-linux", "chrome"),
        path.join(root, entry.name, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      ];
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // Try the next installed browser.
        }
      }
    }
  }
  throw new Error("找不到 Playwright Chromium，请先运行 npx playwright install chromium");
}

const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), "sliding-trans-e2e-"));
let calls = 0;
let modelCalls = 0;
let holdNextTranslation = true;
let slowRequestAborted = false;
const server = http.createServer((request, response) => {
  if (request.url === "/page") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<p id="selected" style="margin:80px;font-size:24px">Hello world from SlidingTrans.</p>');
    return;
  }
  if (request.url?.endsWith("/models")) {
    modelCalls += 1;
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(JSON.stringify({ data: [{ id: "gpt-z" }, { id: "gpt-a" }, { id: "gpt-z" }] }));
    return;
  }
  if (request.url?.endsWith("/chat/completions")) {
    calls += 1;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "access-control-allow-origin": "*",
    });
    if (holdNextTranslation) {
      holdNextTranslation = false;
      response.on("close", () => { if (!response.writableEnded) slowRequestAborted = true; });
      return;
    }
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"kind":"text","sourceLanguage":"en","translation":"冒烟测试成功"}' } }] })}${newline}`);
    response.write(`data: [DONE]${newline}`);
    response.end();
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const executablePath = await findChromiumExecutable();
const context = await chromium.launchPersistentContext(profilePath, {
  headless: true,
  executablePath,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForSelector("text=翻译服务");
  assert.equal(await options.locator(".options-brand img").count(), 0);
  assert.equal((await options.locator(".options-brand").textContent())?.trim(), "SlidingTrans");
  assert.equal(await options.locator(".service-picker .secondary-button").evaluate((button) => getComputedStyle(button).color), "rgb(48, 164, 108)");
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  await options.evaluate(async (value) => {
    await chrome.storage.local.set({
      slidingTransSettings: {
        enabled: true,
        targetLanguage: "zh-CN",
        services: [{ id: "mock", name: "Mock 服务", protocol: "chat-completions", baseUrl: value, model: "mock-model" }],
        activeServiceId: "mock",
        triggerMode: "mini",
        triggerActivation: "click",
        autoReadWord: false,
        enableWhenSameLanguage: true,
        blockedHosts: [],
      },
      slidingTransServiceKeys: { mock: "e2e-key" },
    });
  }, baseUrl);

  await options.reload();
  await options.waitForSelector("text=翻译服务");
  assert.equal((await options.locator("#service-selector").textContent())?.trim(), "Mock 服务");
  await options.getByRole("button", { name: "新建" }).click();
  await options.locator("#service-selector").click();
  assert.equal(await options.getByRole("option").count(), 2);
  await options.getByRole("option", { name: "Mock 服务" }).click();
  await options.waitForSelector("text=设置已自动保存");
  await options.getByRole("button", { name: "获取可用模型" }).click();
  await options.waitForSelector("text=已获取 2 个模型");
  const modelOptions = await options.locator("#model-options option").evaluateAll((items) => items.map((item) => item.value));
  assert.deepEqual(modelOptions, ["gpt-a", "gpt-z"]);
  assert.equal(modelCalls, 1);

  const publicSettings = await options.evaluate(async () => (await chrome.storage.local.get("slidingTransSettings")).slidingTransSettings);
  assert.equal(Object.hasOwn(publicSettings, "apiKey"), false);
  assert.equal(Object.hasOwn(publicSettings.services[0], "apiKey"), false);
  assert.equal(publicSettings.activeServiceId, "mock");

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/page`);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const textNode = document.querySelector("#selected").firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForTimeout(500);
  const trigger = page.locator("sliding-trans").first();
  assert.equal(await trigger.count(), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger")).backgroundColor), "rgb(48, 164, 108)");
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, button: 0 })));
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"), undefined, { timeout: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(slowRequestAborted, true);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-sentence-translation")?.textContent === "冒烟测试成功", undefined, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-brand .st-logo").naturalWidth), 512);
  assert.equal(calls, 2);
  console.log("MV3 smoke test passed: model discovery + selection -> trigger -> SSE translation");
} finally {
  await context.close();
  server.close();
  await fs.rm(profilePath, { recursive: true, force: true });
}
