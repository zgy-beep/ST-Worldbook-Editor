# 破限模块交互与实施设计（评审稿）

> 状态：设计稿 + 本轮实施记录。2026-10-22 已落地“保存自定义预设 / 同名更新 / 删除 / 中性内置模板”（见 6.3、11.1）；
> 其余 `【提议】` 项仍未实施。本轮不改 `ui-kit/`，未提交/推送。
> 范围：现有 `#wbe-pane-jb` 破限页的交互、编排预览、本地校验、预设语义、数据兼容与验收。
> 非目标：不新增规避安全机制的文案、不承诺破限效果、不联网验证提供商行为；真实宿主测试由另一 DSH 接续。
> 约定：`【现状】` 为已有实现，`【提议】` 为尚未实现的建议，`【本轮】` 为已落地变更。

## 1. 设计目标

【提议】把破限页从“两个可编辑的 JSON 数组”推进到“用户能看懂、能控制、能自查的提示词编排器”：

1. **可理解**：看到每条配置最终的角色、位置，以及 `accepted`、预填充、空消息、非法 role 的处理结果。
2. **可控**：增删、排序、套用预设都不静默覆盖；破坏性操作说明范围，并有一次撤销机会。
3. **可验证**：纯本地校验，不访问密钥、不请求模型、不读世界书；同时声明“校验通过 ≠ 端点接受”。
4. **单一事实源**：预览与真实发送共用 `src/ai-prompts.js` 的纯函数，UI 不复制 `normalize` / `build`。
5. **克制**：不改变 `jbPre` / `jbPost` 的存储形状、默认值、迁移链与发送顺序。

### 1.1 本扩展规则与端点行为分开

| 类别 | 内容 | 证据 | 预览能否承诺 |
|---|---|---|---|
| 扩展规则 | 前置 `system/user/accepted`；后置 `system/user/assistant` | `src/ai-prompts.js:13-16` | 能 |
| 扩展规则 | `accepted` → `user`，加 `（上一轮回复）` 前缀 | `src/ai-prompts.js:56-59` | 能 |
| 扩展规则 | 只取最后一条有效 `assistant` 作预填充，其余降级 `system` 留原位 | `src/ai-prompts.js:121-132` | 能 |
| 扩展规则 | 空内容丢弃；非法 role 降级 `system`，不丢内容 | `src/ai-prompts.js:44-55` | 能 |
| 扩展规则 | 契约在后置消息之后（最后一条格式指令）；重试提醒是其条件补充；预填充在最后 | `src/ai-prompts.js:140-144` | 能 |
| UI 规则 | 每区最多 6 条；只在新增按钮处限制，发送层不截断 | `src/Worldbook-Editor.js:1479-1483` | 能显示，不能替发送层保证 |
| 端点行为（待验证） | 首条是否允许 `assistant`、相邻同角色是否合并、末尾 `system` 是否转 `user`、是否尊重预填充 | 仅代码注释与 README 陈述，未实测 | **不能**，只能标“待验证” |

【现状】README 205-207 把“后端会按接口改写 role”写成通用事实，`Worldbook-Editor.js:1167-1170` 也把端点约束写成结论。本文不据此推导 provider 定律；预览统一写“按本扩展拼装规则”。

## 2. 现状与证据

### 2.1 已具备

- 【现状】独立破限页：`TABS` 含 `jb`（`src/Worldbook-Editor.js:54-60`），构建时一次性挂载（`:1690`），切页不重建（`test/browser-smoke.mjs:247-251`）。
- 【现状】两个数组默认空（`src/runtime.js:29-31`）；元素深一层克隆，避免冻结引用（`:52-58`）。
- 【现状】消息卡片 role/排序/删除/文本域（`Worldbook-Editor.js:1104-1133`）；每区 6 条上限（`:1479-1483`）；增删改排（`:1479-1512`）。
- 【现状】发送语义集中在 `buildMessages`（`ai-prompts.js:100-147`），业务只调用一次（`Worldbook-Editor.js:432`）；预填充回拼在 `:433-445`。
- 【现状】迁移链 `jailbreak` → `jbHead/jbTail` → `jbPre/jbPost`，只补空数组（`runtime.js:211-234`；测试 `test/runtime.test.mjs:32-52`）。
- 【现状】样式已限定 `#wbe-overlay`（`src/styles/style.css:163-198`）；UI 契约检查作用域、令牌、零 CDN（`test/ui-contract.test.mjs:23-35`、`:57-61`）。

### 2.2 现状问题

