# SlidingTrans

SlidingTrans 是一个 Chromium Manifest V3 划词翻译扩展。选中网页中的单词或句子后，可以在原页面内查看 AI 翻译、词典释义、发音和复制结果。

![sceenshot.png](https://cn-img.owoser.cn/images/2026/08/21/03677296bfad0ed82f647800a6284e9f.png)

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

首次使用时打开扩展设置，创建或选择翻译服务。OpenAI Chat Completions 与 OpenAI Responses 协议需要填写 OpenAI 兼容接口的 Base URL、模型和 API Key；DeepLX 协议只需填写 Base URL，访问令牌可选。支持保存多个服务配置并随时切换，支持 OpenAI 流式接口与 DeepLX 翻译接口。API Key 只保存在浏览器本地扩展存储中，不会同步到云端。

翻译请求开始、完成或失败，以及设置自动保存、连接测试和模型发现，使用 [Cuelume](https://cuelume.dev/docs/) 提供的 `loading`、`success` 和 `error` 音效反馈。浏览器首次访问页面时需要先有一次用户交互，音效才可能播放。

## 使用

1. 安装或重新加载扩展后，刷新需要划词翻译的网页。
2. 点击扩展图标并进入“设置”，按协议填写 API Base URL，OpenAI 协议再填写模型和 API Key；可点击模型框右侧的刷新图标获取并选择可用模型，也可以手动填写模型名称。
3. 点击“测试连接”。测试会先保存当前表单，出现“连接成功”后即可关闭设置页。
4. 在普通 HTTP/HTTPS 网页选中单词或句子，将鼠标移到选区旁的粉色圆点上；默认悬浮 200ms 后打开翻译弹窗。
5. 如需翻译页面正文，点击扩展弹窗中的“翻译此页”。扩展会记住当前网站并在后续访问时自动翻译；点击“显示原文”会移除该网站的自动翻译设置。页面翻译只扫描当前可视区域内的文本节点，滚动页面或页面动态插入新内容后，会继续处理进入视口且尚未翻译的文本。显示位置可在设置页选择“原文下方显示”或“直接替换原文”。

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

日常推送 `dev` 分支也会运行检查和打包流程，仅保留 Actions artifact，不会创建 Release。

## 开源协议

SlidingTrans 是独立实现的项目，与沉浸式翻译及其开发者不存在隶属或关联关系。本项目不包含沉浸式翻译当前闭源版本或旧开源仓库的源代码、品牌与图标。

项目自身代码采用 [MIT License](LICENSE) 开源。项目使用的第三方依赖仍分别适用其各自的许可证。

许可证调研记录见 [`docs/licensing.md`](docs/licensing.md)。沉浸式翻译当前公开仓库在本项目调研的版本中没有声明可继承的项目许可证；旧仓库曾使用 MPL-2.0，但本项目没有复制其中的代码，因此没有采用 MPL-2.0 的必要。

## 当前范围

支持普通网页、开放 Shadow DOM、输入框、`contenteditable` 和 iframe 中的文本选区；支持迷你圆点、图标和直接触发、悬浮/点击触发、自动朗读、弹窗固定、历史选区和站点禁用。

不包含网页全文、段落悬停、PDF、字幕、区域 OCR、移动端、Firefox、Safari、账号、云同步、计费和遥测功能。
