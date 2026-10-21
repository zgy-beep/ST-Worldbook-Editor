# SillyTavern 世界书编辑器 (ST-Worldbook-Editor)

基于 **SillyTavern NVUI Kit v2.5.0** 的现代世界书（Lorebook / Worldbook）编辑器，以 SillyTavern 标准前端扩展的形式运行。

本扩展不再要求把整段脚本粘贴进酒馆助手的脚本库。它通过 `manifest.json` 声明入口、样式和生命周期钩子，可由 SillyTavern 扩展管理器安装；界面与运行时资源全部随扩展本地提供，不依赖网络 CDN。

当前版本：`0.6.0`。

> 当前仓库仍处于本地修改阶段，尚未推送到公开仓库。扩展目录结构已经符合标准扩展规范；发布后即可直接通过扩展管理器的 Git URL 安装。在未发布前，请使用下方「本地安装」方式。

---

## 功能特性

- **NVUI Kit v2.5.0 面板规范**：使用本地 `ui-kit/` 提供的 tokens、components 与 `NVUI.createPanel`，支持顶部标签页、移动端底部抽屉、焦点归还与宿主模态让位。
- **世界书条目全生命周期管理**：新建、删除、编辑、实时预览、字数与 Token 估算；支持常驻、选择性触发、向量化等条目机制。
- **批量操作**：多选、批量启用/禁用、批量分组、调整顺序、深度与触发概率。
- **双向数据兼容**：兼容 SillyTavern 原生条目的 `disable`、`constant`、`selective`、`vectorized`、数值型 `position`，并在需要时映射到新的 `strategy` / `position` 结构。
- **拖拽排序**：通过 `displayIndex` / `display_index` 与 `order` 维护条目顺序。
- **世界书体检**：孤岛设定、关键词重叠、触发仿真、潜在冲突扫描。
- **AI 辅助**：对选中条目或整本世界书执行扩写、重写、润色、拆分与冲突检查；结果先进入 Diff 预览，不会自动写入。
- **安全加固**：动态内容转义、危险正则拦截、AI 结果与来源世界书绑定、路径穿越过滤、保存互斥与撤销。
- **本地化运行时**：Kit、样式、提示词拼装与解析模块均为扩展本地文件，无需额外网络请求。

---

## 安装

### 前置依赖

请先在 SillyTavern 中安装并启用 **酒馆助手（Tavern Helper / JS-Slash-Runner）**。

本扩展通过运行时读取 `window.TavernHelper` 检查酒馆助手是否可用，不依赖固定安装目录名，因此酒馆助手文件夹改名不会导致本扩展失效。若未检测到酒馆助手，扩展会给出提示，而不会在未说明的情况下静默失败。

### 方式一：扩展管理器安装（仓库发布后）

1. 打开 SillyTavern，进入 **扩展 / Extensions**。
2. 点击 **Install Extension**。
3. 填入本仓库的 Git URL，确认安装。
4. 刷新页面，在扩展列表中确认「世界书编辑器」已启用。

扩展管理器会读取 `manifest.json` 并按标准扩展流程加载 `src/index.js` 与 `src/styles/style.css`。

> **精简安装**：本仓库的 `main` 分支同时包含开发用的测试与文档（约 2.1 MB）。
> 若只需要运行时，可让扩展管理器改拉 **`release` 分支** —— 该分支只保留扩展运行必需的
> 文件（约 370 KB）：`manifest.json`、`src/` 下的 5 个业务模块与 2 个样式文件、
> `LICENSE`、`README.md`，以及 `ui-kit/` 下的 `nvui-api.js` / `tokens.css` / `components.css`。
> 酒馆的扩展管理器原生支持分支切换（扩展卡片上的 **Switch branch**），
> 安装后在扩展列表点该按钮切到 `release` 即可；开发时切回 `main`。

### 方式二：当前本地安装（仓库尚未推送）

1. 将整个 `ST-Worldbook-Editor` 目录放入 SillyTavern 的第三方扩展目录，例如：
   - `public/scripts/extensions/third-party/ST-Worldbook-Editor/`，或
   - 用户数据目录下对应的 `extensions/` 目录。
2. 刷新 SillyTavern 页面。
3. 在 **扩展** 列表中确认「世界书编辑器」已加载。

### 从旧版单文件脚本迁移

如果之前把 `Worldbook-Editor.js` 全文粘贴在酒馆助手的脚本库中运行：

1. **停用或删除酒馆助手中的旧脚本**，避免出现两个菜单入口或重复面板。
2. 安装并启用本扩展后刷新页面。
3. 首次读取设置时，扩展会自动把旧的 `localStorage` 键 `wbe_settings_v1` 迁移到 SillyTavern 的扩展设置；已有 ST 设置优先，旧设置中的未知字段会保留。