- **P1 · 没有真实预览。** `buildMessages` 只在 `Worldbook-Editor.js:432` 被调用，破限页不消费结果，只有静态文字（`:1165-1171`）。用户看不到 `accepted` 变 `user`、哪条 `assistant` 胜出、空消息是否发送。
- **P2 · 静态顺序不准确。** `Worldbook-Editor.js:1167` 把重试列进固定顺序，但重试只在 JSON 失败后追加（`ai-prompts.js:142`）；它写“契约仍是最后一条指令”，而重试在契约后、预填充前（`:141-144`）。`AGENTS.md:109` 的“契约永远压轴”与 README 174-175 同样过绝对。准确说法：**契约是后置消息之后的最后一条格式指令；重试提醒是同一格式约束的条件补充；有预填充时，预填充是最后一条消息。** `Worldbook-Editor.js:1167-1170` 与 README 205-207 还把端点行为写成结论，统一降级为“待验证”。
- **P3 · 摘要只数非空内容。** `refreshJbSum` 只统计 `content.trim()`（`Worldbook-Editor.js:1091-1097`），卡片却渲染所有行（`:1134-1140`），出现“摘要未设置、下面却有 3 张空卡”的错位；也不报超限、降级、忽略、JSON 预填充风险。发送层不检查 6 条上限。
- **P4 · 结构操作丢焦点/滚动。** `Worldbook-Editor.js:1098-1103` 的 `renderJb` 整块 `html()`；`jbmove`/`jbdel` 不恢复焦点（`:1492-1512`），只有 `jbadd` 聚焦最后（`:1487-1490`）。键盘与读屏用户移动中间一条后会失去位置。
- **P5 · 预设破坏性且语义不全。** `Worldbook-Editor.js:1453-1468` 的套用整体替换两数组；是否确认只看非空内容（`:1457-1458`），空占位行被静默丢弃；原生 `confirm`、无撤销；清空同样（`:1469-1478`）。`jbPresets()` 实际 7 个（`:1007-1075`），README 149 写“6 个”。
- **P6 · 异常数据可致整页构建失败。** `Worldbook-Editor.js:1090` 的 `jbList` 直接返回配置，`refreshJbSum` 调 `.filter`（`:1094`）；`jbPre` 是对象/字符串时构建抛错。`fillDefaults` 只补 `undefined`，不校验类型（`runtime.js:185-193`）。role 下拉无未知项（`:1107-1111`），浏览器把无匹配项显示成第一项 `system`，但配置仍是 `tool`，直到用户改下拉；发送时才降级（`ai-prompts.js:51-55`）。
- **P7 · 保存结果不可见。** `saveCfg` 调用 `runtime.saveSettings()` 但不检查保存结果（`Worldbook-Editor.js:70`）；宿主无保存函数时只 `warn`（`runtime.js:123-126`）。页面不能诚实显示“已保存到磁盘”。列为 P1。

## 3. 用户流程与信息架构

### 3.1 主流程

1. 打开破限页，先看“附加消息 N 条 / 忽略 M 条 / 警告 K 条”摘要。
2. “编排”视图选预设（只改提示）或直接编辑前置/后置。
3. 切“预览”，选“结构化 JSON / 纯文本”，看编号后的实际角色、顺序与转换。
4. 读本地校验，点问题项跳回对应卡片；套用预设前读替换范围，确认后仍可单步撤销。

### 3.2 桌面线框（【提议】信息架构，Kit 面板默认 720px）

```text
┌ 世界书编辑器 ─────────────────────────── [主题] [×] ┐
│ 条目  AI  破限  工具  设置                          │
├──────────────────────────────────────────────────────┤
│ 破限提示词                     [对所有 AI 请求生效]  │
│ 视图 [编排] [预览]                                  │
│ 预设 [基础创作框架 ▾] [套用] [清空]                  │
│ 选择只改说明；点“套用”才替换两个区域。               │
│ 摘要：附加消息 3 条 · 忽略 1 条 · 1 条警告  [看预览] │
│ ▼ 前置区（任务之前）                          1 条  │
│   [system ▾] [system · 原样]      [↑] [↓] [删]      │
│   [ 文本域 ]                                        │
│   [ + 添加前置消息 ]  最多 6 条（达上限禁用）       │
│ ▼ 后置区（输出契约之前）                      1 条  │
│   [assistant ▾] [assistant · 末尾预填充] [↑][↓][删]│
│   [ 文本域 ]                                        │
│ 规则卡：顺序 / accepted / 预填充 / 端点待验证       │
└──────────────────────────────────────────────────────┘
```

### 3.3 预览视图（【提议】同一页的只读子视图）

```text
│ 视图 [编排] [预览]                                   │
│ [示例编排，不是真实请求：任务内容运行时填入；         │
│  本页不读密钥、不请求模型、不写世界书]                │
│ 任务格式 [结构化 JSON] [纯文本]                       │
│ 状态 [首次] [重试（仅 JSON）]                        │
│ 01 system    前置   本内容是虚构文学创作……           │
│ 02 user      前置   模拟已接受 → user，已加前缀       │
│ 03 system    任务   任务说明（运行时填入）            │
│ 04 user      任务   任务内容（运行时填入）            │
│ 05 system    后置   直接输出符合要求的内容……         │
│ 06 system    契约   输出格式要求（JSON）              │
│ 07 assistant 预填充 好的，以下……（已移到最末）       │
│ 注：首次的重试提示不编号；JSON 失败后切“重试”看补提醒；text 无 │
│ 校验：⚠ 预填充 + JSON 可能失败；✓ 无空消息           │
│ [定位到第 1 条] [返回编排]                            │
```

