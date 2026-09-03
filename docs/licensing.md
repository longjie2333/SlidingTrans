# 许可证调研记录

更新时间：2026-09-03

## 结论

SlidingTrans 是从零实现的 Chromium 扩展，只借鉴公开的功能描述和交互观察，不复制沉浸式翻译的源代码、构建产物、品牌、图标或其他受保护资产。因此，本项目不需要因为功能相似而采用沉浸式翻译的许可证；项目自身代码采用宽松的 MIT License，具体条款见根目录 [`LICENSE`](../LICENSE)。

## 核查来源

- [沉浸式翻译官网](https://immersivetranslate.com/zh-Hans/)：用于确认功能范围和公开产品描述。
- [当前公开仓库](https://github.com/immersive-translate/immersive-translate/tree/d4141efe72caf262a02422ac3e960ac8f2c190bd)：在调研提交 `d4141efe72caf262a02422ac3e960ac8f2c190bd` 下公开的是 `dist/` 构建目录及文档；GitHub 仓库元数据未声明项目许可证，也没有可供本项目继承的源代码授权文件。
- [旧仓库许可证](https://github.com/immersive-translate/old-immersive-translate/blob/6df13da22664bea2f51efe5db64c63aca59c4e79/LICENSE)：旧仓库的许可证文件为 Mozilla Public License 2.0，且该仓库已归档并明确不再包含当前划词翻译实现。

## 项目边界

MIT 许可只覆盖 SlidingTrans 自有代码。`node_modules` 中的 React、WXT、OpenAI SDK、Lucide 等第三方依赖继续遵循各自许可证；发布扩展时不移除其版权和许可证信息。任何后续引入的外部代码或资源都必须单独核对来源和许可，不因本项目使用 MIT 就自动获得 MIT 授权。
