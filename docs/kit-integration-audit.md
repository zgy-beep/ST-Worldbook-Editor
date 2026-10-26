# NVUI Kit 集成审计

## v2.8.0 验收（2026-10-26）

- 内置 Kit 已同步上游 `v2.8.0` 标签（附注 tag 指向提交 `012653a7dc2cb50e97ca319d59a1760596b43207`，提交标题 `feat: v2.8.0 downstream DX, defaults and Fast UI glass modes`）。`ui-kit/` 全量 **78 个文件**（含新增 `scripts/`、`.github/workflows/ci.yml`、`UPGRADING.md`、`MIGRATION-v2.md`、4 个新测试）与本机 `git checkout v2.8.0` 工作树**逐文件 SHA256 一致（78/78，0 mismatch）**；上游已删除的 `RELEASE_PLAN_v2.7.0.md` 同步移除。
- 上游 v2.7.0 → v2.8.0 规模：`nvui-api.js` +416 行、`components.css` +211 行、`README.md` 大幅重写、`package.json` 新增 5 个脚本；新增 `test-api-surface.js`（27 顶层导出冻结）、`test-v280-features.js`、`downstream-check.js`（下游 4 资产自检）、`st-glass-transparency.js`（玻璃透明感探针）。
- 该标签同时包含 **v2.7.1**（上游 #15：表单浏览器回归把固定 250ms 等待改为轮询最终计算值）与 **v2.7.2**（玻璃透明感增强：面板态 30% 底 + 48px 背后模糊；宿主禁模糊时改为 `--nvui-bg-2` 97% 近不透明 `.nvui-glass-fallback`；`detectGlassSupport()` 三态自愈；`setTheme()` 不再无条件清除用户手动加的 `.nvui-solid`）。
- 运行资产一致性：`node ui-kit/test/downstream-check.js` 8/8 PASS、exit 0（`NVUI.version` / `tokens.css` / `tokens.json` / `package.json` 均 2.8.0，token 111/47，`!important` 18，Node 侧可加载）。
- Kit 静态门禁：`test-ui-kit.js` **367/367**；`test-api-surface.js` 27 顶层导出冻结通过；`test-v280-features.js` 8/8；玻璃透明感探针 `st-glass-transparency.js` 12/12（本机 headless Chrome，报告 `ui-kit/test/out/glass-transparency/report.json`，该目录已 gitignore）。
- 扩展集成验证：`npm test` **59/59**；浏览器冒烟通过，并新增两条 v2.8.0 契约断言：
  1. 真实页面 `window.NVUI.selfCheck({ expect: '2.8.0' })` 除允许的 `glass-auto-fallback` 外无 issue（版本 / CSS 一致性）；
  2. v2.8.0 新增的「正文裸相邻 `.nvui-btn` 默认 8px」未命中本扩展：`.nvui-panel-body > .nvui-btn` 数量为 0，`.wbe-bar` 内按钮 `margin-inline-start` 计算值为 `0px`（间距仍由业务 `.wbe-bar` 的 `gap` 控制，没有双倍）。