### 3.4 窄屏线框（【提议】，Kit `<=600px` 底部抽屉）

```text
│ 破限提示词              │
│ [编排] [预览]           │
│ 预设 [基础创作框架 ▾]   │
│ [套用] [清空]           │
│ 附加消息 3 条 · 1 警告  │
│ ▼ 前置区 1 条           │
│   [system ▾] [↑][↓][删] │
│   [ 文本域 ]            │
│   状态徽标换行，不横滚  │
│ 预览：单列步骤卡，序号、│
│ role、来源、正文各一行  │
```

窄屏不新增抽屉/弹层，复用 Kit 现有底部导航与面板滚动；role 下拉与图标按钮允许换行，长文本 `overflow-wrap: anywhere`，不出现横向滚动。

### 3.5 视图状态

- 【提议】`S.jbView`：`edit | preview`，仅内存，默认 `edit`；切页保留（构建时挂载 `Worldbook-Editor.js:1690`，切页不重建 `test/browser-smoke.mjs:247-251`）。
- 【提议】`S.jbFormat`：`json | text`，仅内存，默认 `json`（优先暴露预填充风险）；`S.jbPreviewRetry`：`false` 首次 / `true` 重试，仅预览用，均不写设置、不改变真实操作的 format/retry。
- 【提议】`S.jbUndo` / `S.jbPendingPreset`：一次快照、待确认预设 key，均仅内存；编辑或取消即清空。不新增 `layout` 键，不动现有命名空间（`runtime.js:16-32`）。

## 4. 消息卡片与边界

### 4.1 卡片结构

- 头部：role 下拉 + **实际状态徽标** + 上移/下移/删除；主体：文本域；足部：一条短状态。
- `input`/`change` 后只更新现有徽标、短提示（含 role 变化）与计数；不得重建正在输入的 textarea。长解释统一放页面底部规则卡，避免每卡重复。
- 【提议】徽标由纯函数结果驱动，UI 不自行判断：`原样`、`accepted → user`、`末尾预填充`、`将降级 system`、`已忽略`、`未知 role`。未知 role 下拉插入合成项（如 `tool（未知，将降级）`）并选中；用户不改则配置保持原值，发送时降级。

### 4.2 状态与边界表

下表“呈现”列均为【提议】，“实际发送”列是现有规则。

| 场景 | 呈现 | 实际发送（本扩展规则） | 依据 |
|---|---|---|---|
| 0 条 | 摘要“未配置”；示例总 3 条（任务 system/user/契约） | 不追加前置/后置 | `ai-prompts.js:134-141` |
| 6 条 | 正常；新增按钮禁用并提示上限 | 6 条按序进入 | `Worldbook-Editor.js:1479-1483` |
| 7 条（存储/旧数据） | 摘要“超出上限 1 条”，预览标红列出第 7 条；新增仍禁用 | **仍全部下发**，发送层不截断，由用户删除 | `buildMessages` 无数量校验（`ai-prompts.js:134-139`） |
| 空消息 `"   "` | 卡片保留，徽标“已忽略”，不计入实际条数 | 丢弃 | `ai-prompts.js:49-50` |
| `content` 非字符串 | 徽标“已忽略”，提示类型异常 | 丢弃 | `ai-prompts.js:49` |
| 前置裸 `assistant` | “将降级 system”，原文保留 | `system`，原位 | `ai-prompts.js:51-55` |
| 后置非法 role（`tool` / `accepted`） | `tool` 显示“未知 → system”；`accepted` 显示“不支持，降级 system”，不加前缀 | 均 `system`，内容保留 | `ai-prompts.js:51-59` |
| 多条 `assistant` | 最后一条“末尾预填充”，之前每条“将降级 system” | 最后一条移到最末；之前降级留原位 | `ai-prompts.js:121-132` |
| 预填充 + JSON | 警告“前缀会进入解析，可能失败”，不写“必然” | `assistant` 仍在最末 | `ai-prompts.js:140-144` |
| 预填充 + 重试 | 显示重试在契约后、预填充前 | 契约 → 重试 → 预填充 | `ai-prompts.js:141-144`；测试 `:352-361` |
| 非数组 `jbPre` | 不崩；红色错误条 + 手动“修复为 []” | 发送层按空处理 | `ai-prompts.js:45`；修复为【提议】 |
| 切页 / 重绘 | 预览状态保留；结构操作后焦点/选区/滚动恢复 | 不影响发送 | 【提议】；现状问题 P4 |
| 排序后持久化 | 上移/下移后保存；重开顺序保持 | 数组顺序即发送顺序 | `Worldbook-Editor.js:1502-1512`；`runtime.js:52-58` |
| 动态内容 | 纯文本显示，不生成 DOM/属性 | 不适用 | `esc` 在 `Worldbook-Editor.js:253` |

