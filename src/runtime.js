/**
 * SillyTavern 宿主运行时适配层。
 *
 * 设计约束：
 * - 只通过官方全局 `SillyTavern.getContext()` 取宿主能力，不静态导入 ST 内部模块；
 * - 每次调用都重新读取 context，不缓存早期空快照，也不缓存 TavernHelper 对象；
 * - 业务设置与面板布局都放在 extensionSettings[st_worldbook_editor] 下，
 *   但布局单独收在 `layout` 字段，不与业务配置混在一起；
 * - 只写自己的命名空间，不触碰其它扩展设置，也不遍历清理任意 `wbe_*` 键。
 */

export const EXTENSION_NAME = 'st_worldbook_editor';
export const LEGACY_SETTINGS_KEY = 'wbe_settings_v1';

/** 与原单文件脚本 CFG 兼容的默认值；破限提示词分首（jbHead）/ 尾（jbTail）两段。 */
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'st',
  apiurl: '',
  key: '',
  model: '',
  temp: 0.7,
  maxTokens: 4096,
  style: '',
  presets: [],
  sort: '',
  flt: '',
  groupFlt: '',
  tpl: '',
  // 破限提示词分首尾两段：前者设定基线，后者在临近输出处再锚一次
  jbHead: '',
  jbTail: '',
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const BLOCKED_LAYOUT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

let migrationChecked = false;
let warnedNoContext = false;

function warn(...args) {
  try {
    console.warn('[ST-Worldbook-Editor/runtime]', ...args);
  } catch {
    /* 忽略 */
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (isObject(value)) return { ...value };
  return value;
}

function cloneForStorage(value) {
  if (value === null || value === undefined) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    /* 退回 JSON 克隆 */
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * 实时获取宿主 context。不要把它缓存在模块变量里：ST 设置加载、
 * 重新导入设置等场景都可能替换 extensionSettings 引用。
 */
function getHostContext() {
  try {
    const st = globalThis.SillyTavern;
    if (st && typeof st.getContext === 'function') {
      const context = st.getContext();
      if (context && typeof context === 'object') return context;
    }
  } catch (err) {
    warn('读取 SillyTavern.getContext() 失败', err);
  }

  if (!warnedNoContext) {
    warnedNoContext = true;
    warn('未找到 SillyTavern.getContext()，请确认扩展由 SillyTavern 加载');
  }
  return null;
}

function getExtensionSettingsStore() {
  const context = getHostContext();
  if (!context) return null;
  const store = context.extensionSettings || context.extension_settings;
  return store && typeof store === 'object' && !Array.isArray(store) ? store : null;
}

function requireExtensionSettingsStore() {
  const store = getExtensionSettingsStore();
  if (!store) {
    throw new Error('无法访问 SillyTavern extensionSettings；请确认扩展在酒馆页面内加载');
  }
  return store;
}

/**
 * 落盘。优先使用 getContext().saveSettingsDebounced；
 * 返回是否成功拿到宿主保存函数，便于迁移时决定是否删除旧 localStorage 备份。
 */
function persistSettings() {
  const context = getHostContext();
  const fn = context
    ? (typeof context.saveSettingsDebounced === 'function'
      ? context.saveSettingsDebounced
      : (typeof context.saveSettings === 'function' ? context.saveSettings : null))
    : null;

  if (!fn) {
    warn('宿主未提供 saveSettingsDebounced，设置只存在于内存中');
    return false;
  }

  try {
    const result = fn.call(context);
    if (result && typeof result.catch === 'function') {
      result.catch(err => warn('保存扩展设置失败', err));
    }
    return true;
  } catch (err) {
    warn('保存扩展设置失败', err);
    return false;
  }
}

function publicSaveSettings() {
  persistSettings();
}

function readLegacySettings() {
  let storage = null;
  try {
    storage = globalThis.localStorage || null;
  } catch {
    return null;
  }
  if (!storage) return null;

  try {
    const raw = storage.getItem(LEGACY_SETTINGS_KEY);
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      warn(`${LEGACY_SETTINGS_KEY} 不是 JSON 对象，已跳过迁移`);
      return null;
    }
    return parsed;
  } catch (err) {
    warn(`读取旧设置 ${LEGACY_SETTINGS_KEY} 失败，已跳过迁移`, err);
    return null;
  }
}

function removeLegacySettings() {
  try {
    globalThis.localStorage?.removeItem(LEGACY_SETTINGS_KEY);
  } catch (err) {
    warn(`清理旧设置 ${LEGACY_SETTINGS_KEY} 失败`, err);
  }
}

/** 旧 localStorage 只补空缺；已有 ST 设置中的真实值优先。 */
function mergeLegacySettings(current, legacy) {
  const merged = { ...legacy };
  for (const key of Object.keys(current)) {
    if (current[key] !== undefined) merged[key] = current[key];
  }
  return merged;
}

function fillDefaults(settings) {
  let changed = false;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!hasOwn(settings, key) || settings[key] === undefined) {
      settings[key] = cloneValue(DEFAULT_SETTINGS[key]);
      changed = true;
    }
  }
  return changed;
}

function ensureLayout(settings) {
  if (!isObject(settings.layout)) {
    settings.layout = {};
    return true;
  }
  return false;
}

/**
 * 旧版单字段 jailbreak 迁移到首破限。
 *
 * 该字段历史上先放在任务之后、后改置最上方；现在拆成首 / 尾两段。
 * 旧值一律并入 jbHead（与原「置于最上方」的行为连续），迁移后删除旧键，
 * 避免两处同时存在、后续不知道该读哪个。
 */
