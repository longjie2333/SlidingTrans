# SlidingTrans 开发约定

## 项目范围

- 本项目是基于 WXT、React 和 TypeScript 的 Chromium Manifest V3 划词翻译扩展。
- 保持当前产品边界；未经任务明确要求，不扩展到全文翻译、PDF、字幕、OCR、移动端或其他浏览器。
- 不保留向后兼容。删除废弃路径，不增加迁移层、兼容分支或临时回退。
- 选择满足当前需求的最简单长期方案，优先复用现有依赖和模式，避免投机抽象。

## 模块职责

- `entrypoints/` 只放 WXT 入口、页面组合和浏览器生命周期接线。
- `src/content/` 负责选区读取、内容结构和视口定位等页面领域逻辑。
- `src/background.ts` 负责 API 客户端、流式请求、取消和错误映射；API Key 不得进入页面上下文或日志。
- `src/shared/` 保存跨入口类型、设置校验、模型发现和翻译协议。
- `src/ui/` 保存通用 UI 基础组件；优先使用已有 Radix、Lucide、Tailwind 和项目组件。
- 内容脚本 UI 必须保留 Shadow DOM 隔离，内部类名使用 `st-` 前缀，不污染宿主页面。

## 代码风格

- 使用严格 TypeScript；避免 `any`、非必要类型断言和重复的接口定义。
- 使用 2 空格缩进、双引号、分号和多行尾逗号，与现有文件保持一致。
- React 使用函数组件和 Hooks；业务状态保留单一权威来源，派生值在渲染时计算。
- 外部输入和模型响应使用 Zod 或结构化 API 校验，不用脆弱的字符串拼接替代解析器。
- 保持函数和组件职责集中。只有在降低真实重复或复杂度时才新增抽象。
- 注释只解释不明显的约束和原因，不复述代码。
- UI 主题色为 `#30A46C`；新增交互沿用现有组件、紧凑布局、明暗主题和可访问标签。

## 开发流程

1. 修改前阅读目标模块、调用方、类型和相关测试，保留无关的用户改动。
2. 先完成最小可工作的端到端路径，再按需求逐层增加能力。
3. 单元测试与源码同目录，命名为 `*.test.ts`；MV3 浏览器回归统一维护在 `scripts/e2e-smoke.mjs`。
4. 根据风险运行验证；功能交付前默认执行完整检查：

```bash
npx wxt prepare
npm run check
npm test
npm run build
npm run test:e2e
npm run zip
```

5. 提交前检查 `git status`、暂存文件、`git diff --cached` 和 `git diff --cached --check`。

## Git 与版本管理

- `dev` 是日常开发分支；普通功能、修复和文档变更只推送到 `dev`。
- `main` 仅用于正式版本，必须从已验证的 `dev` 快进更新；不得直接提交、强推或静默改写历史。
- 提交使用 Conventional Commits，例如 `feat:`、`fix:`、`refactor:`、`test:`、`docs:`、`chore:`；标题简洁，正文使用中文说明行为和原因。
- 按职责拆分提交，不混入生成物、密钥、无关文件或用户未授权的改动。
- 开发版本使用 `X.Y.Z-dev.N`，并同步更新 `package.json` 与 `package-lock.json`。
- 开发预发布标签必须与包版本完全一致，例如 `v0.1.0-dev.0`。推送标签前先完成完整验证并获得明确的版本确认。
- `.github/workflows/release.yml` 的手动运行只构建可下载产物；推送匹配 `v*-dev.*` 的标签才会创建 GitHub Prerelease。
- 推送 `dev` 分支会自动执行同一套检查和打包流程，但只上传 Actions artifact，不创建 Release。
- 当前没有稳定版本发布工作流。正式发布前必须先明确版本、验证发布流程，再推送 `main` 和稳定标签。
- 未经明确授权，不推送 `main`、创建或移动标签、发布 Release。

## 许可与安全

- 项目代码采用 MIT License；第三方依赖继续适用各自许可证。
- 本项目为独立实现，不复制沉浸式翻译的闭源代码、旧开源代码、品牌或图标。
- 不提交 API Key、`.env`、构建产物、浏览器配置或本地测试数据。
