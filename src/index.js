/**
 * 世界书编辑器 · SillyTavern 标准扩展入口。
 *
 * 责任边界：
 * - 只负责生命周期、扩展菜单、APP_READY 安全启动、酒馆助手存在性提示；
 * - 通过 runtime.js 适配 extensionSettings / layout / TavernHelper；
 * - 通过 initializeEditor(runtime) 装配 Worldbook-Editor.js，不在这里实现业务 UI。
 */

import { initializeEditor } from './Worldbook-Editor.js';
import { captureGlobalErrors, getLogger } from './logger.js';
import { createRuntime, getHostEventApi, peekGlobalNVUI } from './runtime.js';

const LABEL = '世界书编辑器';
const MENU_ID = 'wbe-menu';
/** 期望的内置 ui-kit 版本；必须与 ui-kit/package.json 一致（test/ui-contract.test.mjs 会交叉校验）。 */
const KIT_VERSION = '2.8.0';
/** 宿主开启 Fast UI / 关闭模糊时 Kit 会自动降级玻璃，这是正常降级，不算自检异常。 */
const KIT_SELF_CHECK_IGNORED_ISSUES = new Set(['glass-auto-fallback']);
const MENU_RETRY_MS = 1000;
const MENU_RETRY_LIMIT = 30;
const HELPER_NOTICE_DELAY = 2000;
const HELPER_MISSING_MESSAGE = '未检测到酒馆助手（Tavern Helper / JS-Slash-Runner），或它尚未就绪。请先在「扩展」中安装并启用酒馆助手，然后刷新页面。';

const log = getLogger().child('lifecycle');

// 页面级未捕获异常也写进诊断日志（模块加载时安装；扩展 disable 后不注销，
// 便于排查清理阶段/Runtime 异步回包阶段才暴露的异常）。
captureGlobalErrors(getLogger().child('global'));

/**
 * 控制台排障入口：可在 DevTools 里直接 `__wbeLog.exportText()` 取日志、
 * `__wbeLog.setLevel('debug')` 临时开详细日志；不替代设置页的图形入口。
 */
function exposeLogHandle() {
  try { globalThis.__wbeLog = getLogger(); } catch { /* 忽略 */ }
}

let runtime = null;
let editor = null;
let editorPromise = null;
let nvui = null;
let nvuiLoading = null;

let appReady = false;
let started = false;
let starting = null;
let pendingOpen = false;
let generation = 0;

let appReadySource = null;
let appReadyEvent = 'app_ready';
let appReadyHandler = null;

let menuButton = null;
let menuClickHandler = null;
let menuKeyHandler = null;
let menuRetryTimer = null;
let menuRetryCount = 0;
let helperCheckTimer = null;
let pagehideHandler = null;

let previousOpen = undefined;
let capturedPreviousOpen = false;

function registerAppReady() {
  if (appReadyHandler || appReady) return true;

  // 宿主事件源统一走 runtime.getHostEventApi()，index.js 不直接碰 SillyTavern.getContext()
  const { source, ready } = getHostEventApi();
  if (!source || typeof source.on !== 'function') return false;

  appReadySource = source;
  appReadyEvent = ready;
  appReadyHandler = () => { onAppReady(); };
  try {
    source.on(ready, appReadyHandler);
    return true;
  } catch (err) {
    log.warn('注册 APP_READY 监听失败', err);
    appReadySource = null;
    appReadyEvent = 'app_ready';
    appReadyHandler = null;
    return false;
  }
}

function detachAppReady() {
  if (appReadyHandler && appReadySource) {
    const remove = typeof appReadySource.removeListener === 'function'
      ? appReadySource.removeListener
      : (typeof appReadySource.off === 'function' ? appReadySource.off : null);
    if (remove) {
      try {
        remove.call(appReadySource, appReadyEvent, appReadyHandler);
      } catch (err) {
        log.warn('移除 APP_READY 监听失败', err);
      }
    }
  }
  appReadySource = null;
  appReadyEvent = 'app_ready';
  appReadyHandler = null;
}

function onAppReady() {
  appReady = true;
  log.info('收到 APP_READY 事件');
  void start().then(() => {
    if (pendingOpen) {
      pendingOpen = false;
      void openEditor();
    }
  });
}

function isNVUI(api) {
  return !!api && typeof api.createPanel === 'function';
}

/**
 * NVUI Kit v2.8.0 新增运行时自检：一次返回版本漂移 / CSS 未加载 / 玻璃回退等诊断。
 * 结果写进诊断日志（控制台同步镜像）、不打断启动、不进用户界面；`glass-auto-fallback`
 * 是宿主 Fast UI 下的正常降级，已列入忽略项（只有 `api.config.debug` 打开时才记录通过详情）。
 */
