---
alwaysApply: false
paths: src/ai-prompts.js, src/worldbook-api.js
---

# AI 提示词与世界书接口层

改动 `src/ai-prompts.js` 或 `src/worldbook-api.js` 时适用。

## `ai-prompts.js`

- **必须保持零运行时依赖**——不 import 酒馆助手、不碰 `window`/`document`，
  否则 Node 单测跑不起来。这是它能被 `test/ai-prompts.test.mjs` 覆盖的前提。
- 消息顺序**固定**：
  首部破限 system（最上）→ 任务 system（含 style）→ 任务 user
  → **尾部破限 system** → 输出契约 system →（json 且 retry 时）强化 JSON 提醒 system。
- **破限分两段（`jailbreakHead` / `jailbreakTail`），都用 `role:'system'`**：
  它是全局框架声明，作用对象是整个请求。首部锚基线，尾部在临近输出处再锚一次
  （长上下文里开头/结尾注意力最强、中段最弱）。放到任务之后会被读成「补充要求」，
  用 `user` 口吻则权重低于 system。
- **输出契约必须压轴**：它是格式硬约束，排在它后面的任何指令都会削弱 JSON/正文稳定性。
  所以尾破限置于契约**之前**，不是最末。
- 任一段为空时只跳过那一条；两段都空则不追加任何消息。不要内置破限文案。
- `format='text'` 时只要求正文，**不追加** JSON 重试提醒。
- 输出契约有两种：结构化任务用 `JSON_OUTPUT_CONTRACT`，纯文本用 `TEXT_OUTPUT_CONTRACT`。
  两者都要求「不输出思考过程/说明/Markdown」。
- `buildMessages()` 的 `system` 与 `user` 为空或非字符串时**抛 `TypeError`**，不要静默降级。
- `parseAIJSON()` 负责剥思考块、抽 JSON、修尾逗号；格式错误时由调用方重试**一次**，
  重试通过 `retry: true` 追加 `RETRY_REMINDER`。

## `worldbook-api.js`

- 这是**兼容层**，不是业务层。所有酒馆助手接口调用都收敛到这里。
- 新旧接口并存，用 `call(api, [新名, 旧名])` 探测第一个存在的方法，
  缺失时抛**明确中文错误**（如「酒馆助手缺少 xxx 接口，请启用或更新酒馆助手」）。
- `getHelper` 是**注入的回调**，不是直接引用全局——每次调用都要重新解析。
- `mergeEntry` 对 `strategy` 与 `position` 做**深一层合并**，
  `strategy.keys_secondary` 还要再深一层。扁平覆盖会丢字段。
- `setEntries` 用 `updateWorldbookWith` 回调式写入前，
  要先校验 uid 仍存在，不存在则抛错让用户重新载入世界书。
- 写操作**永不静默失败**，错误必须冒泡到 UI 层提示。