---

## 使用

- **扩展菜单**：点击酒馆输入框旁的魔法棒/扩展菜单，选择 **世界书编辑器**。
- **控制台入口**：在浏览器开发者控制台执行 `__wbeOpen()`。该入口在扩展停用后会被清理。
- **AI 应用流程**：生成结果先显示 Diff；只有点击应用后才会写回世界书。

---

## 设置与存储

扩展设置保存在 SillyTavern 的 `extensionSettings` 中，命名空间为：

```text
st_worldbook_editor
```

业务字段与原单文件脚本的 CFG 兼容：

| 字段 | 说明 |
| :--- | :--- |
| `mode` | `st` 使用酒馆当前连接；`custom` 使用自定义接口 |
| `apiurl` / `key` / `model` | 自定义接口信息 |
| `temp` / `maxTokens` | 生成参数 |
| `style` | 统一的设定与文风要求 |
| `presets` | 用户保存的指令预设 |
| `sort` / `flt` / `groupFlt` / `tpl` | 列表排序、筛选与新建模板 |
| `jailbreak` | 用户自填的破限提示词字段，默认空字符串 |

面板布局不混入业务字段，单独保存在同一命名空间的 `layout` 对象中，由 NVUI Kit 的 StorageAdapter 读写。

### 设置迁移

- 首次读取时检查旧键 `wbe_settings_v1`。
- 迁移遵循「已有 ST 设置优先」：同名业务字段以 ST 设置为准，旧设置只补空缺。
- 迁移不会删除 ST 设置中已有的未知字段，也会保留旧设置中未被识别的字段。
- 只写入 `st_worldbook_editor` 自身命名空间，不修改其它扩展的设置。
- 写入成功后清理旧键，避免重复迁移。

### 重置

运行时提供 `resetSettings()`，只清空本扩展自己的命名空间及旧键 `wbe_settings_v1`：

- 不调用 `localStorage.clear()`；
- 不删除其它扩展的设置；
- 不遍历、不删除任意其它 `wbe_*` 键。

### API Key 提示

若使用自定义接口并在 `key` 中填写密钥，该值会以明文形式保存在 SillyTavern 的扩展设置（服务器端设置文件）中。请勿在公共设备或共享实例上保存敏感密钥。

---

## 关于 AI 与破限字段

AI 页在修改指令之后提供「破限提示词（可选）」输入框，对应 `jailbreak` 字段，默认留空。

用户填写的内容会在任务之后、输出格式要求之前追加到每次 AI 请求，适用于批量生成、关键词推荐、位置推荐、冲突检查和局部润色。留空时不追加。局部润色保留纯文本输出；结构化任务会提取有效 JSON，过滤模型思考块，并在格式错误时自动重试一次。

AI 生成结果不会直接写入世界书，必须由用户在 Diff 预览中确认后应用。

---

## 目录结构

```text
ST-Worldbook-Editor/
├─ manifest.json              # 标准扩展清单：入口、样式、最低 ST 版本、生命周期钩子
├─ src/
│  ├─ index.js               # ES Module 入口：APP_READY 启动、菜单、依赖检查、清理
│  ├─ runtime.js             # createRuntime：设置、迁移、布局存储、TavernHelper 访问
│  ├─ Worldbook-Editor.js    # 编辑器业务与界面，导出 initializeEditor(runtime)
│  ├─ worldbook-api.js       # 世界书读写兼容层（酒馆助手新旧接口）
│  ├─ ai-prompts.js          # AI 消息拼装与 JSON 解析
│  └─ styles/
│     ├─ style.css           # 业务样式：导入 Kit 令牌与组件（零 !important）
│     └─ host-isolation.css  # 宿主样式隔离层（唯一允许 !important 的文件）
├─ ui-kit/                   # NVUI Kit v2.5.0 本地运行时与样式资产（自包含独立项目）
└─ test/                     # 项目测试与浏览器端到端冒烟
```

`manifest.json` 的 `js` / `css` 指向 `src/` 下的子路径 —— SillyTavern 按
`/scripts/extensions/<扩展名>/<manifest 字段值>` 加载，支持多级相对路径。

### 宿主样式隔离层

`src/styles/host-isolation.css` 是全项目**唯一**允许使用 `!important` 的文件，
职责单一：夺回宿主主题夺走的表单控件配色。

某些酒馆第三方主题会用「元素选择器 + `!important`」重写全局表单控件：

```css
input[type="text"], input:not([type]), textarea:not([type="search"]) {
  background-color: var(--ui-color-sec) !important;   /* 宿主主题色 */
}
select {
  background-color: var(--ui-color-sec) !important;
  border: 1px solid ... !important;
}
```

