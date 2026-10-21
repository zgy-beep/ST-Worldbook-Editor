# ST-Worldbook-Editor · AI 开发指引

> 本文件由 AI 助手在每次会话启动时自动读取。改代码前先读完，再动手。
> 细则拆分在 `.codebuddy/rules/`，按文件类型条件触发。

## 项目是什么

SillyTavern 世界书编辑器（Worldbook Editor），以**标准前端扩展**形式运行在世界书（Lorebook）管理上。
当前版本 `0.6.0`，宿主最低版本 `1.17.0`。

不是脚本库插件，不要求把代码粘进酒馆助手脚本库。通过 `manifest.json` 声明入口与生命周期钩子，
由 SillyTavern 扩展管理器加载。

## 架构与模块边界

模块**单向依赖**，不得反向引用：

```
src/index.js          生命周期：APP_READY 启动、菜单挂载、清理
  └─ src/runtime.js   宿主适配：extensionSettings / 布局存储 / TavernHelper 访问
       └─ src/Worldbook-Editor.js   业务与界面，导出 initializeEditor(runtime)
            ├─ src/worldbook-api.js  酒馆助手新旧接口兼容层
            └─ src/ai-prompts.js     AI 消息拼装与 JSON 解析（不依赖运行时，可被 Node 单测）
```

- `src/index.js` 只管生命周期与菜单，**不写业务 UI**。
- `src/runtime.js` 是**唯一**允许接触 `SillyTavern.getContext()` 的地方；其他模块通过 runtime 拿能力。
- `src/ai-prompts.js` 必须保持零运行时依赖，否则 Node 单测跑不起来。
- `ui-kit/` 是 **NVUI Kit v2.6.0 的自包含独立项目**，由上游维护，本仓库只做本地内置分发。
  不要把扩展业务逻辑写进 `ui-kit/`，也不要改它的 `nvui-api.js`。

## 常用命令

```bash
npm test              # 38 项项目测试（node --test test/*.test.mjs）
npm run test:kit      # 354 项 Kit 规范守护（node ui-kit/test/test-ui-kit.js）
npm run test:browser  # 浏览器端到端冒烟，需额外两个环境变量（见下）
```

浏览器冒烟测试**零依赖设计**，本机必须显式指定：

```bash
PLAYWRIGHT_MODULE_PATH="C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core" \
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
npm run test:browser
```

本机 SillyTavern 在 `T:/Github/SillyTavern/APP/SillyTavern`（1.19.0），
扩展通过 **Junction** 软链到 `public/scripts/extensions/third-party/ST-Worldbook-Editor` 才能实跑。

## 改代码前必须知道的硬约束

这些不是风格偏好，是**测试会直接断言**的，违反了 CI/本地测试立刻红：

### 1. 宿主访问

- 只用 `globalThis.SillyTavern.getContext()`，**绝不静态 import ST 内部模块**。
- **不缓存** context 和 TavernHelper 对象，每次调用重新读。ST 重载设置会替换 `extensionSettings` 引用。
- 酒馆助手通过 `window.TavernHelper` **运行时探测**，不硬编码安装目录名。

### 2. 设置存储

- 只写 `extensionSettings.st_worldbook_editor` 这一个命名空间。
- **绝不**调用 `localStorage.clear()`，**绝不**遍历清理任意 `wbe_*` 键，**绝不**碰其它扩展的设置。
- 面板布局单独放 `settings.layout`，不与业务字段混在一起。
- 旧键 `wbe_settings_v1` 迁移遵循「已有 ST 设置优先」，迁移成功后清理旧键。

### 3. 业务 CSS（`src/styles/style.css`）

- 颜色**只能**用 `var(--nvui-*)` 令牌，禁止 `#hex` / `rgb()` / `hsl()` 字面量。
- 禁止 `!important`、`z-index: <数字>`、`position: fixed`、`--SmartTheme`。
- **所有普通选择器必须以 `#wbe-overlay` 开头**，不得污染酒馆宿主。
- `!important` 只允许出现在 `src/styles/host-isolation.css`（专门对抗宿主主题的全局 `!important`），
  且该文件必须被 `style.css` 通过 `@import` 引入。

### 4. 资源与依赖