function logKitSelfCheck(api) {
  if (typeof api.selfCheck !== 'function') return;
  try {
    const result = api.selfCheck({ expect: KIT_VERSION });
    const issues = Array.isArray(result?.issues)
      ? result.issues.filter(issue => !KIT_SELF_CHECK_IGNORED_ISSUES.has(issue))
      : [];
    if (issues.length > 0) {
      log.warn('NVUI Kit 自检异常', { issues, result });
    } else if (api.config?.debug) {
      log.debug('NVUI Kit 自检通过', result);
    }
  } catch (err) {
    log.warn('NVUI Kit 自检执行失败', err);
  }
}

/**
 * 加载本地 Kit API。Kit 是 UMD：import 执行后会挂到 globalThis.NVUI。
 * 若进入前已有其它插件注册的全局实例，加载完本地副本后恢复它，
 * 避免把别人的全局引用替换成本扩展的副本；本扩展自己持有本地实例。
 */
async function ensureNVUI() {
  if (isNVUI(nvui)) return nvui;
  if (nvuiLoading) return nvuiLoading;

  nvuiLoading = (async () => {
    const prior = peekGlobalNVUI();
    let loaded = null;

    try {
      await import('../ui-kit/nvui-api.js');
      loaded = peekGlobalNVUI();
    } catch (err) {
      log.error('本地 NVUI Kit 加载失败', err);
    }

    if (prior && (typeof prior === 'object' || typeof prior === 'function')) {
      try {
        globalThis.NVUI = prior;
      } catch (err) {
        log.warn('恢复其它插件的 NVUI 全局实例失败', err);
      }
      if (!isNVUI(loaded) && isNVUI(prior)) loaded = prior;
    }

    if (!isNVUI(loaded)) {
      throw new Error(`NVUI Kit ${KIT_VERSION} 未就绪：请确认 ui-kit/nvui-api.js 与 style.css 已随扩展安装`);
    }

    nvui = loaded;
    log.info('本地 NVUI Kit 已加载', { version: loaded.version || null, kitVersion: KIT_VERSION });
    logKitSelfCheck(loaded);
    exposeLogHandle();
    return nvui;
  })().finally(() => {
    nvuiLoading = null;
  });

  return nvuiLoading;
}

function notify(message, type = 'info') {
  const text = String(message || '');
  const full = text.startsWith(`${LABEL}：`) ? text : `${LABEL}：${text}`;
  const api = isNVUI(nvui) ? nvui : peekGlobalNVUI();

  if (isNVUI(api) && typeof api.showToast === 'function') {
    try {
      api.showToast({ message: full, type });
      return;
    } catch (err) {
      log.warn('NVUI toast 失败', err);
    }
  }

  try {
    const toastr = globalThis.toastr;
    if (toastr) {
      const method = type === 'danger' ? toastr.error
        : type === 'warn' ? toastr.warning
          : (toastr[type] || toastr.info);
      if (typeof method === 'function') {
        method.call(toastr, full);
        return;
      }
    }
  } catch (err) {
    log.warn('toastr 回退失败', err);
  }

  log.warn(String(text));
}

function hasHelper() {
  if (!runtime || typeof runtime.getHelper !== 'function') return false;
  const helper = runtime.getHelper();
  return !!helper && (
    typeof helper.getWorldbookNames === 'function'
    || typeof helper.getLorebooks === 'function'
    || typeof helper.getWorldbook === 'function'
  );
}

function clearMenuRetry() {
  if (menuRetryTimer) {
    clearInterval(menuRetryTimer);
    menuRetryTimer = null;
  }
  menuRetryCount = 0;
}

function createMenuButton() {
  if (!runtime) return false;

  const existing = document.getElementById(MENU_ID);
  if (existing) {
    if (existing.dataset && existing.dataset.wbeOwner === 'extension') menuButton = existing;
    return true;
  }

  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;

  const button = document.createElement('div');
  button.id = MENU_ID;
  button.className = 'list-group-item flex-container flexGap5 interactable';
  button.tabIndex = 0;
  button.setAttribute('role', 'button');
  button.setAttribute('aria-label', `打开${LABEL}`);
  button.title = `打开${LABEL}`;
  button.dataset.wbeOwner = 'extension';

  const icon = document.createElement('div');
  icon.className = 'fa-solid fa-book-open extensionsMenuExtensionButton';
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = LABEL;

  button.appendChild(icon);
  button.appendChild(label);

  menuClickHandler = () => { void openEditor(); };
  menuKeyHandler = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    menuClickHandler();
  };

  button.addEventListener('click', menuClickHandler);
  button.addEventListener('keydown', menuKeyHandler);

  menuButton = button;
  menu.appendChild(button);
  return true;
}