Kit 的 `.nvui-input` 是裸类选择器（特异性 0,1,0），赢不过宿主的 `!important`。
结果是面板切到浅色主题后，输入框背景仍是宿主深色，而文字颜色仍走 Kit 的
`--nvui-text`（浅色主题下是深色），最终呈现「深底 + 深字」，完全看不清。

隔离层用 `#wbe-overlay` 作用域 + `!important` 定向夺回控制权：只影响本扩展面板，
只恢复 Kit 组件自己的 token 取值，浅色 / 深色主题自动跟随。

> **上游跟进**：NVUI Kit 的「§8 SillyTavern 宿主兼容红线」目前只隔离了 checkbox，
> 未覆盖 `input` / `select` / `textarea`，且 kit 没有 `select option` 的皮肤。
> 已向上游提交 issue 请求根治：
> [zgy-beep/ui-kit#9 — 宿主主题以 !important 重写全局表单控件，导致 kit 表单组件失去 token 配色](https://github.com/zgy-beep/ui-kit/issues/9)

### 运行时接口

`src/runtime.js` 导出 `createRuntime(options)`，返回：

```js
{
  getSettings(),   // 实时读取 extensionSettings，首次使用时初始化/迁移
  saveSettings(),  // 调用宿主 saveSettingsDebounced
  getHelper(),     // 实时读取 window.TavernHelper，未检测到返回 null；不缓存、不硬编码安装目录
  layoutStorage,   // { get(key), set(key, value), remove(key) }
  NVUI,            // 本地 NVUI Kit 2.5.0 实例
  resetSettings(), // 只清本扩展命名空间与旧 wbe_settings_v1
}
```

`layoutStorage` 已按 NVUI Kit 源码核对：Kit 内部持久化使用 `get` / `set`，清理时使用 `delete`（缺失时回退 `set(key, null)`）。本实现对外暴露契约要求的 `remove`，同时提供不可枚举的 `delete` 别名，且 `set(key, null)` 也会执行删除。

`src/Worldbook-Editor.js` 由 `src/index.js` 以 `initializeEditor(runtime)` 方式导入并调用，返回 `{ open, destroy }`；它不再自行执行 IIFE，也不自行挂载扩展菜单。

---

## 兼容性

- 最低 SillyTavern 客户端版本：`1.17.0`（`manifest.json` 的 `minimum_client_version`）。`activate` / `disable` 等 manifest 生命周期钩子从 1.17.0 开始提供，与本文使用的生命周期一致。
- 生命周期使用标准扩展钩子：`activate` → `init`，`disable` → `onDisable`。
- 启动等待 `APP_READY`；如果扩展在 `APP_READY` 之后才加载，事件源会补发该事件。清理后再次初始化可重新创建菜单与面板。
- NVUI Kit：`2.5.0`，随扩展本地提供。
- 不新增网络 CDN 依赖。
- 酒馆助手不是 `manifest.dependencies` 中的硬编码扩展目录依赖：本扩展在运行时检查 `window.TavernHelper`，避免酒馆助手安装目录改名后失效。

---

## 开发与测试

项目测试由维护者在本地运行：

```bash
npm test
```

浏览器冒烟测试需要本地 Playwright 与 SillyTavern 静态资源：

```bash
npm run test:browser
```

可通过 `PLAYWRIGHT_MODULE_PATH` 指定已安装的 `playwright` 或 `playwright-core`，通过 `CHROME_PATH` 指定 Chrome 可执行文件，通过 `ST_PUBLIC_DIR` 指定 SillyTavern 的 `public` 目录。测试在隔离的本地页面中模拟宿主与酒馆助手，不调用真实模型或读写现有世界书。

Kit 规范守护测试：`npm run test:kit`。

测试覆盖标准扩展入口、设置迁移、酒馆助手桥接、AI 提示词与 JSON 解析、桌面/移动端布局、宿主模态让位、布局持久化与停用/重新启用生命周期。

### 分支约定

| 分支 | 内容 | 用途 |
|---|---|---|
| `main` | 完整仓库：扩展 + `ui-kit/` 全量 + `test/`（约 2.1 MB） | 开发、评审、跑测试 |
| `release` | 仅扩展运行时（约 370 KB） | 分发给酒馆扩展管理器 |

`release` 分支从 `main` 派生，只做减法，不引入任何 `main` 上不存在的文件。
在 `main` 上改动运行时代码后，需同步到 `release`：

```bash
git checkout release
git checkout main -- manifest.json LICENSE README.md \
  src/index.js src/runtime.js src/Worldbook-Editor.js \
  src/worldbook-api.js src/ai-prompts.js \
  src/styles/style.css src/styles/host-isolation.css \
  ui-kit/nvui-api.js ui-kit/tokens.css ui-kit/components.css
git commit -m "chore: 同步运行时代码到 release 分支"
```

---

## 许可证

MIT。