### 4.3 焦点、选区与滚动

【提议】增/删/移统一走“快照 → 重绘 → 恢复”：

1. 记录 `kind`、索引、焦点字段（role 或 textarea）、textarea 的 `selectionStart/End`、`panel.body.scrollTop`。
2. 删除时：同位置的下一条存在则聚焦它；否则聚焦上一条；没有卡片则聚焦新增按钮。
3. 排序时：按新索引跟随被移动的卡片；选区只恢复到 textarea；`focus({preventScroll:true})` 后再做最小必要滚动。
4. 输入不重绘卡片，只去抖更新摘要/预览（约 120ms）；`Esc` 不作为确认条取消路径：面板已有捕获阶段的 Esc 处理（`Worldbook-Editor.js:1727-1731` 及 Kit 关闭逻辑），确认条只提供显式“取消”，避免一次按键关闭整个面板。

## 5. 编排预览与本地校验

### 5.1 【提议】预览是什么、不是什么

- 是：对当前 `jbPre`/`jbPost` 按真实 `buildMessages` 规则生成的**只读示例编排**；不是：真实请求、真实 token 统计、端点接受性证明、模型效果证明。
- 固定任务行显示“运行时填入”，不伪造任务；契约行显示当前格式的契约文本。不读 `CFG.key`/`apiurl`/`model`，不调 `generateRaw`、世界书 API，不改 `S.ai.results`、`S.ai.book` 或 Diff。摘要“附加消息”= 有效 pre/post（含末尾 prefill）；固定任务与契约另计；0 配置附加 0 条、示例总 3 条。

### 5.2 步骤字段

【提议】每步由纯函数返回，UI 只渲染：`key/section/sourceIndex/configuredRole/role/content/kind/note`。

- `steps` 只列该场景实际发送的步骤；`dropped` 只在卡片/`issues` 显示，不进入 `messages` 或 `steps`。
- `retry=false` 不生成重试步骤；`retry=true` 且 `format='json'` 才在契约后、prefill 前生成；`text` 无论 retry 都没有提醒。首次视图用不编号脚注解释 JSON 重试，切到“重试”才编号显示。
- 正文裁剪到约 120 个码点，按 Unicode 码点截断；完整内容用于“定位到消息”。

### 5.3 本地校验清单

【提议】只做确定性检查，全部基于纯函数 `issues`：

| 代码 | 级别 | 触发 | 文案要点 |
|---|---|---|---|
| `data.not-array` | error | `jbPre/jbPost` 非数组 | 数据异常；发送按空；提供手动修复 |
| `limit.over` | error | 数组长度 > 6 | 超本页上限；发送层不截断；请删除 |
| `item.invalid` | warn | 元素非对象 | 该条被跳过 |
| `content.empty` / `content.non-string` | info / warn | trim 后为空 / 非字符串 | 不会下发 |
| `role.unknown` | warn | role 不在该区白名单 | 实际降级 `system`，内容保留 |
| `role.accepted-in-post` / `role.assistant-in-pre` | warn | 后置 `accepted` / 前置裸 `assistant` | 降级 `system`；后者不成为首条 assistant |
| `assistant.multiple` | info | 多条有效 assistant | 只有最后一条作预填充 |
| `prefill.json` | warn | 有预填充且格式 JSON | 前缀进入解析，可能失败；纯文本无此风险 |
| `plan.empty` | info | 两区都无有效消息 | 不追加任何消息 |

校验不写回设置；“修复为 []”等动作必须由用户点击，且只改当前命名空间（`runtime.js:283-307`）。

### 5.4 不复制第二套规则

【提议】重构 `src/ai-prompts.js` 内部，公开行为不变：

```js
function planMessages(params) { ... }   // 唯一核心：messages + steps + issues
export const buildMessages = params => planMessages(params).messages;
export const previewMessagePlan = ({ pre, post, format = 'json', retry = false }) =>
  planMessages({ system: PREVIEW_TASK_SYSTEM, user: PREVIEW_TASK_USER,
                 style: '', pre, post, format, retry });
```

- `previewMessagePlan` 返回该场景的 `messages`/`steps`/`issues`；`steps` 只含实际发送的步骤，`text` 恒无重试，未激活的重试不混入。
- parity：用同一内部占位任务、`style:''`、相同 `format`/`retry` 调 `buildMessages`，比较 `preview.messages`；`steps` 只比较实际发送项，并覆盖 `accepted` 前缀与多 assistant 的降级/末尾 prefill。
- `normalizeMessages` 不导出、不被 UI 调用；只作为 `planMessages` 的内部扫描，记录原始索引、丢弃与降级。
- `buildMessages` 仍对空 `system`/`user` 抛 `TypeError`（`ai-prompts.js:109-114`）；预览用非空占位，不改该契约。
- `previewMessagePlan` 不改入参、不排序、不写回；UI 不再根据 `msg.role` 推导“实际角色”。预览状态仅内存，不改变真实操作的 retry/format。