- 业务侧同步：`src/index.js` 新增 `KIT_VERSION = '2.8.0'` 与 `logKitSelfCheck()`（`ensureNVUI()` 拿到本地 Kit 后调 `NVUI.selfCheck`，版本漂移 / CSS 未加载 → `console.warn`；`glass-auto-fallback` 是宿主 Fast UI 正常降级，已忽略，仅 `NVUI.config.debug` 打开时输出通过详情）；`src/Worldbook-Editor.js` 版本守卫、`style.css` / `host-isolation.css` / `runtime.js` 版本注释、`ui-contract.test.mjs` 版本断言同步；`package.json` 的 `test:kit` 扩为「规范 + API 表面 + v2.8.0 功能 + downstream 自检」四套。
- 兼容性结论：本扩展未使用语义被改的 `.nvui-solid` / 玻璃回退类；`createPanel` 未传 `glass`（默认 `auto`，行为与 v2.7 的 Fast UI 降级一致）；持久化状态格式未变，`runtime.layoutStorage` 契约不变。v2.8.0 的 `.nvui-actions` / `defaults` / `checkCompatibility` / `glass: force` / `--nvui-kit-version` 业务侧暂未采用（`selfCheck` 已接入），属后续迭代候选。
- 顺手修复：工具页「全书查找替换」两行按钮垂直间距 `0px` 的历史已知问题 —— `src/Worldbook-Editor.js` 第二行 `.wbe-bar` 补 `wbe-mt-2`（`8px`），浏览器冒烟新增 `≥8px` 断言；旧版本审计里「下一步 1」至此完成。
- 同期业务改造（不属 Kit 上游）：新增诊断日志系统（`src/logger.js` + 设置页「诊断日志与排障」+ `window.__wbeLog`，见 `docs/diagnostics-logging.md`）；桌面面板增高（关闭 `persist.size` + 业务作用域内把 `--nvui-panel-max-h` 由 88vh 提到 94vh，仅覆盖 token、不改 `ui-kit/`）。
- 边界：`.github/`、`scripts/`、`test/` 属上游自包含开发资产，只留在 `main`；`release` 分支仍只同步 4 个运行资产 + `LICENSE`。本轮未在真实 SillyTavern 宿主（T:/Github/SillyTavern/APP/SillyTavern）里跑实机回归，验证范围是 Node 套件 + 本地浏览器冒烟 + Kit 自带 headless Chrome 探针。

## v2.7.0 追补验收（2026-10-23）

