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
let observedSystemPrompt = "";
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
    response.end(JSON.stringify({ data: [{ id: "gpt-z" }, { id: "gpt-a" }, ...Array.from({ length: 18 }, (_, index) => ({ id: `model-${String(index + 1).padStart(2, "0")}` }))] }));
    return;
  }
  if (request.url?.endsWith("/chat/completions")) {
    calls += 1;
    let requestBody = "";
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(requestBody);
        observedSystemPrompt = parsed.messages?.find((message) => message.role === "system")?.content ?? observedSystemPrompt;
      } catch {
        // The response stream still exercises the request cancellation path.
      }
    });
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
  assert.equal(await options.locator(".service-new-button").evaluate((button) => getComputedStyle(button).color), "rgb(48, 164, 108)");
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  await options.evaluate(async (value) => {
    await chrome.storage.local.set({
      slidingTransSettings: {
        enabled: true,
        targetLanguage: "zh-CN",
        services: [
          { id: "mock", name: "Mock 服务", protocol: "chat-completions", baseUrl: value, model: "mock-model" },
          ...Array.from({ length: 16 }, (_, index) => ({ id: `extra-${index}`, name: `额外服务 ${index + 1}`, protocol: "chat-completions", baseUrl: value, model: "mock-model" })),
        ],
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
  const serviceList = options.locator(".service-list");
  assert.equal(await serviceList.evaluate((element) => getComputedStyle(element).overflowY), "auto");
  assert.equal(await serviceList.evaluate((element) => getComputedStyle(element).scrollbarWidth), "thin");
  assert.equal(await serviceList.evaluate((element) => element.scrollHeight > element.clientHeight), true);
  assert.equal(await serviceList.evaluate((element) => {
    const sidebar = element.parentElement;
    const newButton = sidebar?.querySelector(".service-new-button");
    if (!sidebar || !newButton) return false;
    const gap = Number.parseFloat(getComputedStyle(sidebar).rowGap) || 0;
    return Math.abs(sidebar.clientHeight - element.clientHeight - newButton.getBoundingClientRect().height - gap) < 2;
  }), true);
  assert.equal(await options.locator(".service-list .service-new-button").count(), 0);
  assert.notEqual(await serviceList.locator(".service-item").nth(1).evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.equal(await options.locator(".translation-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 3);
  assert.equal(await options.locator(".service-details .form-grid > label.full").count(), 2);
  assert.equal((await options.locator(".service-item.active .service-item-name").textContent())?.trim(), "Mock 服务");
  await options.getByRole("button", { name: "新建" }).click();
  assert.equal(await options.locator(".service-item").count(), 18);
  const mockServiceItem = options.locator(".service-item").filter({ hasText: "Mock 服务" });
  await mockServiceItem.hover();
  await options.waitForTimeout(250);
  assert.equal(await mockServiceItem.locator(".service-item-actions").evaluate((element) => getComputedStyle(element).opacity), "1");
  assert.equal(await mockServiceItem.getByRole("button", { name: "使用 Mock 服务" }).count(), 0);
  const mockDeleteButton = mockServiceItem.getByRole("button", { name: "删除 Mock 服务" });
  assert.equal(await mockDeleteButton.evaluate((button) => getComputedStyle(button).color), "rgb(220, 38, 38)");
  await mockServiceItem.locator(".service-item-main").click();
  assert.equal((await options.locator(".service-item.active .service-item-name").textContent())?.trim(), "Mock 服务");
  const createdServiceItem = options.locator(".service-item").last();
  const createdServiceName = (await createdServiceItem.locator(".service-item-name").textContent())?.trim();
  await createdServiceItem.hover();
  await createdServiceItem.getByRole("button", { name: `删除 ${createdServiceName}` }).evaluate((button) => button.click());
  assert.equal(await options.locator(".service-item").count(), 17);
  await options.getByRole("button", { name: "获取可用模型" }).click();
  await options.getByText("已获取 20 个模型", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await options.locator("#model-selector").click();
  const modelContent = options.locator('[data-slot="select-content"]');
  assert.equal(await modelContent.locator('[data-slot="select-viewport"]').evaluate((element) => element.scrollHeight > element.clientHeight), true);
  assert.equal(await options.getByRole("option", { name: "gpt-a" }).count(), 1);
  assert.equal(await options.getByRole("option", { name: "gpt-z" }).count(), 1);
  await options.getByRole("option", { name: "gpt-a" }).click();
  assert.equal((await options.locator("#model-selector").textContent())?.trim(), "gpt-a");
  await options.locator("#model-selector").click();
  await options.getByRole("option", { name: "自定义模型" }).click();
  const modelControlsBox = await options.locator(".model-choice-controls").boundingBox();
  const customModelBox = await options.getByPlaceholder("输入自定义模型名称").boundingBox();
  assert.equal(customModelBox.x > modelControlsBox.x, true);
  assert.equal(customModelBox.x - (modelControlsBox.x + modelControlsBox.width) >= 12, true);
  assert.equal(Math.abs(customModelBox.y - modelControlsBox.y) < 8, true);
  await options.getByPlaceholder("输入自定义模型名称").fill("custom-model");
  const apiKeyBox = await options.locator(".key-input").boundingBox();
  const connectionButtonBox = await options.getByRole("button", { name: "测试连接" }).boundingBox();
  const connectionRowBox = await options.locator(".connection-row").boundingBox();
  const serviceDetailsBox = await options.locator(".service-details").boundingBox();
  assert.equal(connectionButtonBox.x > apiKeyBox.x, true);
  assert.equal(Math.abs(connectionButtonBox.y - apiKeyBox.y) < 8, true);
  assert.equal(connectionRowBox.width >= serviceDetailsBox.width - 2, true);
  await options.getByRole("textbox", { name: "系统提示词" }).fill("自定义提示词 {{targetLanguage}}");
  await options.waitForTimeout(500);
  assert.equal(modelCalls, 1);

  const publicSettings = await options.evaluate(async () => (await chrome.storage.local.get("slidingTransSettings")).slidingTransSettings);
  assert.equal(Object.hasOwn(publicSettings, "apiKey"), false);
  assert.equal(Object.hasOwn(publicSettings.services[0], "apiKey"), false);
  assert.equal(publicSettings.activeServiceId, "mock");
  assert.equal(publicSettings.services.find((service) => service.id === "mock").model, "custom-model");
  assert.equal(publicSettings.systemPrompt, "自定义提示词 {{targetLanguage}}");

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
  assert.equal(observedSystemPrompt, "自定义提示词 zh-CN");
  console.log("MV3 smoke test passed: model discovery + selection -> trigger -> SSE translation");
} finally {
  await context.close();
  server.close();
  await fs.rm(profilePath, { recursive: true, force: true });
}
