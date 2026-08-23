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
let deepLxCalls = 0;
let holdNextTranslation = true;
let slowRequestAborted = false;
let observedSystemPrompt = "";
let observedApiKey = "";
let observedDeepLxToken = "";
let observedDeepLxAuthorization = "";
const server = http.createServer((request, response) => {
  const requestUrl = request.url ? new URL(request.url, "http://localhost") : null;
  if (request.url === "/page") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><style>
      sliding-trans { --primary: #ff0000 !important; --muted-foreground: #ff0000 !important; color: #ff0000 !important; font-family: serif !important; }
      button, ol, ul, li, strong, em, code, pre { color: #ff0000 !important; font: 10px serif !important; list-style: none !important; background: #ffff00 !important; }
    </style></head><body style="margin:0;min-height:2600px">
      <p id="selected" style="margin:80px;font-size:24px">Hello world from SlidingTrans.</p>
      <ol id="formatted" start="4" style="margin:20px 80px">
        <li>First <strong>bold phrase</strong></li>
        <li><code>const preserved = true;</code> then <em>italic phrase</em><ul><li>Nested option</li></ul></li>
      </ol>
      <div id="line-breaks" style="margin:20px 80px">First line<br>Second line<br><br><br><br>Third line</div>
      <pre style="margin:20px 80px"><code id="code-only">const answer = 42;</code></pre>
      <input id="editor-input" value="editable input text" style="margin:20px 80px;width:260px" />
      <div id="editor-rich" contenteditable="true" style="margin:20px 80px">editable rich text</div>
    </body></html>`);
    return;
  }
  if (requestUrl?.pathname.endsWith("/models")) {
    modelCalls += 1;
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(JSON.stringify({ data: [{ id: "gpt-z" }, { id: "gpt-a" }, ...Array.from({ length: 18 }, (_, index) => ({ id: `model-${String(index + 1).padStart(2, "0")}` }))] }));
    return;
  }
  if (requestUrl?.pathname.endsWith("/translate")) {
    deepLxCalls += 1;
    observedDeepLxToken = requestUrl.searchParams.get("token") ?? "";
    observedDeepLxAuthorization = request.headers.authorization ?? "";
    let requestBody = "";
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      let text = "";
      try {
        text = JSON.parse(requestBody).text ?? "";
      } catch {
        // The request still receives a normal DeepLX response.
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify({
        code: 200,
        data: text.toLowerCase() === "hello" ? "你好" : `DeepLX:${text}`,
        source_lang: "EN",
        target_lang: "ZH",
        method: "Free",
      }));
    });
    return;
  }
  if (requestUrl?.pathname.endsWith("/chat/completions")) {
    calls += 1;
    observedApiKey = request.headers.authorization ?? "";
    let requestBody = "";
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      let segments = [];
      try {
        const parsed = JSON.parse(requestBody);
        observedSystemPrompt = parsed.messages?.find((message) => message.role === "system")?.content ?? observedSystemPrompt;
        const userPrompt = parsed.messages?.find((message) => message.role === "user")?.content ?? "";
        const segmentMatch = userPrompt.match(/\[Translatable segments\]\n([^\n]+)/u);
        segments = segmentMatch ? JSON.parse(segmentMatch[1]) : [];
      } catch {
        // The response stream still exercises the request cancellation path.
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "access-control-allow-origin": "*",
      });
      if (holdNextTranslation) {
        holdNextTranslation = false;
        response.on("close", () => { if (!response.writableEnded) slowRequestAborted = true; });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"kind":"text","translation":"不应显示的流式译文' } }] })}${newline}`);
        return;
      }
      const translations = new Map([
        ["First", "第一项"],
        ["bold phrase", "粗体短语"],
        ["const preserved = true;", "常量 preserved = true;"],
        ["then", "然后"],
        ["italic phrase", "斜体短语"],
        ["Nested option", "嵌套选项"],
        ["First line", "第一行"],
        ["Second line", "第二行"],
        ["Third line", "第三行"],
        ["const answer = 42;", "常量答案 = 42；"],
      ]);
      const segmentTranslations = segments.map((segment) => ({
        id: segment.id,
        translation: translations.get(segment.text) ?? "冒烟测试成功",
      }));
      const result = JSON.stringify({
        kind: "text",
        sourceLanguage: "en",
        translation: segments.length > 1 ? "第一项 粗体短语 然后 斜体短语 嵌套选项" : "冒烟测试成功",
        segmentTranslations,
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}${newline}`);
      response.write(`data: [DONE]${newline}`);
      response.end();
    });
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
  const deepLxBaseUrl = `http://127.0.0.1:${port}`;
  await options.evaluate(async (urls) => {
    await chrome.storage.local.set({
      slidingTransSettings: {
        enabled: true,
        targetLanguage: "zh-CN",
        services: [
          { id: "mock", name: "Mock 服务", protocol: "openai-chat-completions", baseUrl: urls.openAi, model: "mock-model" },
          { id: "deeplx", name: "DeepLX 服务", protocol: "deeplx", baseUrl: urls.deepLx, model: "" },
          ...Array.from({ length: 16 }, (_, index) => ({ id: `extra-${index}`, name: `额外服务 ${index + 1}`, protocol: "openai-chat-completions", baseUrl: urls.openAi, model: "mock-model" })),
        ],
        activeServiceId: "mock",
        triggerMode: "mini",
        triggerActivation: "click",
        autoReadWord: false,
        enableWhenSameLanguage: true,
        ignoreInputSelections: true,
        blockedHosts: [],
      },
      slidingTransServiceKeys: { mock: "e2e-key", deeplx: "e2e-deeplx-token" },
    });
  }, { openAi: baseUrl, deepLx: deepLxBaseUrl });

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
  assert.equal(await options.locator(".service-item").count(), 19);
  const mockServiceItem = options.locator(".service-item").filter({ hasText: "Mock 服务" });
  await mockServiceItem.hover();
  await options.waitForTimeout(250);
  assert.equal(await mockServiceItem.locator(".service-item-actions").evaluate((element) => getComputedStyle(element).opacity), "1");
  assert.equal(await mockServiceItem.getByRole("button", { name: "使用 Mock 服务" }).count(), 0);
  const mockDeleteButton = mockServiceItem.getByRole("button", { name: "删除 Mock 服务" });
  assert.equal(await mockDeleteButton.evaluate((button) => getComputedStyle(button).color), "rgb(220, 38, 38)");
  assert.equal(await mockDeleteButton.evaluate((button) => getComputedStyle(button).backgroundColor), "rgba(0, 0, 0, 0)");
  await mockServiceItem.locator(".service-item-main").click();
  assert.equal((await options.locator(".service-item.active .service-item-name").textContent())?.trim(), "Mock 服务");
  const createdServiceItem = options.locator(".service-item").last();
  const createdServiceName = (await createdServiceItem.locator(".service-item-name").textContent())?.trim();
  await createdServiceItem.hover();
  await createdServiceItem.getByRole("button", { name: `删除 ${createdServiceName}` }).evaluate((button) => button.click());
  assert.equal(await options.locator(".service-item").count(), 18);
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
  const promptSection = options.locator(".system-prompt-section");
  const promptHeaderBox = await promptSection.locator(".section-header").boundingBox();
  const promptToolbarBox = await promptSection.getByRole("toolbar", { name: "系统提示词工具栏" }).boundingBox();
  assert.equal(promptToolbarBox.x + promptToolbarBox.width > promptHeaderBox.x + promptHeaderBox.width - 2, true);
  await promptSection.getByRole("button", { name: "重置" }).click();
  await options.waitForTimeout(500);
  assert.equal((await options.getByRole("textbox", { name: "系统提示词" }).inputValue()).startsWith("You are a professional multilingual translation engine."), true);
  await options.getByRole("textbox", { name: "系统提示词" }).fill("自定义提示词 {{targetLanguage}}");
  await options.waitForTimeout(500);
  assert.equal(modelCalls, 1);
  await options.locator(".key-input-field").fill("");
  await options.waitForTimeout(600);
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.getByText("AI 划词翻译", { exact: false }).waitFor();
  assert.equal(await popupPage.locator(".setup-notice").count(), 1);
  await options.locator(".key-input-field").fill("e2e-key-ui");
  await options.waitForTimeout(600);
  const savedKeys = await options.evaluate(async () => (await chrome.storage.local.get("slidingTransServiceKeys")).slidingTransServiceKeys);
  assert.equal(savedKeys.mock, "e2e-key-ui");
  await popupPage.waitForFunction(() => document.querySelector(".setup-notice") === null);
  await popupPage.close();

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
  const triggerPosition = await page.evaluate(() => {
    const button = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger");
    return { left: Number.parseFloat(button.style.left), top: Number.parseFloat(button.style.top) };
  });
  await page.evaluate(() => { document.querySelector("#selected").style.transform = "translateY(90px)"; });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate((position) => {
    const button = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger");
    return Number.parseFloat(button.style.top) >= position.top + 80;
  }, triggerPosition), true);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger") === null), true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger"))), true);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => {
    const shadow = document.querySelector("sliding-trans").shadowRoot;
    const loader = shadow.querySelector('[role="status"]');
    const body = shadow.querySelector(".st-loading-body");
    return Boolean(
      loader
      && body
      && getComputedStyle(body).justifyContent === "flex-start"
      && loader.firstElementChild?.querySelectorAll(":scope > span").length === 9
      && loader.lastElementChild?.textContent === "正在翻译"
      && loader.textContent.trim() === "正在翻译"
      && !shadow.textContent.includes("不应显示的流式译文"),
    );
  }), true);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="更多设置"]').click());
  const menuState = await page.evaluate(() => {
    const menu = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-menu");
    const button = menu.querySelector("button");
    const menuStyle = getComputedStyle(menu);
    const longestButtonWidth = Math.max(...[...menu.querySelectorAll("button")].map((item) => item.getBoundingClientRect().width));
    const horizontalChrome = Number.parseFloat(menuStyle.paddingLeft)
      + Number.parseFloat(menuStyle.paddingRight)
      + Number.parseFloat(menuStyle.borderLeftWidth)
      + Number.parseFloat(menuStyle.borderRightWidth);
    return {
      width: menu.getBoundingClientRect().width,
      computedWidth: menuStyle.width,
      valid: menuStyle.width !== "210px"
      && Math.abs(menu.getBoundingClientRect().width - longestButtonWidth - horizontalChrome) < 1
      && getComputedStyle(button).justifyContent === "flex-start"
      && getComputedStyle(button).textAlign === "left"
      && [...menu.querySelectorAll("button")].some((item) => item.textContent.trim() === "永久关闭")
      && !menu.textContent.includes("设置中恢复"),
    };
  });
  assert.equal(menuState.valid, true, JSON.stringify(menuState));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="更多设置"]').click());
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"), undefined, { timeout: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(slowRequestAborted, true);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-trigger")));
  await page.locator("sliding-trans .st-trigger").click();
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-sentence-translation")?.textContent === "冒烟测试成功", undefined, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-loading-body") === null), true);
  assert.equal(await page.evaluate(() => {
    const modal = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-modal").getBoundingClientRect();
    return modal.left >= 0 && modal.top >= 0 && modal.right <= innerWidth && modal.bottom <= innerHeight;
  }), true);
  await page.evaluate(() => {
    const header = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-modal-header");
    header.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: 100, clientY: 100 }));
    header.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: 5000, clientY: 5000 }));
    header.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: 5000, clientY: 5000 }));
  });
  assert.equal(await page.evaluate(() => {
    const modal = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-modal").getBoundingClientRect();
    return modal.left >= 0 && modal.top >= 0 && modal.right <= innerWidth && modal.bottom <= innerHeight;
  }), true);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.waitForTimeout(450);

  await page.evaluate(() => {
    const lines = document.querySelector("#line-breaks");
    const range = document.createRange();
    range.selectNodeContents(lines);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-trigger")));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => {
    const shadow = document.querySelector("sliding-trans")?.shadowRoot;
    return Boolean(shadow?.querySelector(".st-structured-translation, .st-error-body"));
  }, undefined, { timeout: 5000 });
  const lineBreakState = await page.evaluate(() => {
    const shadow = document.querySelector("sliding-trans").shadowRoot;
    return {
      result: shadow.querySelector(".st-structured-translation")?.textContent ?? "",
      error: shadow.querySelector(".st-error-body")?.textContent ?? "",
      loading: Boolean(shadow.querySelector(".st-loading-body")),
    };
  });
  assert.equal(lineBreakState.loading, false);
  assert.equal(lineBreakState.error, "");
  assert.equal(lineBreakState.result.includes("第三行"), true);
  assert.equal(await page.evaluate(() => {
    const root = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-structured-translation");
    const read = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node instanceof HTMLBRElement) return "\n";
      return [...node.childNodes].map(read).join("");
    };
    return read(root);
  }), "第一行\n第二行\n\n第三行");
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.waitForTimeout(450);

  await page.evaluate(() => {
    const list = document.querySelector("#formatted");
    const range = document.createRange();
    range.selectNodeContents(list);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-trigger")));
  await page.locator("sliding-trans .st-trigger").click();
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-structured-translation strong")?.textContent === "粗体短语", undefined, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => {
    const shadow = document.querySelector("sliding-trans").shadowRoot;
    const result = shadow.querySelector(".st-structured-translation");
    const list = result.querySelector("ol");
    const nestedList = result.querySelector("ul");
    const strong = result.querySelector("strong");
    const emphasis = result.querySelector("em");
    const code = result.querySelector("code");
    return {
      start: list.start,
      items: list.querySelectorAll(":scope > li").length,
      listStyle: getComputedStyle(list).listStyleType,
      nestedListStyle: getComputedStyle(nestedList).listStyleType,
      nestedListText: nestedList.textContent.trim(),
      strongText: strong.textContent,
      strongWeight: getComputedStyle(strong).fontWeight,
      emphasisText: emphasis.textContent,
      emphasisStyle: getComputedStyle(emphasis).fontStyle,
      codeText: code.textContent,
      codeColor: getComputedStyle(code).color,
    };
  }), {
    start: 4,
    items: 2,
    listStyle: "decimal",
    nestedListStyle: "disc",
    nestedListText: "嵌套选项",
    strongText: "粗体短语",
    strongWeight: "700",
    emphasisText: "斜体短语",
    emphasisStyle: "italic",
    codeText: "常量 preserved = true;",
    codeColor: "rgb(39, 85, 63)",
  });
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.waitForTimeout(450);

  const callsBeforeCodeSelection = calls;
  await page.evaluate(() => {
    const code = document.querySelector("#code-only");
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-trigger")));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-structured-translation pre code")?.textContent === "常量答案 = 42；", undefined, { timeout: 5000 });
  assert.equal(calls, callsBeforeCodeSelection + 1);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="关闭"]').click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await page.waitForTimeout(450);

  await page.evaluate(() => {
    const input = document.querySelector("#editor-input");
    input.focus();
    input.setSelectionRange(0, 8);
    input.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger") === null), true);
  await options.bringToFront();
  await options.getByText("输入框、文本框和编辑状态中不显示划词翻译", { exact: false }).locator('[data-slot="checkbox"]').click();
  await options.waitForTimeout(500);
  await page.bringToFront();
  await page.evaluate(() => {
    const input = document.querySelector("#editor-input");
    input.focus();
    input.setSelectionRange(0, 8);
    input.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger"))), true);

  await page.evaluate(() => {
    document.activeElement?.blur();
    const selection = window.getSelection();
    selection.removeAllRanges();
    const textNode = document.querySelector("#selected").firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal")));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector('button[aria-label="更多设置"]').click());
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-menu")));
  await page.evaluate(() => [...document.querySelector("sliding-trans").shadowRoot.querySelectorAll(".st-menu button")].find((button) => button.textContent.includes("永久关闭")).click());
  await page.waitForFunction(() => !document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-modal"));
  await options.bringToFront();
  await options.reload();
  await options.waitForSelector("text=划词翻译");
  const enabledCheckbox = options.getByText("全局启用划词翻译", { exact: false }).locator('[data-slot="checkbox"]');
  assert.equal(await enabledCheckbox.getAttribute("data-state"), "unchecked");
  await enabledCheckbox.click();
  await options.waitForTimeout(500);
  assert.equal(await enabledCheckbox.getAttribute("data-state"), "checked");
  assert.equal(await page.evaluate(() => {
    const logo = document.querySelector("sliding-trans").shadowRoot.querySelector(".st-brand .st-logo");
    return logo ? logo.naturalWidth : 512;
  }), 512);
  assert.equal(observedApiKey, "Bearer e2e-key-ui");
  assert.equal(calls, 6);
  assert.equal(observedSystemPrompt, "自定义提示词 zh-CN");

  const deepLxCallsBefore = deepLxCalls;
  const callsBeforeDeepLx = calls;
  await options.bringToFront();
  await options.locator(".service-item").filter({ hasText: "DeepLX 服务" }).locator(".service-item-main").click();
  await options.waitForFunction(() => document.querySelector(".service-item.active .service-item-name")?.textContent?.trim() === "DeepLX 服务");
  await options.waitForTimeout(600);
  assert.equal(await options.locator("#model-selector").count(), 0);
  assert.equal(await options.getByRole("button", { name: "获取可用模型" }).count(), 0);
  assert.equal(await options.locator(".service-details").getByText("访问令牌（可选）").count(), 1);
  await page.bringToFront();
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
  await page.waitForFunction(() => Boolean(document.querySelector("sliding-trans")?.shadowRoot?.querySelector(".st-trigger")));
  await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-trigger").click());
  await page.waitForFunction(() => {
    const root = document.querySelector("sliding-trans")?.shadowRoot;
    return Boolean(root?.querySelector(".st-modal") && root.querySelector(".st-structured-translation")?.textContent === "你好");
  }, undefined, { timeout: 5000 });
  assert.equal(deepLxCalls - deepLxCallsBefore, 1);
  assert.equal(calls, callsBeforeDeepLx);
  assert.equal(observedDeepLxToken, "e2e-deeplx-token");
  assert.equal(observedDeepLxAuthorization, "");
  assert.equal(await page.evaluate(() => document.querySelector("sliding-trans").shadowRoot.querySelector(".st-model").textContent.trim()), "DeepLX");
  const deepLxPopup = await context.newPage();
  await deepLxPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await deepLxPopup.getByText("AI 划词翻译", { exact: false }).waitFor();
  assert.equal(await deepLxPopup.locator(".setup-notice").count(), 0);
  await deepLxPopup.close();
  console.log("MV3 smoke test passed: model discovery + selection -> trigger -> SSE translation -> DeepLX translation");
} finally {
  await context.close();
  server.close();
  await fs.rm(profilePath, { recursive: true, force: true });
}
