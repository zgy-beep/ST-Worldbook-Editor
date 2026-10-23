# SillyTavern 世界书编辑器 (ST-Worldbook-Editor)

基于 **SillyTavern NVUI Kit v2.6.0** 的现代世界书（Lorebook / Worldbook）编辑器，以 SillyTavern 标准前端扩展的形式运行。

本扩展不再要求把整段脚本粘贴进酒馆助手的脚本库。它通过 `manifest.json` 声明入口、样式和生命周期钩子，可由 SillyTavern 扩展管理器安装；界面与运行时资源全部随扩展本地提供，不依赖网络 CDN。

当前版本：`0.7.0`。仓库地址：<https://github.com/zgy-beep/ST-Worldbook-Editor>。

## 0.7.0 更新摘要

- **保存为自定义预设**：把当前破限前置 / 后置消息完整另存为命名模板，下拉列表按「内置预设 / 自定义预设」分组；套用与保存都使用独立副本，之后继续编辑不会改到内置常量或已保存模板。
- **同名与删除**：同名自定义预设先显示内联「更新现有 / 取消」，取消不改任何数据；删除自定义预设需内联确认，只删除模板，不影响当前编排。
- **保存校验**：名称 trim 后必填、≤ 40 码点；两区各 ≤ 6 条、role 在对应白名单内、至少一条非空。校验失败只提示，不裁剪或改写当前 `jbPre` / `jbPost`。
- **内置预设**：共 8 个，本次新增「世界书编辑·结构稳健」，**不会默认套用**；默认两区为空，不向请求注入任何破限内容。
- **AI 应用安全不变**：生成结果仍先进入 Diff 预览，用户确认后才写入；结果继续与来源世界书绑定。

---

## 功能特性

- **NVUI Kit v2.6.0 面板规范**：使用本地 `ui-kit/` 提供的 tokens、components 与 `NVUI.createPanel`，支持顶部标签页、移动端底部抽屉、焦点归还与宿主模态让位。
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

### 方式一：扩展管理器安装（推荐）

1. 打开 SillyTavern，进入 **扩展 / Extensions**。
2. 点击 **Install Extension**。
3. 填入本仓库的 Git URL：`https://github.com/zgy-beep/ST-Worldbook-Editor`（需要时可在末尾加 `.git`），确认安装。
4. 刷新页面，在扩展列表中确认「世界书编辑器」已启用。

扩展管理器会读取 `manifest.json` 并按标准扩展流程加载 `src/index.js` 与 `src/styles/style.css`。

> **分支选择**：日常使用推荐 **`release` 分支**，它只保留扩展运行时；需要测试、审计与开发资料时用 **`main` 分支**。
> `release` 包含 `manifest.json`、`LICENSE`、`README.md`、`src/` 下 6 个 JS
> （`index.js`、`runtime.js`、`Worldbook-Editor.js`、`worldbook-api.js`、`ai-prompts.js`、`jb-presets.js`）
> 与 2 个 CSS（`styles/style.css`、`styles/host-isolation.css`），以及 `ui-kit/` 的
> `nvui-api.js`、`tokens.css`、`components.css`。
> 酒馆的扩展管理器原生支持分支切换（扩展卡片上的 **Switch branch**），
> 安装后切到 `release` 即可；开发时切回 `main`。

### 方式二：本地安装（开发 / 调试）

1. 将整个 `ST-Worldbook-Editor` 目录放入 SillyTavern 的第三方扩展目录，例如：
   - `public/scripts/extensions/third-party/ST-Worldbook-Editor/`，或
   - 用户数据目录下对应的 `extensions/` 目录。
2. Windows 开发可用 **Junction** 把本仓库软链到上述目录，便于原地改代码；直接复制目录也可。
3. 刷新 SillyTavern 页面。
4. 在 **扩展** 列表中确认「世界书编辑器」已加载。

### 从旧版单文件脚本迁移

