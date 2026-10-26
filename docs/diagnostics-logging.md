# 诊断日志设计（v0.8.0+）

> 目标：用户报「出错了」时，能拿到**可复制的现场证据**——发生了什么、在哪个环节、环境是什么、错误堆栈是什么；
> 同时不把密钥 / 世界书内容带出去，也不写宿主设置文件。

## 1. 模块边界

```
src/logger.js                 零 import 叶子模块（Node 可单测，浏览器/Node 通用）
  ├─ index.js                 lifecycle：模块加载 / APP_READY / 启动 / 打开 / 清理 + 全局异常捕获
  ├─ runtime.js               runtime：设置读取与迁移、保存失败、TavernHelper 探测
  └─ Worldbook-Editor.js      editor / ai / io / settings：业务读写、AI 请求、导入导出、诊断日志 UI
```

- `logger.js` 不 import 任何模块，可被上层共用；单例 `getLogger()` 懒创建，Node 下不访问 DOM。
- 各模块用 `getLogger().child(scope)` 派生子 logger，**共享同一份缓冲 / 级别 / 监听器**，只换 scope 层级
  （缓冲里是 `wbe/editor/ai`，控制台镜像仍是旧前缀 `[ST-Worldbook-Editor/editor/ai]`）。

## 2. 数据形态

```js
{
  seq: 12,                          // 单调递增序号
  time: '2026-10-27 00:01:02.345',  // 本地时间（含毫秒）
  level: 'error',                   // debug | info | warn | error
  scope: 'wbe/editor/ai',
  message: 'AI 请求失败',
  detail: { model: 'gpt-4o-mini', format: 'json', error: { name, message, stack } }
}
```

- **环形缓冲**：默认 300 条（`capacity` 可注入），超出丢最旧；`clear()` 清空并重置序号。
- **级别**：默认 `info`（生产行为），设置页「详细日志：开」切到 `debug` 并写入 `CFG.debug`；
  `warn` / `error` 始终记录。
- **导出**：`exportText({ env })` 生成纯文本（头部 = 导出时间 + 调用方给的环境快照 + 级别 + 条数，
  正文 = 逐条 `[时间] [级别] [scope] 消息` + 缩进的 detail JSON）；`env` 由业务组装
  （扩展版本 / NVUI Kit 版本 / 酒馆版本 / 当前世界书 / 条目数 / 页面 URL / UA）。

## 3. 脱敏与隐私（硬红线）

- `detail` 先过白名单序列化：Error → `{ name, message, stack }`；循环引用 → `[Circular]`；
  DOM 节点 → `[DOM 标签]`；超深 / 超长（默认 1600 字）→ 占位说明。
- 字段名整键匹配 `SENSITIVE_KEY`（`key` / `apikey` / `api_key` / `authorization` / `token` /
  `secret` / `password` / `cookie` 等）→ 值替换为 `***`；世界书条目的 `keys` / `keys_secondary` 不受影响。
- 字符串内联脱敏：`Bearer <token>`、`sk-…`、`key=… / token=… / secret=…` 形态 → `***`。
- **调用方仍要遵守**：只传元信息（模型名、条数、长度、uid 等），不传世界书正文、聊天文本、提示词原文、API Key。
- 日志只存在内存：不写 `localStorage` / `extensionSettings`，不产生网络请求；页面刷新即清空。

## 4. 全局异常捕获

`src/index.js` 在模块加载时调用 `captureGlobalErrors(getLogger().child('global'))`：

- `window.onerror`（`error` 事件）：记录 event.message / error / source / line / column；
- `unhandledrejection`：记录 reason。

返回的注销函数当前不主动调用（扩展 disable 后页面级异常仍值得留痕），如需彻底回收只需在 `cleanup()` 中调用。

## 5. UI 与排障入口

- **设置 → 诊断日志与排障**（折叠条 `#wbe-acc-diag`）：
  - 「复制全部日志」：`navigator.clipboard` → 失败回退 `textarea + execCommand`；
  - 「下载日志文件」：Blob + `a[download]`，文件名 `st-worldbook-editor-log-<ISO>.txt`；
  - 「清空日志」：内联 `confirm` 后清空并重绘；
  - 「详细日志：开/关」：切级别 + 落盘 `CFG.debug`；
  - 列表最多渲染 40 条（不造第二滚动层，滚动仍交给 Kit 的 `.nvui-panel-body`），按级别着色（token-only），
    写入频繁时 250ms 合并重绘。
- **DevTools 入口**：`window.__wbeLog`（disable 时收回本扩展设置的值）：
  `__wbeLog.exportText()` / `__wbeLog.getEntries()` / `__wbeLog.setLevel('debug')` / `__wbeLog.clear()`。
- **环境快照**：`runtime.getHostInfo()` 只读 `SillyTavern.getContext()` 的 version / platform 字段，不缓存。

## 6. 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| Node 单测 | `test/logger.test.mjs`（13 条） | 级别过滤、环形缓冲、child 共享、脱敏（字段 / 文本 / Error / 循环 / 截断）、导出格式、订阅、全局捕获、单例 |
| 静态契约 | `test/ui-contract.test.mjs` | logger 零 import、三个模块接入、`__wbeLog`、设置页入口与四个动作、面板高度契约 |
| 浏览器冒烟 | `test/browser-smoke.mjs` | 折叠条可展开、生命周期日志存在、`ErrorEvent` 进缓冲、key/Bearer 不出现明文且 `Bearer ***` 存在、详细日志开关落盘、清空、disable 收回收、重启用恢复 |

## 7. 已知边界

- 内存日志在**页面刷新 / 崩溃重载**后丢失；需要跨刷新证据时可先「复制全部日志」再复现，或后续扩展 sessionStorage（需评估与「不写宿主存储」红线的取舍）。
- 控制台镜像输出的是**脱敏后的 detail**（不是原始 Error 对象），DevTools 里不能点开原生堆栈，但导出文本含完整 `stack` 字符串。
- detail 序列化不覆盖 `Map`/`Set` 以外的自定义类实例（按普通对象取可枚举字段），业务传入时尽量用 plain object。