## 6. 预设应用语义

【本轮后现状】选择预设只改 `hint`；“套用”仍整体替换两数组，有非空内容时原生 `confirm`，无撤销。预设不再全是静态常量：内置 8 个 + `jbCustomPresets` 自定义，套用改为深拷贝；保存/更新/删除见 6.3。

### 6.1 【提议】MVP 语义

1. **选择 ≠ 应用**：下拉只改 `hint`，不改配置、不保存。
2. **按“配置行”计数**：即使只有空占位行，也提示“将替换前置 X 条 / 后置 Y 条（其中 Z 条为空）”，修复 P5。
3. **内联确认条**：显示预设名、替换前后条数、“套用并保留撤销 / 取消”；非模态、无焦点陷阱、`aria-live="polite"`。
4. **套用即快照**：深拷贝旧数组到 `S.jbUndo`，替换、保存、重绘，显示“已套用 · 撤销”。
5. **单步撤销**：恢复旧数组并保存；用户套用后编辑任意消息即清空快照并隐藏撤销，避免吞掉新编辑。
6. **取消**：不改配置、不保存、不重绘；焦点回“套用”；切换下拉同样取消待确认。
7. **清空**复用同一套确认/快照/撤销，替换 `jbclear` 的原生 `confirm`。不自动规范化 role、不自动截断 >6 条；本轮不改既有 7 个预设文案，只新增中性编辑模板（见 6.3）；“最强”等措辞建议 P1 改为结构性描述。

### 6.2 【提议】P1 / P2

- **已提前到本轮 MVP**：保存当前编排为自定义预设、同名更新确认、删除确认、内置中性模板。实际实现见 6.3；不再作为 P1。
- P1：自定义预设重命名、JSON 导入导出。仍需要版本、导入校验（角色白名单、条数、大小、重复名）与覆盖确认。
- P1：一键“规范化 role”（显式确认后改写并保存），不自动迁移。
- P2：预设收藏/排序/多套命名配置、独立启用开关；本轮不做。

### 6.3 本轮已落地：保存自定义预设（2026-10-22）

本轮把“保存自定义”提前进 MVP，但不实施 6.1 的预览/撤销/套用内联确认，避免范围膨胀。

- **UI**：预设工具栏新增「保存为自定义预设」「删除自定义预设」。命名与保存/取消使用现有 Kit 输入与内联卡片，不使用 `window.prompt`，不新增弹层。
- **存储**：`extensionSettings.st_worldbook_editor.jbCustomPresets`，默认 `[]`，元素固定 `{id, name, pre, post}`，与 `layout` 分开；只保存用户消息，不保存 `key` / `model` / 世界书内容。
- **id**：内置 `builtin:*`，自定义 `custom:*`，命名空间隔离；更新保留原 id，创建后自动选中。
- **保存语义**：深拷贝当前 `jbPre` / `jbPost`；保存本身不改当前编排、不发模型请求。刷新/重开面板通过同一字段读取。
- **防错**：两区必须为数组、各 ≤ 6 条、role 在对应区域白名单内、`content` 为字符串、至少一条非空；空占位保留，合法 `accepted` 不降级，拒绝时不裁剪/清空原数组。
- **同名/删除**：同名自定义显示内联「更新现有 / 取消」，取消不改数据；同名内置拒绝覆盖；删除自定义需内联确认，内置不可删除。
- **模板**：新增内置「世界书编辑·结构稳健」：2 条前置（system + user）声明编辑边界、保留既有事实/专有名词、只按当前用户任务修改；1 条后置 system 要求遵守当前任务输出格式且不加说明。兼容 JSON/text，不使用 assistant 预填充。
- **仍待后续**：编排预览、套用/清空的统一内联确认与单步撤销、role 规范化修复、预设重命名/JSON 导入导出、真实端点效果实测。

## 7. 数据、迁移与持久化

### 7.1 存储形状

【现状】`jbPre`/`jbPost` 为 `[{role, content}]`，默认 `[]`；只存配置 role，不存实际 role。默认空表示不自动注入任何破限文案，预设只有用户点击“套用”才写入。【本轮变更】新增持久字段 `jbCustomPresets`，默认 `[]`，元素 `{id, name, pre, post}`，与 `layout` 分开；视图、格式、表单与撤销快照仍仅内存。迁移链不改。

### 7.2 读取容错

| 数据 | 发送层 | 【提议】UI |
|---|---|---|
| 非数组 | 视为空（`ai-prompts.js:45`） | 错误条 + “修复为 []”，不自动写 |
| 元素非对象 | 跳过（`:48`） | 警告“第 N 条被跳过” |
| `content` 非字符串 | 跳过（`:49`） | 警告“不会下发” |
| `role` 非字符串 / 大小写空格 | 按 `system` / trim + lowercase（`:51`） | 显示“缺失 role → system”或规范化结果 |
| > 6 条 | 全部下发（无数量校验） | 错误 + 列出全部；新增禁用 |