function ensureMenuButton() {
  if (createMenuButton()) {
    clearMenuRetry();
    return true;
  }

  if (menuRetryTimer) return false;

  menuRetryCount = 0;
  menuRetryTimer = setInterval(() => {
    menuRetryCount += 1;
    if (createMenuButton()) {
      clearMenuRetry();
      return;
    }
    if (menuRetryCount >= MENU_RETRY_LIMIT) {
      log.warn('未找到 #extensionsMenu，扩展菜单入口暂未挂载');
      clearMenuRetry();
    }
  }, MENU_RETRY_MS);

  return false;
}

async function ensureEditor(expectedGeneration = generation) {
  if (editor) return editor;
  if (!runtime) return null;
  if (editorPromise) return editorPromise;

  const promise = (async () => {
    if (typeof initializeEditor !== 'function') {
      throw new Error('Worldbook-Editor.js 未导出 initializeEditor(runtime)');
    }

    const instance = await initializeEditor(runtime);
    const resolved = instance && typeof instance.then === 'function' ? await instance : instance;

    if (expectedGeneration !== generation) {
      try {
        resolved?.destroy?.();
      } catch {
        /* 忽略 */
      }
      return null;
    }

    if (!resolved || typeof resolved.open !== 'function') {
      throw new Error('initializeEditor(runtime) 必须返回 { open, destroy }');
    }

    editor = resolved;
    return editor;
  })().finally(() => {
    if (editorPromise === promise) editorPromise = null;
  });

  editorPromise = promise;
  return editorPromise;
}

function start() {
  if (started) return Promise.resolve();
  if (starting) return starting;

  const expectedGeneration = generation;
  exposeLogHandle();
  log.info('开始启动扩展');

  const promise = (async () => {
    try {
      const api = await ensureNVUI();
      if (expectedGeneration !== generation) return;

      runtime = createRuntime({ NVUI: api });
      log.info('宿主运行时已就绪', { kitVersion: api.version || null });

      try {
        runtime.getSettings();
      } catch (err) {
        log.error('读取扩展设置失败', err);
        notify(`读取扩展设置失败：${err?.message || err}`, 'danger');
        return;
      }
      if (expectedGeneration !== generation) return;

      if (!capturedPreviousOpen) {
        previousOpen = globalThis.__wbeOpen;
        capturedPreviousOpen = true;
      }

      try {
        await ensureEditor(expectedGeneration);
      } catch (err) {
        log.error('初始化编辑器失败', err);
        notify(`编辑器初始化失败：${err?.message || err}`, 'danger');
      }
      if (expectedGeneration !== generation) return;

      log.info('编辑器初始化完成');

      // 放在 initializeEditor 之后：编辑器初始化过程若清理旧 DOM，不应把入口菜单一起带走。
      ensureMenuButton();

      // 同样放在 initializeEditor 之后：即使编辑器自身仍保留旧的 __wbeOpen，
      // 也由扩展入口统一接管；清理时再恢复进入前的值。
      globalThis.__wbeOpen = openEditor;

      if (!pagehideHandler) {
        pagehideHandler = (event) => {
          if (!event || !event.persisted) void cleanup();
        };
        globalThis.addEventListener?.('pagehide', pagehideHandler);
      }

      started = true;
      log.info('扩展启动完成', { menuMounted: !!menuButton, helperReady: hasHelper() });

      if (helperCheckTimer) clearTimeout(helperCheckTimer);
      helperCheckTimer = setTimeout(() => {
        helperCheckTimer = null;
        if (expectedGeneration !== generation) return;
        if (!hasHelper()) notify(HELPER_MISSING_MESSAGE, 'warn');
      }, HELPER_NOTICE_DELAY);
    } catch (err) {
      log.error('启动失败', err);
      notify(`启动失败：${err?.message || err}`, 'danger');
    }
  })().finally(() => {
    if (starting === promise) starting = null;
  });

  starting = promise;
  return promise;
}

async function openEditor() {
  if (!appReady) {
    pendingOpen = true;
    log.info('酒馆尚未就绪，面板打开请求已挂起，等待 APP_READY');
    if (!registerAppReady()) {
      notify('酒馆尚未完成初始化，暂时无法打开编辑器；请刷新页面后重试。', 'info');
    }
    return;
  }

  await start();
  if (!runtime || !started) return;

  if (!hasHelper()) {
    notify(HELPER_MISSING_MESSAGE, 'warn');
    return;
  }

  try {
    const instance = await ensureEditor(generation);
    if (!instance) return;
    log.info('打开编辑器面板');
    await instance.open();
  } catch (err) {
    log.error('打开面板失败', err);
    notify(`打开面板失败：${err?.message || err}`, 'danger');
  }
}

