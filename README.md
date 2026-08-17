# SlidingTrans

SlidingTrans 是一个 Chromium Manifest V3 划词翻译扩展。选中网页中的单词或句子后，可以在原页面内查看 AI 翻译、词典释义、发音和复制结果。

## 开发

```bash
npm install
npm run dev
```

## 构建与安装

```bash
npm run check
npm test
npm run build
```

在 Chrome 或 Edge 的扩展管理页开启开发者模式，选择“加载已解压的扩展”，目录为 `.output/chrome-mv3`。如果需要翻译本地文件，还需要在扩展详情中开启“允许访问文件网址”。

首次使用时打开扩展设置，创建或选择翻译服务，填写 OpenAI 兼容接口的 Base URL、协议、模型和 API Key。支持保存多个服务配置并随时切换，支持 Chat Completions 与 Responses 的流式接口。API Key 只保存在浏览器本地扩展存储中，不会同步到云端。

翻译请求开始、完成或失败，以及设置自动保存、连接测试和模型发现，使用 [Cuelume](https://cuelume.dev/docs/) 提供的 `loading`、`success` 和 `error` 音效反馈。浏览器首次访问页面时需要先有一次用户交互，音效才可能播放。

## 使用

1. 安装或重新加载扩展后，刷新需要划词翻译的网页。
2. 点击扩展图标并进入“设置”，填写 API Base URL 和 API Key；可点击模型框右侧的刷新图标获取并选择可用模型，也可以手动填写模型名称。
3. 点击“测试连接”。测试会先保存当前表单，出现“连接成功”后即可关闭设置页。
4. 在普通 HTTP/HTTPS 网页选中单词或句子，将鼠标移到选区旁的粉色圆点上；默认悬浮 200ms 后打开翻译弹窗。

浏览器内部页面、Chrome/Edge 扩展商店和其他禁止内容脚本注入的页面无法使用。修改源码并重新构建后，需要在扩展管理页点击“重新加载”，并再次刷新目标网页。

完整验证命令：

```bash
npm run check
npm test
npm run build
npm run test:e2e
```

## 开发版发布

当前版本使用 `0.1.0-dev.0` 形式的预发布版本号。推送与 `package.json` 版本严格一致的标签（例如 `v0.1.0-dev.0`）后，GitHub Actions 会完成类型检查、单元测试、MV3 冒烟测试和扩展打包，并将 ZIP 上传到 GitHub Prerelease。也可以手动运行工作流，仅生成可下载的构建产物而不发布 Release。

## 当前范围

支持普通网页、开放 Shadow DOM、输入框、`contenteditable` 和 iframe 中的文本选区；支持迷你圆点、图标和直接触发、悬浮/点击触发、自动朗读、弹窗固定、历史选区和站点禁用。

不包含网页全文、段落悬停、PDF、字幕、区域 OCR、移动端、Firefox、Safari、账号、云同步、计费和遥测功能。
