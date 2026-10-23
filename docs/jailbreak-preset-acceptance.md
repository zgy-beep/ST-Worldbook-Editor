# 破限预设自定义保存 · 验收记录（2026-10-22）

本轮范围：内置/自定义预设分组、保存为自定义、同名更新/取消、删除确认、稳定 id、深拷贝，以及中性模板「世界书编辑·结构稳健」。以下只记录已发生的事实；模型生成未通过，模板生成质量尚未验证。

## 1. 功能位置与使用步骤

- 预设合并：`src/Worldbook-Editor.js:1018-1024`（内置 `builtin:` + `CFG.jbCustomPresets` 的 `custom:`，读取时深拷贝）。
- 入口按钮：`src/Worldbook-Editor.js:1330`「保存为自定义预设」；同名内联「更新现有 / 取消」，删除走确认。
- 校验与构造：`src/jb-presets.js:144`（内置 8 个）、`:220-278`（两区数组/≤6 条/role/content/至少一条非空，名称 trim、≤40 码点）。
- 存储：`extensionSettings.st_worldbook_editor.jbCustomPresets`，元素固定 `{ id, name, pre, post }`，与 `layout` 分离；不携带 key/model/世界书内容。

预计最终用户操作：刷新酒馆 → 破限 → 选择「世界书编辑·结构稳健」→ 套用 → 按需编辑 → 保存为自定义预设 → 输入名称 → 保存。本轮不自动套用该模板。

## 2. 本地测试（Codex 直接执行）

- `npm test`：58 通过 / 0 失败，日志 `.test-output/main-tests.log`。
- `npm run test:kit`：361 通过 / 0 失败，日志 `.test-output/main-kit.log`。
- `npm run test:browser`（显式 `PLAYWRIGHT_MODULE_PATH` / `CHROME_PATH`）：输出 `Browser smoke passed`，覆盖 standard entry、migration、helper、AI prompts/parse/apply、tabs、desktop/mobile、hostmodal、layout、custompresets、lifecycle；日志 `.test-output/main-browser.log`。
- 修正后 `test/ui-contract.test.mjs` 完整恢复 HEAD，无弱化守护；CDP 兜底已移除。浏览器新增覆盖：40 emoji 可保存 / 41 拒绝、异常 `jbCustomPresets` 原值保留、同名更新后编辑使旧 pending 失效、删除确认后切换预设不误删。
- 变异验证（执行方：前轮 DSH）：对全空保存条件做变异，5 过 2 失败；恢复后 7/7 通过。Codex 未独立重复变异。

## 3. 真实保存测试（真实宿主）

- 宿主 `http://127.0.0.1:8000`；runtime helper 的 `generateRaw/menu` 已就绪；custom 模式模型 `pg-gemini-3.8-flash`。未记录 key/url 或用户世界书内容。
- `node .test-output/live-jb-check.mjs --run`：`templateApplied/customSaved/reloaded/persisted/customApplied/arraysIndependent/matchesPreset` 全 true；临时自定义预设 reload 后仍在，套用独立；截图 `.test-output/live-jb-presets.png`。
- 清理：`cleanup.restored=true`、`tempPresetRemoved=true`、`errors=[]`、`pageErrors={}`；没有写入真实世界书。

## 4. 真实模型两次结果与限制

- 共恰好 2 次，均为合成输入且 `max_tokens<=300`，未重试、未换模型、未改 key/url。
- 第 1 次（JSON，约 2633 ms）：helper 抛普通 `Error`，旧脚本归类 `other`、status 为 null；无法追认确切 HTTP 原因。
- 第 2 次（文本，约 2128 ms，`node .test-output/live-jb-text-check.mjs --text-once`）：宿主 `/api/backends/chat-completions/generate` 返回 HTTP 200，但 helper 报 `message='Service Unavailable'`，`stage=remote-model-response`，`networkBlockedDuringCall=false`，无 pageerror。
- 结论：模型生成未通过，上游返回不可用；模板生成效果尚未验证。不能声称模板质量已过、不能声称 HTTP 503、也不能声称两次原因相同。

## 5. 恢复与遗留

- 原编排已恢复，临时预设与临时项已清理；未触发 AI 应用 Diff，未写世界书；未提交、未推送。
- 待上游恢复后可再测生成；本轮不继续发请求。功能保存/持久化/删除/套用链路已由本地测试与真实保存测试覆盖。