如果之前把 `Worldbook-Editor.js` 全文粘贴在酒馆助手的脚本库中运行：

1. **停用或删除酒馆助手中的旧脚本**，避免出现两个菜单入口或重复面板。
2. 安装并启用本扩展后刷新页面。
3. 首次读取设置时，扩展会自动把旧的 `localStorage` 键 `wbe_settings_v1` 迁移到 SillyTavern 的扩展设置；已有 ST 设置优先，旧设置中的未知字段会保留。

---

## 使用

- **扩展菜单**：点击酒馆输入框旁的魔法棒/扩展菜单，选择 **世界书编辑器**。
- **控制台入口**：在浏览器开发者控制台执行 `__wbeOpen()`。该入口在扩展停用后会被清理。
- **破限自定义预设步骤**：进入「破限」页 → 选内置模板 → 套用 → 按需编辑前置 / 后置消息 → 点「保存为自定义预设」→ 命名保存。保存只写扩展设置，不发送模型请求。
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
| `jbPre` / `jbPost` | 破限前置 / 后置消息数组，元素 `{role, content}`，默认 `[]` |
| `jbCustomPresets` | 用户另存的自定义破限预设，默认 `[]`；元素 `{id, name, pre, post}`，与 `layout` 分开 |
| `jailbreak` / `jbHead` / `jbTail` | 旧版破限字段，读取时迁移到 `jbPre` / `jbPost` 后删除 |

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

## 关于破限提示词

**独立的「破限」标签页**提供两个**可编排的消息列表**，对所有 AI 操作生效：

- **前置区**（`jbPre`）：位于任务之前，可增删、可排序，role 限 `system` / `user` / **模拟已接受**
- **后置区**（`jbPost`）：位于输出契约之前，可增删、可排序，role 限 `system` / `user` / `assistant`

每条消息独立选择 role，可上移 / 下移 / 删除，每区上限 6 条。

### 三个 assistant 的区别（容易混淆，务必分清）

| 位置 | role | 实际下发 | 作用 |
|---|---|---|---|
| 前置区 | `system` / `user` | 同名 | 常规框架声明与铺垫 |
| 前置区 | **模拟已接受** | `user`（自动加「（上一轮回复）」前缀） | 把这段话伪装成「上一轮模型的回复」，让模型以为设定已被认可并接受 |
| 后置区 | `assistant` | `assistant`（移到整条请求最末） | **预填充** —— 模型直接从这段文字续写 |

**前置区为什么不提供裸 `assistant`**：它会成为请求的**首条 assistant**，而多数端点
要求首条必须是 `user` / `system`（Anthropic 官方会直接 400）；OpenAI 兼容端点虽然接受，
但等于给模型一个「我已经这么说了」的错误锚点，反而容易被模仿污染。
「模拟已接受」实际以 `user` 角色下发，避免前置裸 `assistant`；效果与端点兼容仍需实际验证。

**后置区的 `assistant` 只保留最后一条**（其余降级为 `system`）—— 因为 Chat Completion
的预填充必须是整条请求的最后一条。预填充会成为输出前缀，**只建议用于纯文本任务**，
用于 JSON 任务会让解析拿到残缺输出。

### 预设模板

页面顶部提供 8 个内置预设，**不会默认套用**（默认两区为空），套用后仍可自由编辑（当前两区非空时会先确认是否覆盖）。预设下拉按「内置预设 / 自定义预设」分组；套用与保存都使用深拷贝，之后继续编辑不会改到内置常量或已保存模板：