- 内置 Kit 已同步上游 `v2.7.0` 标签（提交 `4d0251d27f91cb3a4e579141fb3915895a7380bc`），包含 `.nvui-form-scope` 与 #12–#14 修复；本扩展位于默认 Kit 面板载体中，无需给业务容器添加 opt-in 类。
- 复跑下文三个「正确行为」集成断言：`3/3 correct, 0 reproduced`。持久化恢复非首标签后的焦点进入当前 pane；收起折叠体后焦点留在面板内；宿主模态打开时 Escape 不再关闭底层 Kit 面板。
- Kit 静态规范 `362/362`；Kit 浏览器回归串行复跑：forms `455/455`、accordion `18/18`、#12 `217/217`、#13/#14 `13/13`；扩展浏览器冒烟通过。
- 首次与扩展冒烟并行运行 Kit 浏览器套件时，forms 半选 checkbox 的两个过渡样式断言短暂失败（`453/455`）；后续串行与三份并行复跑均为 `455/455`。已向上游提交[测试稳定性 issue #15](https://github.com/zgy-beep/ui-kit/issues/15)，当前没有证据证明最终 UI 皮肤错误。
- 下文为 **v2.6.0 时的历史复现记录**，行号与失败数据只适用于该旧版本。

## v2.6.0 基线与结论

- 审计对象：本扩展内置 `ui-kit/` 副本，上游为 `zgy-beep/ui-kit` 提交 `29e9315`。
- 比对结果：`nvui-api.js`、`components.css`、`tokens.css` 与上游对应 blob 一致，未发现本地差异。
- 结论：截图中的两个问题分别落在业务 DOM/宿主集成与上游 Kit；不能据此断言 Kit 整体异常，也不代表 Kit 没有其他缺陷。

## 归因与问题

| 现象 | 归属 | 证据 | 关联 |
| --- | --- | --- | --- |
| 按钮行间距为 0、上下黏连 | 本插件业务 DOM 布局 | `src/Worldbook-Editor.js:656-660` 两个兄弟 `.wbe-bar` 直接位于 `.nvui-acc-inner`；`src/styles/style.css:56-67` 的 `.wbe-bar` 只有行内 `gap: 8px`，`.wbe-form` 才有 `gap: 10px` | 本次分析，未提交上游 issue |
| 下拉 `optgroup` 深色可读性 | 上游 Kit 样式 | `components.css:776-809` 覆盖了 `select option`，未覆盖 `optgroup`；深色下组背景 `transparent`、组文字偏浅，原生弹层白底浅字 | [#12](https://github.com/zgy-beep/ui-kit/issues/12) |
| 隐藏控件进入焦点陷阱 | 上游 Kit 焦点管理 | `nvui-api.js:2338-2357` 用 `offsetWidth/Height` 过滤，`visibility:hidden` 的折叠控件仍被计入 | [#13](https://github.com/zgy-beep/ui-kit/issues/13) |
| 全局 Esc 关闭底层面板 | 上游 Kit 键盘处理 | `nvui-api.js:750-765` 未判断宿主 modal；`:848-859` 仅视觉让位；`:2364-2368` 的 entry 可见性未排除 host modal | [#14](https://github.com/zgy-beep/ui-kit/issues/14) |

### 按钮行间距

- 10 组矩阵覆盖 Kit、Kit+host、完整插件，dark/light 与双载体；完整插件行间为 0、行内为 8。
- 用现有 `.wbe-form` 探针测得行间 10；真实 `http://127.0.0.1:8000` 只读页面同样测得行间 0。
- 说明 Kit 按钮皮肤正常，两个业务 `.wbe-bar` 之间缺少垂直布局间距。
- 建议后续把按钮行放进 `.wbe-form` 包装，而不是给 Kit 按钮强加 margin；本次未改该业务 DOM。

### #12：`optgroup` 样式缺口

- 纯 Kit 的 before/after 两张合成截图已由主 Agent 肉眼验证；临时补 `group` 的 token 背景/文字色后恢复正常。
- 实测深色组文字 `rgb(233,236,243)`、`optionBg` `rgb(28,33,48)`；浅色分别为 `rgb(31,36,48)`、`rgb(238,241,248)`。
- 10 组 `group` 背景均为 `transparent`，与原生弹层白底叠加后出现低对比。
- 环境为 Windows Chrome `155.0.8059.85` headless，结论不能外推到所有 OS。
- 截图：`.test-output/kit-select-popup-before.png`、`.test-output/kit-select-popup-after.png`。

### #13：焦点陷阱计数与初始焦点

- 隐藏 `button` 的 `buttonWidth` 仍为 58 并被计入 `last`；真实按 Tab 后 `focus=BODY`，焦点离开对话框。
- `focusBody:2236-2241` 未过滤隐藏的 tab primary；恢复 `b` 且存在可见 input 时，焦点停在 `DIALOG`，`inDialog=true`、`inActivePane=false`。
- 初始焦点这一项仍在 Kit 载体内；折叠控件导致 Tab 逃出的那一项属于已关闭 #8 / NEW-40 的残余。

### #14：宿主 modal 下的 Escape

- 使用原生 `host.showModal()` 并 `cancel.preventDefault()` 保持打开，待 `is-host-modal` 稳定后按真实 Escape：`panelHidden=true`、`hostOpen=true`。
- Kit 不应关闭底层面板；该路径中 Kit 自身没有 `preventDefault`。
- 关联已关闭 #4。fixture 未调用真实 ST Popup，因此不能写成“实际 ST Popup 已测”。

## 验证范围与边界

- 已运行 `.test-output/kit-style-audit.mjs` 矩阵、`--live` 真实只读、`kit-select-popup.mjs` 与 `kit-integration-audit.mjs`。
- 集成审计的 3 个“正确行为”断言全部失败，即 `0/3 correct`、`3 reproduced`；这是问题复现，不是项目 CI 失败。
- 日志：`main-kit-style.log`、`main-kit-style-live.log`、`main-kit-popup.log`、`main-kit-integration-final.log`。
- 未重复跑 `npm` 全量：本次仅新增诊断脚本/报告，未改 `src/`、`ui-kit/`、`test/` 或用户配置，也未发模型请求。
- 保留工作区先前业务改动；其他实际用到的主题、Tabs 方向键、Toast、accordion adoption/持久化及 #9/#10/#11 已修能力，本次未发现新增问题，但不据此声称 Kit 无其他 bug。

## 下一步

1. 在本插件用 `.wbe-form` 包装按钮行，消除行间 0 与行内 8 的错位。
2. 跟进 #12、#13、#14；上游修复后升级 Kit，并复跑矩阵、真实只读、弹层与集成审计。
3. 复验时补真实 ST Popup 场景，并在更多 OS/浏览器上确认 `optgroup` 与焦点行为。

边界：以上只覆盖本副本和已记录环境；blob 一致说明差异不来自本地 Kit 文件，但本扩展仍会受上游缺陷影响。