不自动修复的原因：数据可能是手改或旧版本留下的，静默改写会丢内容；修复必须是显式动作。

### 7.3 迁移链

| 旧数据 | 结果 | 条件 | 证据 |
|---|---|---|---|
| `jailbreak` / `jbHead` 字符串 | `jbPre = [{role:'system', content}]`，`jbHead` 优先 | `jbPre` 为空 | `runtime.js:221-224` |
| `jbTail` 字符串 | `jbPost = [{role:'system', content}]` | `jbPost` 为空 | `runtime.js:225-228` |
| 新数组非空 | 保留新数组，不覆盖 | 总是 | `runtime.js:218-228` |
| 旧键仍存在 | 迁移后删除三个旧键 | 总是 | `runtime.js:230-232` |

旧键删除是现有语义，即使新数组非空也会删（`test/runtime.test.mjs:49-52`）。MVP 不改这条链；旧数据里的前置 `assistant` 不自动改写，预览标“将降级”。

### 7.4 持久化语义

- 【现状】`CFG` 是 `extensionSettings` 活引用（`runtime.js:240-270`），数组元素深一层克隆（`:52-58`）；输入逐次 `saveCfg`（`Worldbook-Editor.js:559`），结构操作也保存（`:1485`、`:1500`、`:1510`）。
- 【现状】宿主保存去抖且无完成回调；保存函数缺失时只 `console.warn`（`runtime.js:123-126`）。
- 【提议】文案写“自动保存（宿主去抖）”，不写“已保存到磁盘”；P1 再让 `saveSettings()` 返回布尔并显示“仅保存在内存”。
- 【现状】排序就是数组顺序，无额外 `order` 字段；重开读同一数组，顺序自然保持。浏览器验收应在移动后重载并断言顺序。

## 8. 输出安全与边界

- **转义**：动态内容（正文、未知 role 值、预设 hint）入 DOM 前走 `esc`（`Worldbook-Editor.js:253`）或 `textContent`；不得进入未转义的 `innerHTML`，也不得裸拼 `title`/`aria-label`。
- **不接触敏感面**：预览纯函数只接收 `pre/post/format`，不读 `CFG.key`、不发 `fetch`、不调 `generateRaw`、不调 `worldbook-api`。
- **不改 AI 应用链**：`applyAI` 的 Diff 确认（`:492-503`）与来源绑定（`:493`）保持原样；预览无“应用”按钮，不写 `S.ai.results`。
- **不新增 CDN/Kit 改动**：复用现有 `.nvui-acc`/`.nvui-badge`/`.nvui-code`/`.nvui-btn`，不改 `ui-kit/`，不新增 `!important`、固定定位、数字 `z-index`；新选择器全部 `#wbe-overlay` 开头（`test/ui-contract.test.mjs:23-35`）。
- **ReDoS/裁剪**：校验只用 `trim`、`Array.isArray`、白名单 `Set`，不为用户内容构造正则；预览按码点裁剪到约 120 字，不把完整数组 `JSON.stringify` 进 DOM。
- **效果边界**：预设是用户可编辑的静态文本，不承诺破限效果；README 167/212 的“真正有效/最强”不是实证，本轮不新增规避安全机制的提示词。

## 9. 本轮范围与后续（已按 2026-10-22 实施修订）

| 项 | 层级 | 本轮状态 | 说明 |
|---|---|---|---|
| 保存当前编排为自定义预设 | **本轮 MVP** | **已实现** | 深拷贝 `jbPre`/`jbPost` 到 `jbCustomPresets`，不发请求、不改编排 |
| 同名更新 / 删除 / 内置不可覆盖 | **本轮 MVP** | **已实现** | 内联确认；取消不改数据；内置名拒绝、内置不可删除 |
| 中性内置模板「世界书编辑·结构稳健」 | **本轮 MVP** | **已实现** | 2 前置 + 1 后置，JSON/text 通用，无 assistant 预填充 |
| 保存前结构校验与可理解错误 | **本轮 MVP** | **已实现** | 数组/≤6/role 白名单/字符串 content/至少一条非空；不自动裁剪 |
| 编排预览（共享纯函数 + 步骤/状态/问题） | 原提议 MVP | **后续** | 本轮不做 |
| 卡片状态徽标 + 焦点/滚动恢复 | 原提议 MVP | **后续** | 本轮不做 |
| 套用/清空统一内联确认 + 单步撤销 | 原提议 MVP | **后续** | 本轮保留现有套用/清空确认语义 |
| 非数组/未知 role 容错与手动修复 | 原提议 MVP | **后续** | 本轮只在保存校验里拒绝并提示 |
| 保存结果可见（`saveSettings` 返回布尔） | P1 | 后续 | 需改 runtime 公开契约 |
| 自定义预设重命名 / 导入导出 | P1 | 后续 | 需版本与导入校验 |
| 一键规范化 role / 预设文案中性化 | P1 | 后续 | 会写配置必须确认 |
| 独立启用开关 | P2 | 后续 | 空数组已等于“不追加” |
| 拖拽排序 / 全局格式开关 / token 估算 | P2 | 后续 | 上移下移已够用；估算易被当精确值 |