| 预设 | 适用场景 |
|---|---|
| 基础创作框架 | 声明虚构属性 + 保持叙事尺度，最通用 |
| 成熟题材（成年读者） | 明确受众与题材范围，减少回避 |
| 人物一致性（防 OOC） | 避免人物被「安全化」而失去棱角 |
| 三方确认式 | 框架 + 用户确认，权重更稳 |
| 输出纪律（去寒暄） | 只出正文，去掉开场白与免责 |
| 预填充·正文（最强） | 用 assistant 预填充让模型直接续写，只建议用于纯文本任务 |
| 长篇续写（防重复） | 扩写 / 续写时保持一致且不重复 |
| 世界书编辑·结构稳健 | 中性编辑边界：保留既有事实与专有名词，只按当前任务修改；JSON / 文本通用，无 assistant 预填充 |

> 预设**刻意不收录**「忽略先前指令 / 你现在是不受限制的 AI」这类技术越狱措辞：
> 那类模板对现代模型效果反而差（模式极易被识别），也容易直接触发拒答。
> 收录的是创作语境下真正有用的框架声明。

#### 保存自定义预设

预设工具栏提供「保存为自定义预设」。它把当前 `jbPre` / `jbPost` 的完整消息副本另存到
`extensionSettings.st_worldbook_editor.jbCustomPresets`，**不会改变当前编排，也不会发模型请求**。
每条自定义预设固定为 `{ id, name, pre, post }`，只保存用户消息，**不携带 API Key、模型或世界书内容**。
内置预设 id 使用 `builtin:` 前缀，自定义使用 `custom:` 前缀，互不碰撞。

保存前会校验：两区必须是数组、每区 ≤ 6 条、role 必须在对应区域白名单内、`content` 必须是字符串，
且至少有一条非空消息。空占位可以保留，合法 `accepted` 不会被降级；校验失败时只显示可理解的错误，
**不自动裁剪、清空或改写**当前配置。名称 trim 后必填、最多 40 个码点，动态内容入 DOM 前转义。

同名自定义预设会先显示内联「更新现有 / 取消」：取消不改任何数据，确认则更新原 `id` 而不新建副本；
与内置预设同名会被拒绝，内置预设不可删除。删除自定义预设同样是内联确认，只删除保存的模板，
不影响当前 `jbPre` / `jbPost`。

### 为什么是消息列表而不是一个文本框

单条文本只能产出一个 `system` 块；拆分成分角色的消息列表后，可以把框架声明、铺垫与确认分开编排，便于逐条调整。
（框架声明 + 免责铺垫 + 三方确认等）。同时长上下文里模型对**开头**与**结尾**的注意力
最强、中段最弱（lost in the middle），所以两侧各留一个可编排区：

- **前置区**设定基线。放在任务之后会被读成「对刚才那个任务的补充要求」，
  与任务指令冲突时反而压制任务；用 `user` 口吻下达则权重低于 `system`。
- **后置区**在临近输出位置再强调一次，对抗中段衰减。
- **输出契约是最后一条指令**：它是格式硬约束，排在它后面的任何指令都会削弱
  JSON／正文的稳定性。因此后置区固定在契约**之前**；`assistant` 预填充不是指令，
  会按 API 约束排到契约与重试提醒之后。

实际消息顺序：

```
1. 前置消息（按你的顺序，逐条）
2. system: 任务说明（含创作者的统一设定与文风）
3. user:   任务内容
4. 后置消息（按你的顺序，逐条）
5. system: 输出契约
6. system: 重试提醒（仅 json 且重试时）
7. assistant: 预填充（仅当后置区存在 assistant 时，固定在最末）
```

空消息会被自动丢弃；非法 role（如 `tool`、前置区的裸 `assistant`）会降级为 `system`
而不是整条丢弃。前置区的「模拟已接受」是**合成角色**，会落成 `user` 角色下发，
不会出现在请求里当 `assistant`。

### 迁移

破限字段经历三代，`runtime.getSettings()` 会自动顺着迁移并删除旧键：

```
jailbreak（单条） → jbHead / jbTail（首尾两段） → jbPre / jbPost（消息数组）
```

迁移只在新数组为空时补位，不会覆盖你已经在新版里编辑过的内容。

