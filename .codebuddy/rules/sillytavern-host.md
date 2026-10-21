---
alwaysApply: false
paths: src/**/*.js
---

# SillyTavern 宿主集成约束

改动 `src/` 下 JavaScript 时适用。

## 生命周期钩子

`manifest.json` 声明的钩子必须在 `src/index.js` 中以具名导出存在，测试用正则断言：

```js
export function init() { ... }        // hooks.activate
export async function onDisable() { ... }  // hooks.disable
```

- 钩子超时 **5000ms**（宿主 `callExtensionHook` 硬限制），`init` 里不要做长耗时异步。
- 扩展 JS 以 `<script type="module">` 加载 → 可以用 ESM `import`。
- `manifest.requires` 必须保持 `[]`（测试断言 `deepEqual(manifest.requires, [])`）。

## APP_READY 启动

- 启动必须等 `APP_READY` 事件；事件名从 `context.eventTypes.APP_READY` 读，**回退值 `'app_ready'`**。
- EventEmitter 有「注册即补发」行为：注册监听后事件可能**同步**到达，`init()` 里的
  `if (appReady) return start();` 判断不可省。
- 扩展可能在 `APP_READY` 之后才加载，事件源会补发该事件。

## 宿主上下文

```js
const st = globalThis.SillyTavern;
const context = st.getContext();
```

- **每次调用重新取**，不要缓存到模块变量。ST 重载设置会整体替换 `extensionSettings` 引用。
- 取 `extensionSettings` 时兼容 `context.extensionSettings` 与 `context.extension_settings` 两种键名。
- 保存用 `context.saveSettingsDebounced()`，回退 `context.saveSettings()`；
  两者都没有时设置只存在于内存，要 warn 而不是静默失败。

## 全局变量与清理

- 扩展会写 `globalThis.__wbeOpen` / `__wbeTeardown` / `__wbePanel`。
- **接管前先保存原值，停用时还原**——不能覆盖其它插件的同名入口。
- `onDisable` 必须清理：`#wbe-layer`、`#wbe-overlay`、`#wbe-root`、`#wbe-style` 四个宿主节点，
  以及 `<link data-wbe-style>` 标签、扩展菜单按钮。
- 即使 `editor.destroy()` 抛错，宿主节点也要兜底移除。

## 酒馆助手（Tavern Helper / JS-Slash-Runner）

- 运行时读 `window.TavernHelper`（Node 单测环境回退 `globalThis.TavernHelper`）。
- **不缓存** helper 对象，不硬编码安装目录名。
- 新旧接口并存，用 `call(api, ['新名', '旧名'])` 形式探测第一个存在的方法。
- helper 不可用时给**明确提示**，不要静默失败。

## 面板与宿主模态

- 面板用本地 NVUI Kit 的 `NVUI.createPanel`，不要用原生 `showModal()`。
- 宿主弹模态时本扩展面板要让位；Kit 负责 top-layer，扩展不要自己堆 `z-index`。
- 关闭面板要把焦点还给触发元素。