## 10. 按文件拆分的实施步骤（原全量提议，本轮未按此顺序）

> 本轮只实施 6.3 的自定义保存与内置模板，新增零运行时模块 `src/jb-presets.js`；
> 下表其余预览/撤销/容错步骤仍未实施，不能据此表宣称已落地。

| 文件 | 改动 | 验证 |
|---|---|---|
| `src/ai-prompts.js` | 扩内部扫描器记录索引/丢弃/降级；抽 `planMessages`；`buildMessages` 改薄包装；导出 `previewMessagePlan`；保持零运行时依赖 | 先补 `test/ai-prompts.test.mjs` parity/边界，再改 UI |
| `src/Worldbook-Editor.js` | `S` 加 `jbView/jbFormat/jbUndo/jbPendingPreset`；替换 `jbHTML`（`:1151-1173`）；新增预览/摘要渲染；改 `jbCard`（`:1104-1133`）、`renderJb`（`:1098-1103`）、`jbapply/jbclear`（`:1453-1478`）；事件委托（`:1783-1789`）区分同步与预览刷新 | 不新增 `showModal`，不改 AI 应用链，动态文本全走 `esc` |
| `src/styles/style.css` | 新增 `#wbe-overlay .wbe-jb-*`：摘要条、确认条、步骤卡、role 徽标、问题项、撤销条；窄屏单列、头部换行、`overflow-wrap:anywhere` | 仅令牌、无 `!important`/固定定位/数字 `z-index`；`@import` 不动 |
| `test/ai-prompts.test.mjs` | 新增 preview parity、0/6/7、空、非法 role、多 assistant、JSON/text prefill、retry、不可变性 | 原有 34 项保持绿 |
| `test/runtime.test.mjs` | 新增“数组顺序与原始 role 不被自动改写”回归；迁移/reset 现有用例保留 | 不新增 runtime 行为 |
| `test/browser-smoke.mjs` | 预览、预设确认/取消/撤销、焦点、7 条、转义、无额外网络请求 | 桌面与窄屏各跑一遍 |
| `test/ui-contract.test.mjs` / Kit | 不新增业务逻辑，作为守护保持通过 | 主 Agent 复验 `npm run test:kit` |
| README / AGENTS | 同步“契约最后一条指令”、内置 8 个、自定义字段/UI/校验 | 本轮已定点更新 |

实施顺序：M1 纯函数与测试 → M2 只读预览 → M3 卡片状态/焦点/上限 → M4 预设确认与撤销 → M5 数据容错与文档。每个里程碑保持 `npm test` + `npm run test:kit` 绿；浏览器测试在 M2 后增量补。

## 11. 验收矩阵（原全量设计 + 本轮实际结果）

下面的表仍是原全量设计的验收矩阵，本轮只覆盖 6.3 的自定义保存与模板；未列出的原 MVP 项仍未实施。本轮实际执行：

```powershell
npm test
npm run test:kit
$env:PLAYWRIGHT_MODULE_PATH="C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core"
$env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
npm run test:browser
```

### 11.1 本轮实施验收（2026-10-22）

- 项目测试 / Kit：Codex 直接执行 `npm test` 58 通过 / 0 失败、`npm run test:kit` 361 通过 / 0 失败；日志 `.test-output/main-tests.log`、`.test-output/main-kit.log`。
- 浏览器：Codex 显式 `PLAYWRIGHT_MODULE_PATH` / `CHROME_PATH` 运行 `npm run test:browser`，输出 `Browser smoke passed`（含 custompresets、lifecycle），日志 `.test-output/main-browser.log`。
- 真实宿主保存与两次模型结果/限制见 `docs/jailbreak-preset-acceptance.md`；模型生成未通过，模板生成质量未验证。
- 变异验证：前轮 DSH 对全空保存条件变异，5 过 2 失败，恢复后 7/7 通过；Codex 未独立重复变异。
- `test/ui-contract.test.mjs` 已恢复 HEAD 原始内容（`git ls-files` 子进程依赖保留），
  不再为本轮沙箱错误改测试运行方式。