### 已知限制

- **工具页按钮行间距**：工具页两行按钮当前上下间距为 `0px`，属于本插件业务布局的已知问题，待修复；不影响功能。
- **Kit 上游问题**：下拉 `optgroup` 配色、隐藏控件的焦点处理、Esc 关闭底层面板已反馈上游
  [#12](https://github.com/zgy-beep/ui-kit/issues/12) /
  [#13](https://github.com/zgy-beep/ui-kit/issues/13) /
  [#14](https://github.com/zgy-beep/ui-kit/issues/14)，本版本内置 Kit `2.6.0`，**不声称已修复**，也未新增 Kit 拉取或升级；
  不同 OS / 浏览器的原生下拉与焦点表现可能不同，本扩展不承诺所有平台一致。
- **后端会按接口改写 role**：相邻同角色消息可能被合并；末尾 `system` 在 Gemini 类接口上
  会转成 `user`。因此不要把关键约束只押在「末尾是一条 system」上。
- 破限效果取决于模型本身的安全训练强度，本扩展只提供表达能力与结构透明，不保证结果。

### assistant 预填充

**后置区**的 role 下拉额外提供 `assistant`，用作**预填充**（prefill）——模型会从这段文本
**续写**，而不是从零开始生成；这是社区常说的「预填充 / 伪造已同意」，实际效果仍取决于模型与端点。

两条硬约束（实现已处理，但你需要知道）：

1. **预填充必须位于整条请求的最后**。Chat Completion 的 API 约定：最后一条 `assistant`
   才是 prefill。所以有 assistant 时，顺序变成：

   ```
   前置消息 → 任务 system → 任务 user → 后置消息（不含 assistant）
   → 输出契约 → 重试提醒 → assistant 预填充
   ```

   契约仍是最后一条**指令**（被任何指令排到后面都会削弱格式稳定性）；`assistant` 是
   「已生成的回答开头」，不算指令，所以两者不冲突。

2. **只取最后一条 `assistant`**。多条时前面的会降级为 `system` 并保留在原位置，
   避免出现「中间夹着 assistant」这种 API 不认的结构。

**前缀拼接**：`generateRaw` 只返回**续写部分**，不含 prefill 本身。扩展会自动把
prefill 拼回返回值再解析；若接口忽略了 prefill（返回值已包含其内容），则不会重复拼接。

> **JSON 任务慎用**：预填内容会成为输出的前缀。例如填 `[` 会强制模型输出数组，
> 填 `{"` 则强制对象——如果你的任务类型不固定，解析可能失败。纯文本任务（润色 / 扩写）
> 没有这个风险，推荐先用在那里。


局部润色保留纯文本输出；结构化任务会提取有效 JSON，过滤模型思考块，并在格式错误时自动重试一次。

AI 生成结果不会直接写入世界书，必须由用户在 Diff 预览中确认后应用。

## 真实 AI 请求与上游错误（FAQ）

- **测试现状**：此前两次以合成输入发起的真实 AI 请求均未成功，文本诊断返回 `Service Unavailable`。后续日志显示上游为 `playground_executor_unavailable`，说明请求所依赖的第三方接口服务未能连上其 Google AI Studio Playground 浏览器执行器；这属于上游执行器连接问题，不涉及本机模型名、接口地址或密钥。
- **`Service Unavailable` 是谁的问题？** 优先检查第三方接口服务及其执行器连接；扩展侧只负责拼装请求、解析返回并进入 Diff，不会把上游错误伪装成成功。
- **会影响哪些功能？** 保存 / 更新 / 删除自定义预设、设置持久化、Diff 预览与来源绑定都是本地逻辑，已有测试覆盖；真实生成质量与破限效果无法在本次环境中验证。
- **能保证破限或生成效果吗？** 不能。效果取决于模型与接口服务，本扩展只提供可编排的消息结构和透明的请求顺序。
- **默认会注入模板吗？** 不会。`jbPre` / `jbPost` 默认都是 `[]`，只有用户主动套用或编辑后才改变；自定义预设也只保存用户消息，不携带密钥、模型或世界书内容。

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
│  ├─ jb-presets.js          # 破限预设/自定义保存校验纯函数（零运行时）
│  └─ styles/
│     ├─ style.css           # 业务样式：导入 Kit 令牌与组件（零 !important）
│     └─ host-isolation.css  # 宿主样式隔离层（唯一允许 !important 的文件）
├─ ui-kit/                   # NVUI Kit v2.6.0 本地运行时与样式资产（自包含独立项目）
└─ test/                     # 项目测试与浏览器端到端冒烟
```

`manifest.json` 的 `js` / `css` 指向 `src/` 下的子路径 —— SillyTavern 按
`/scripts/extensions/<扩展名>/<manifest 字段值>` 加载，支持多级相对路径。

### 宿主样式隔离层

`src/styles/host-isolation.css` 是全项目**唯一**允许使用 `!important` 的文件。

> **v2.6.0 起已大幅收窄**：`.nvui-input` / `select` / `textarea` / `option` 的宿主隔离
> 由 NVUI Kit 自己内置（`dialog.nvui-tl` + `.nvui-panel` 双载体，[issue #9](https://github.com/zgy-beep/ui-kit/issues/9) 已闭环），
> 本扩展不再重复实现。

现在该文件只负责 Kit 按设计覆盖不到的**业务自有控件** `.wbe-chipin`（关键词输入框）：

- 它不是 `.nvui-input`，Kit 的隔离层不会命中它；
- 它**没有 `type` 属性**，恰好落进宿主主题的 `input:not([type])` 规则，
  浅色主题下会变成一块突兀的深色长条（实测 `rgb(46,46,52)`）；
- 它在 CSS 里的语义本就是「透明地嵌在 `.wbe-chips` 容器里」（底色由容器提供），
  隔离层把它显式还原为透明。

选 `!important` 的原因：宿主声明本身带 `!important`，只有同样带 `!important`
且特异性更高的规则才能赢。这是本文件存在的唯一理由。

### 折叠条开合状态持久化

v2.6.0 起交给 Kit 的 `panel.adoptAccordions()`（[issue #11](https://github.com/zgy-beep/ui-kit/issues/11) 已闭环）：

- 折叠条带稳定 `id`（`wbe-acc-api` / `-style` / `-find` / `-probe` / `-health`），
  Kit 直接用节点 id 作为存储键，DOM 顺序变化不会错位；
- 状态存在 Kit 自己的 `nvui_state_wbe.accordion` 里，走 `runtime.layoutStorage` 落盘；
- `adoptAccordions` 默认 `bind: false`（不接管点击，避免与扩展的委托监听形成双重 toggle），
  开合仍由扩展的 `click` 委托负责，但它改调 `setOpen()` —— 该方法被 Kit 包装过，会触发落盘；
- 设置页因切换 API 模式会整页重绘，`renderSet()` 在重绘后重新 `adoptAccordions()`，
  并记录 / 还原本地开合状态（否则 Kit 会重放 createPanel 时的旧快照，盖掉用户当前状态）。

### 批量选择复选框

直接复用 Kit v2.6.0 的 `.nvui-checkbox`（[issue #10](https://github.com/zgy-beep/ui-kit/issues/10) 已闭环）：

```html
<input type="checkbox" class="nvui-checkbox wbe-chk">
```

16px 小方块、元素级宿主隔离（`.nvui-checkbox[type="checkbox"]`，0,2,0）、
支持 `:checked` / `:indeterminate` / 焦点环 / `disabled`。
`.wbe-chk` 仅保留为业务事件委托的钩子，扩展不再重画皮肤。

### 运行时接口

`src/runtime.js` 导出 `createRuntime(options)`，返回：

```js
{
  getSettings(),   // 实时读取 extensionSettings，首次使用时初始化/迁移
  saveSettings(),  // 调用宿主 saveSettingsDebounced
  getHelper(),     // 实时读取 window.TavernHelper，未检测到返回 null；不缓存、不硬编码安装目录
  layoutStorage,   // { get(key), set(key, value), remove(key) }
  NVUI,            // 本地 NVUI Kit 2.6.0 实例
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
- NVUI Kit：`2.6.0`，随扩展本地提供。
- 不新增网络 CDN 依赖。
- 酒馆助手不是 `manifest.dependencies` 中的硬编码扩展目录依赖：本扩展在运行时检查 `window.TavernHelper`，避免酒馆助手安装目录改名后失效。

---

## 开发与测试

扩展自身行为测试（Node 内置 test runner，零外部测试框架）：

```bash
npm test
```

Kit 规范守护测试（上游 Kit 自包含套件）：

```bash
npm run test:kit
```

浏览器端到端冒烟（零依赖设计，需要本机已有 Playwright / `playwright-core` 与 Chrome）：

```bash
PLAYWRIGHT_MODULE_PATH="/path/to/playwright-core" \
CHROME_PATH="/path/to/chrome" \
npm run test:browser
```

可选 `ST_PUBLIC_DIR` 指向 SillyTavern 的 `public` 目录。测试在隔离的本地页面中模拟宿主与酒馆助手，不调用真实模型，也不读写现有世界书。

测试覆盖：标准扩展入口、设置迁移、酒馆助手桥接、AI 提示词与 JSON 解析、自定义破限预设的保存 / 更新 / 删除 / 持久化、桌面 / 移动端布局、宿主模态让位、布局持久化与停用 / 重新启用生命周期。

发布前应在开发机跑完以上三条命令，并以当次真实输出为准；README 不记录某次会话的日志文件或通过数。

### 审计与设计文档

以下文档只在 `main` 分支提供（`release` 只含运行时，不包含 `docs/`），因此使用指向 `main` 的绝对链接：

- [破限预设验收记录](https://github.com/zgy-beep/ST-Worldbook-Editor/blob/main/docs/jailbreak-preset-acceptance.md)
- [破限模块设计](https://github.com/zgy-beep/ST-Worldbook-Editor/blob/main/docs/jailbreak-module-design.md)
- [Kit 集成审计](https://github.com/zgy-beep/ST-Worldbook-Editor/blob/main/docs/kit-integration-audit.md)

设计文档可能包含尚未实现的规划（例如破限编排预览、预设级撤销与导入导出）；已实现范围以本 README 与源码为准。

### 分支约定

| 分支 | 内容 | 用途 |
|---|---|---|
| `main` | 完整仓库：扩展 + `ui-kit/` 全量 + `test/` + `docs/` | 开发、评审、跑测试 |
| `release` | 仅扩展运行时（含 `src/jb-presets.js`） | 分发给酒馆扩展管理器 |

`release` 分支从 `main` 派生，只做减法，不引入任何 `main` 上不存在的文件。
在 `main` 上改动运行时代码后，需按运行时 allowlist 同步到 `release`：

```bash
git checkout release
git restore --source main --staged --worktree -- manifest.json LICENSE README.md \
  src/index.js src/runtime.js src/Worldbook-Editor.js \
  src/worldbook-api.js src/ai-prompts.js src/jb-presets.js \
  src/styles/style.css src/styles/host-isolation.css \
  ui-kit/nvui-api.js ui-kit/tokens.css ui-kit/components.css ui-kit/LICENSE
git commit -m "chore: 同步运行时代码到 release 分支"
```

`docs/`、`test/` 与 `ui-kit/` 的测试资产不同步到 `release`；`LICENSE` 与 `ui-kit/LICENSE` 必须一并同步，不能遗失许可。

---

## 许可证

MIT。