async function cleanup() {
  generation += 1;
  log.info('清理扩展实例（disable / pagehide）');

  clearMenuRetry();
  if (helperCheckTimer) {
    clearTimeout(helperCheckTimer);
    helperCheckTimer = null;
  }

  detachAppReady();

  if (pagehideHandler) {
    try {
      globalThis.removeEventListener?.('pagehide', pagehideHandler);
    } catch {
      /* 忽略 */
    }
    pagehideHandler = null;
  }

  if (menuButton) {
    try {
      if (menuClickHandler) menuButton.removeEventListener('click', menuClickHandler);
      if (menuKeyHandler) menuButton.removeEventListener('keydown', menuKeyHandler);
      menuButton.remove();
    } catch (err) {
      log.warn('移除扩展菜单失败', err);
    }
  }
  menuButton = null;
  menuClickHandler = null;
  menuKeyHandler = null;

  const currentEditor = editor;
  editor = null;
  editorPromise = null;
  started = false;
  starting = null;
  pendingOpen = false;

  if (currentEditor) {
    try {
      await currentEditor.destroy?.();
    } catch (err) {
      log.warn('销毁编辑器失败', err);
    }
  }

  runtime = null;

  // 兜底：编辑器即使 destroy 抛错，也不把本扩展的宿主节点留在页面上。
  for (const id of ['wbe-layer', 'wbe-overlay', 'wbe-root', 'wbe-style']) {
    try {
      document.getElementById(id)?.remove();
    } catch {
      /* 忽略 */
    }
  }
  try {
    document.querySelector('link[data-wbe-style]')?.remove();
  } catch {
    /* 忽略 */
  }

  const strayMenu = document.getElementById(MENU_ID);
  if (strayMenu?.dataset?.wbeOwner === 'extension') {
    try {
      strayMenu.remove();
    } catch {
      /* 忽略 */
    }
  }

  // 编辑器会暴露自己的 __wbeTeardown/__wbePanel；disable 时一并收回，
  // 避免旧的闭包继续持有面板与设置引用。
  if (currentEditor && currentEditor.destroy && globalThis.__wbeTeardown === currentEditor.destroy) {
    try {
      delete globalThis.__wbeTeardown;
      delete globalThis.__wbePanel;
    } catch {
      /* 忽略 */
    }
  }

  // 放在 destroy 之后恢复：部分旧版编辑器会在 teardown 中把 __wbeOpen 置空，
  // 这里以入口为准恢复进入扩展前的值，避免覆盖别的插件入口。
  if (capturedPreviousOpen) {
    try {
      if (globalThis.__wbeOpen === openEditor || globalThis.__wbeOpen === null || globalThis.__wbeOpen === undefined) {
        if (previousOpen === undefined) delete globalThis.__wbeOpen;
        else globalThis.__wbeOpen = previousOpen;
      }
    } catch {
      /* 忽略 */
    }
    capturedPreviousOpen = false;
    previousOpen = undefined;
  }

  // 只收回本扩展自己挂的排障入口，避免误删其它插件/用户的值。
  try {
    if (globalThis.__wbeLog === getLogger()) delete globalThis.__wbeLog;
  } catch {
    /* 忽略 */
  }
}

/** manifest.json 的 hooks.activate。重复调用不会重复注册菜单或面板。 */
export function init() {
  if (appReady) return start();

  if (!registerAppReady()) {
    log.warn('暂时无法注册 APP_READY 监听，将在钩子下次调用时重试');
    return Promise.resolve();
  }

  // EventEmitter 对 APP_READY 有“注册即补发”行为，可能已同步进入 onAppReady。
  if (appReady) return start();
  return Promise.resolve();
}

/** manifest.json 的 hooks.disable。 */
export async function onDisable() {
  await cleanup();
}

export { onDisable as disable };
export { openEditor as open };

// 尽早挂 APP_READY 监听：即使宿主版本没有调用 activate 钩子，也能在就绪后启动。
const registeredAtImport = registerAppReady();
exposeLogHandle();
log.info('扩展入口模块已加载', { appReadyRegistered: registeredAtImport });
if (!registeredAtImport) {
  log.warn('模块加载时未注册 APP_READY，activate 钩子会再试一次');
}