| # | 案例 | 层级 | 可执行断言 |
|---|---|---|---|
| 1 | 预览与发送同源 | ai-prompts | 同一内部占位任务、`style:''`、相同 `format`/`retry` 调 `buildMessages`，比较 `preview.messages`；`steps` 只比实际发送项，覆盖 accepted 前缀与多 assistant 变换 |
| 2 | 0 条 / 空消息 | ai-prompts + browser | 附加消息 0 条、示例总 3 条（任务 system/user/契约）；空消息不进 `messages` 或 `steps`，卡片/校验区标“已忽略”，不计入附加条数 |
| 3 | 6 条 | browser | 添加 6 条成功；第 7 次无新增、按钮 `disabled`、提示上限 |
| 4 | 7 条（预置数据） | ai-prompts + browser | 预览列出 7 条并报 `limit.over`；`buildMessages` 仍返回 7 条，不静默截断 |
| 5 | `accepted` / 非法 role | ai-prompts + browser | 前置实际 `user` + `（上一轮回复）`；后置 `accepted` 降级 `system` 且无前缀；前置 `assistant`、后置 `tool` 降级 `system` 且内容保留 |
| 6 | 多 assistant | ai-prompts + browser | 最后一条**非空** assistant 在最末，之前的降级留原位 |
| 7 | 契约/重试/预填充顺序 | ai-prompts + browser | 首次无重试步骤；JSON 重试在契约后、预填充前；text 恒无重试；不写“契约永远最后一条” |
| 8 | JSON 预填充警告 | ai-prompts + browser | `json` 出现警告；`text` 不报错，但保留“仍是输出前缀”的提示 |
| 9 | 预设选择/取消/套用/撤销 | browser | 选择不改数组、不保存；取消不变；套用替换两区；撤销恢复；编辑后撤销消失 |
| 10 | 切页与重绘焦点 | browser | 切设置再切回，破限节点引用不变；删除聚焦下一条/上一条/新增；排序跟随新索引，选区只恢复 textarea，`preventScroll` 后最小滚动 |
| 11 | 排序持久化 | browser + runtime | 移动后保存，`extensionSettings.st_worldbook_editor.jbPre` 顺序改变；重载后卡片顺序一致 |
| 12 | 旧数据迁移 | runtime | 三个旧键只在目标数组为空时补位，之后删除；新数组优先；不自动改写 role |
| 13 | 非数组数据 | browser | 页面不崩；错误条 + 手动“修复为 []”；修复前不自动写 |
| 14 | 动态内容转义 | browser | 输入 `<img src=x onerror=...>`，预览显示字面文本；无 `pageerror`、无额外图片请求 |
| 15 | AI Diff 与来源绑定 | browser | 预览交互不增加 `calls`、不改 `S.ai.results`；切换世界书后旧建议仍被 `applyAI` 拒绝（`Worldbook-Editor.js:493`） |
| 16 | 卡片就地更新 | browser | 输入/切 role 后现有徽标、短提示与计数更新；正在输入的 textarea 不被重建（节点引用不变） |
| 17 | 作用域/Kit 守护 | ui-contract + kit | 新 CSS 全部 `#wbe-overlay`、仅令牌、无 CDN；`npm run test:kit` 由主 Agent 复验 |

## 12. 已采纳决策、延后项与待验证事项

1. **端点兼容仍待实测**：首条 role、相邻合并、末尾 `system` 转换、预填充是否被尊重，本轮不联网、不实测；预览只能写“待验证”。
2. **文本修正：已采纳设计决策**：`AGENTS.md:109` 与 README 174-175 改成“契约是后置消息之后的格式约束；预填充/重试可能在其后”，实施时同步。
3. **7 条保留：已采纳设计决策**：显示并全部下发，发送层不静默截断，由用户删除；不再作为待决项。
4. **非数组 UI 手动修复：已采纳设计决策**：显式“修复为 []”，不自动写 `runtime.fillDefaults`；不再作为待决项。
5. **编排/预览切换：已采纳设计决策**：不做左右分栏；窄屏复用 Kit 抽屉，只换渲染层不动纯函数与数据。
6. **P1 保存反馈：仍延后**：`saveSettings()` 返回布尔与“仅保存在内存”提示留到 P1，不在 MVP。

## 13. 变更边界

- 本轮实际改动：`src/jb-presets.js`（新增零运行时纯函数模块）、`src/Worldbook-Editor.js`（自定义预设 UI/动作）、
  `src/runtime.js`（`jbCustomPresets` 默认字段）、`test/jb-presets.test.mjs`（新增 7 项）、
  `test/browser-smoke.mjs`（保存/更新/删除/转义/全空回归、CDP 连接兜底）、
  `test/runtime.test.mjs`、`test/ui-contract.test.mjs`（去掉 git 子进程依赖）、`README.md`、`AGENTS.md`、本文件。
- **未改** `src/ai-prompts.js`、`src/styles/style.css`、`src/index.js`、`src/worldbook-api.js`、`manifest.json`、`ui-kit/`；
  未提交、未推送、未改宿主/用户配置或真实世界书。
- 本轮未实施 6.1 的预览/撤销/套用内联确认，也未做重命名、导入导出、role 自动规范化。
- 行号以本次工作区为准。