function migrateLegacyJailbreak(settings) {
  if (!hasOwn(settings, 'jailbreak')) return false;
  const legacy = typeof settings.jailbreak === 'string' ? settings.jailbreak : '';
  delete settings.jailbreak;
  if (legacy.trim() && !settings.jbHead) settings.jbHead = legacy;
  return true;
}

/**
 * 取（并在首次使用时初始化/迁移）扩展设置对象。
 * 返回的是 extensionSettings 内的真实引用，调用方可以直接修改后 saveSettings()。
 */
export function getSettings() {
  const store = requireExtensionSettingsStore();
  const existing = store[EXTENSION_NAME];
  let settings = isObject(existing) ? existing : {};
  let changed = !isObject(existing);
  let legacyToRemove = false;

  if (!migrationChecked) {
    migrationChecked = true;
    const legacy = readLegacySettings();
    if (legacy) {
      settings = mergeLegacySettings(settings, legacy);
      legacyToRemove = true;
      changed = true;
    }
  }

  if (fillDefaults(settings)) changed = true;
  if (migrateLegacyJailbreak(settings)) changed = true;
  if (ensureLayout(settings)) changed = true;

  if (store[EXTENSION_NAME] !== settings) {
    store[EXTENSION_NAME] = settings;
    changed = true;
  }

  const saved = changed ? persistSettings() : true;
  if (legacyToRemove && saved) removeLegacySettings();

  return settings;
}

/** 兼容旧入口名；调用方应优先使用 getSettings()。 */
export const ensureSettings = getSettings;

export function saveSettings() {
  publicSaveSettings();
}

/**
 * 只清空本扩展自己的命名空间与旧 localStorage 键。
 * 不调用 localStorage.clear()，也不删除任意其它 `wbe_*` 键或其它扩展设置。
 */
export function resetSettings() {
  migrationChecked = true;
  removeLegacySettings();

  const store = getExtensionSettingsStore();
  if (!store) return null;

  const current = store[EXTENSION_NAME];
  let target = isObject(current) && Object.isExtensible(current) ? current : {};

  for (const key of Object.keys(target)) {
    try {
      delete target[key];
    } catch {
      target = {};
      break;
    }
  }

  fillDefaults(target);
  target.layout = {};
  store[EXTENSION_NAME] = target;
  persistSettings();
  return target;
}

/**
 * 实时读取酒馆助手（Tavern Helper / JS-Slash-Runner）暴露的全局对象。
 * 不在模块加载时缓存，也不依赖任何安装目录名或 iframe 注入变量。
 */
export function getHelper() {
  try {
    // 标准扩展运行在酒馆顶层窗口；Node 单测没有 window 时回退到 globalThis。
    const helper = (typeof window !== 'undefined' ? window.TavernHelper : undefined)
      || globalThis.TavernHelper;
    return helper && (typeof helper === 'object' || typeof helper === 'function') ? helper : null;
  } catch (err) {
    warn('读取 window.TavernHelper 失败', err);
    return null;
  }
}

function isSafeLayoutKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_LAYOUT_KEYS.has(key);
}

function normalizeLayoutKey(key) {
  const value = typeof key === 'string' ? key : String(key ?? '');
  return isSafeLayoutKey(value) ? value : null;
}

/**
 * NVUI Kit v2.6.0 的 StorageAdapter 实现。
 *
 * 已核对本地 ui-kit/nvui-api.js：
 * - persist 读取使用 get(key) / set(key, value)；
 * - clearLayoutState 优先调用 delete(key)，没有 delete 时才退回 set(key, null)。
 *
 * 对外按本项目契约暴露 get/set/remove，并额外提供不可枚举的 delete 别名，
 * 让 Kit 的 clearLayoutState 直接走 remove；set(key, null) 同样执行删除。
 */
export const layoutStorage = {
  get(key) {
    const storageKey = normalizeLayoutKey(key);
    if (!storageKey) return null;
    const settings = getSettings();
    const layout = settings.layout;
    if (!hasOwn(layout, storageKey)) return null;
    return cloneForStorage(layout[storageKey]);
  },

  set(key, value) {
    const storageKey = normalizeLayoutKey(key);
    if (!storageKey) return;
    const settings = getSettings();
    const layout = settings.layout;

    if (value === null || value === undefined) {
      if (hasOwn(layout, storageKey)) {
        delete layout[storageKey];
        persistSettings();
      }
      return;
    }

    layout[storageKey] = cloneForStorage(value);
    persistSettings();
  },

  remove(key) {
    const storageKey = normalizeLayoutKey(key);
    if (!storageKey) return;
    const settings = getSettings();
    const layout = settings.layout;
    if (!hasOwn(layout, storageKey)) return;
    delete layout[storageKey];
    persistSettings();
  },
};

Object.defineProperty(layoutStorage, 'delete', {
  value: layoutStorage.remove,
  enumerable: false,
  configurable: false,
  writable: false,
});

function getGlobalNVUI() {
  try {
    return globalThis.NVUI || null;
  } catch {
    return null;
  }
}

/**
 * 创建 UI 运行时。
 *
 * @param {{ NVUI?: object }} [options]
 * @returns {{
 *   getSettings: typeof getSettings,
 *   saveSettings: typeof saveSettings,
 *   resetSettings: typeof resetSettings,
 *   getHelper: typeof getHelper,
 *   layoutStorage: typeof layoutStorage,
 *   NVUI: object|null,
 *   EXTENSION_NAME: string
 * }}
 */
export function createRuntime(options = {}) {
  const injectedNVUI = options && isObject(options) && options.NVUI ? options.NVUI : null;

  return {
    getSettings,
    saveSettings,
    resetSettings,
    getHelper,
    layoutStorage,
    get NVUI() {
      return injectedNVUI || getGlobalNVUI();
    },
    EXTENSION_NAME,
  };
}
