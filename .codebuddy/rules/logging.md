---
alwaysApply: false
paths: "src/**/*.js"
---

# 日志与隐私（改动 src/ 下 JS 时适用）

统一日志模块是 `src/logger.js`（零 import 叶子模块，可被 Node 单测）。细则见 `docs/diagnostics-logging.md`。

## 红线

- 日志一律走 `getLogger().child(scope)`，**不要**在 `src/` 里直接 `console.*`（logger 内部的控制台镜像除外）。
- **绝不**把 API Key / `Authorization` / token / 世界书正文 / 聊天文本 / 提示词原文传给 logger；
  只传元信息：模型名、条数、长度、uid、耗时、scope 等。
  logger 会对 `key` / `token` / `authorization` 等字段名和 `sk-…` / `Bearer …` 文本兜底脱敏，但不能依赖兜底。
- 日志只存在**内存环形缓冲**（默认 300 条），不写 `localStorage` / `extensionSettings` / 文件，不上传；
  不要为了「跨刷新保留」破坏这条红线（要跨刷新先复制导出）。
- `catch` 不要静默：可预期失败先 `log.warn/error` 留一条，再 toast/返回错误。
- debug 级用于高频 / 请求元信息；默认生产只记 info 及以上（设置页「详细日志」开关切 debug）。
- 新增全局排障入口（如 `window.__wbeLog`）必须在 `cleanup()` 里**只收回本扩展自己的值**。

## 测试要求

- 脱敏 / 缓冲 / 导出 / 全局捕获：`test/logger.test.mjs`。
- 静态契约：`test/ui-contract.test.mjs` 断言 logger 零 import、index/runtime/editor 接入、设置页入口与动作。
- 浏览器冒烟：`test/browser-smoke.mjs` 断言折叠条可展开、`ErrorEvent` 进缓冲、`Bearer ***` 脱敏、清空与 disable 收回收。