- **零 CDN**。所有运行时资源随扩展本地提供，禁止 `cdn.jsdelivr` 之类的外链。
- `src/` 下的相对 `import` 与 CSS `@import` 必须全部指向仓库内真实存在的文件，**零断链**。
- CSS `@import` 必须位于所有业务规则之前。
- `src/Worldbook-Editor.js` 中禁止出现 `showModal(`、`2147483647` 这类绕过 Kit 弹层的写法。

### 5. AI 输出安全

- AI 生成结果**绝不直接写入世界书**，必须先进 Diff 预览，由用户确认后才应用。
- 动态内容需转义；高危正则（ReDoS）需拦截；路径需过滤穿越。
- AI 结果必须与来源世界书绑定，防止串写。

## 分支约定

| 分支 | 内容 | 用途 |
|---|---|---|
| `main` | 完整仓库：扩展 + `ui-kit/` 全量 + `test/` | 开发、评审、跑测试 |
| `release` | 仅扩展运行时（14 个文件，约 366 KB） | 分发给酒馆扩展管理器 |

`release` 从 `main` 派生，**只做减法**，不引入 `main` 上不存在的文件。

### 已落地的关键改造（2026-10-21，改动前务必先 `git status` 确认是否仍然成立）

- **Kit 已升级到 v2.6.0**，此前自建的三套临时方案全部退场，改为复用上游能力：
  - 宿主表单隔离 → Kit 内置（`dialog.nvui-tl` + `.nvui-panel` 双载体），
    本扩展的 `src/styles/host-isolation.css` **只剩 `.wbe-chipin` 一条**；
  - 批量选择复选框 → 复用 `.nvui-checkbox`（HTML 写 `class="nvui-checkbox wbe-chk"`，
    `.wbe-chk` 只作事件钩子，**禁止再给它写皮肤**）；
  - 折叠条持久化 → `panel.adoptAccordions()`，状态存 `nvui_state_wbe.accordion`。
  - 对应上游 issue #9 / #10 / #11 均已 CLOSED COMPLETED。
- **折叠条的两个坑**（都踩过）：
  1. 开合必须调 `acc.setOpen()`，不能直接 `toggleClass` —— 前者被 Kit 包装过会落盘；
  2. 任何重绘折叠条的操作（如 `renderSet()`）都必须重新 `adoptAccordions()`，
     否则新节点丢失注册；且 Kit 会重放 createPanel 时的旧快照，要自行记录/还原状态。
- **目录结构**：根目录平铺 → `src/` 子目录 + `src/styles/`。`manifest.json` 的 `js` / `css`
  指向 `src/index.js` / `src/styles/style.css`（ST 按 `/scripts/extensions/<名>/<manifest 字段>`
  加载，支持多级相对路径）。
- **折叠条间距**：工具页根容器曾是 `.wbe-form`（flex + gap 10px），与设置页的普通块级容器
  叠加 Kit 的 `.nvui-acc` margin，导致两页间距 18px vs 8px。现统一用 `.wbe-accs`
  （普通块级），间距完全交给 Kit 的 margin 决定。
- **滚动跳动**：条目页点条目时的跳动源于 `select()` / `goEdit()` 里的
  `scrollIntoView({ block:'nearest' })` —— 它会滚动所有可滚动祖先，把共享的
  `.nvui-panel-body` 拉走 768px，左侧列表跟着跳。现改为 `revealEditTop()`，
  只在单栏模式下按最小必要位移移动该滚动层。

## 提交与推送

- 提交信息用中文，遵循 `feat:` / `fix:` / `test:` / `docs:` / `chore:` 前缀。
- 提交前跑全量：`npm test` + `npm run test:kit` + `npm run test:browser`。
- **推送是外部动作，必须主人明确指示后才做。**
- 代理：git 已配置 `http.https://github.com.proxy = http://127.0.0.1:10808`（仅 github.com）。
  环境里注入的 `http_proxy=127.0.0.1:5xxxx` 不影响 git，但 curl 需要显式 `-x`。

## 验收习惯

改完代码不要只说「改好了」。本项目主人在意的是：

1. 改了什么、为什么这么改（给文件路径与行号）。
2. 哪些测试跑过、结果如何（真实输出，不含糊）。
3. 接下来做什么（明确清单）。
