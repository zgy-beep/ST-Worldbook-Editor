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

import { getLogger } from './logger.js';

const log = getLogger().child('runtime');

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
  // 破限消息编排：前置区在任务之前，后置区在输出契约之前
  jbPre: [],
  jbPost: [],
  // 用户另存的自定义预设；元素形状 { id, name, pre, post }，与 layout 分开
  jbCustomPresets: [],
  // 诊断日志：开启后记录 debug 级（AI 请求元信息、保存/加载细节等），默认关闭
  debug: false,
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const BLOCKED_LAYOUT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

let migrationChecked = false;
let warnedNoContext = false;

function warn(...args) {
  // 统一进诊断日志（控制台镜像由 logger 负责，前缀仍是 [ST-Worldbook-Editor/runtime]）
  log.warn(args[0], args.length > 2 ? args.slice(1) : args[1]);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  // 数组要深一层：DEFAULT_SETTINGS 是冻结的，浅拷贝会让元素共享冻结引用，
  // 后续修改 settings.jbPre[i].content 会静默失败。
  if (Array.isArray(value)) return value.map(item => (isObject(item) ? { ...item } : item));
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
  // 返回布尔给 UI 做「已保存 / 仅保存在内存」反馈（G02）
  return persistSettings();
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
 * 破限字段的迁移链：jailbreak（最老，单条）→ jbHead / jbTail（上一版，首尾两段）
 * → jbPre / jbPost（本版，可编排的消息数组）。
 *
 * 每一代都只在新数组为空时补位，避免覆盖用户已经在新版里编辑过的内容；
 * 迁移完成后删除所有旧键，防止多份数据并存、后续不知道该读哪个。
 */
function migrateJailbreakMessages(settings) {
  const readText = key => (typeof settings[key] === 'string' ? settings[key].trim() : '');
  const oldest = readText('jailbreak');
  const legacyHead = readText('jbHead');
  const legacyTail = readText('jbTail');

  let changed = false;
  const preEmpty = !Array.isArray(settings.jbPre) || settings.jbPre.length === 0;
  const postEmpty = !Array.isArray(settings.jbPost) || settings.jbPost.length === 0;

  if (preEmpty) {
    const head = legacyHead || oldest;
    if (head) { settings.jbPre = [{ role: 'system', content: head }]; changed = true; }
  }
  if (postEmpty && legacyTail) {
    settings.jbPost = [{ role: 'system', content: legacyTail }];
    changed = true;
  }

  for (const key of ['jailbreak', 'jbHead', 'jbTail']) {
    if (hasOwn(settings, key)) { delete settings[key]; changed = true; }
  }
  return changed;
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
  if (migrateJailbreakMessages(settings)) changed = true;
  if (ensureLayout(settings)) changed = true;

  if (store[EXTENSION_NAME] !== settings) {
    store[EXTENSION_NAME] = settings;
    changed = true;
  }

  const saved = changed ? persistSettings() : true;
  if (legacyToRemove && saved) removeLegacySettings();
  if (changed) log.info('扩展设置已初始化或补全默认值', { legacyMigrated: legacyToRemove, saved });

  return settings;
}

/** 兼容旧入口名；调用方应优先使用 getSettings()。 */
export const ensureSettings = getSettings;

/** 保存扩展设置；返回宿主是否真的提供了保存函数（false = 仅内存，UI 需如实提示）。 */
export function saveSettings() {
  return publicSaveSettings();
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

/**
 * 宿主环境快照（只读，供诊断日志 / 问题反馈使用）。
 * 只读 context 上已有的版本字段，不探测内部模块，也不改变任何状态。
 */
export function getHostInfo() {
  const context = getHostContext();
  if (!context) return { version: null, platform: null };
  const version = context.version ?? context.tavernVersion ?? null;
  const platform = context.platform ?? null;
  return {
    version: version === null || version === undefined ? null : String(version),
    platform: platform === null || platform === undefined ? null : String(platform),
  };
}

/**
 * 宿主事件入口（APP_READY / APP_INITIALIZED）。只读 context、不缓存。
 * index.js 的生命周期监听通过这里拿事件源，保证「只有 runtime.js 接触 getContext」。
 */
export function getHostEventApi() {
  const context = getHostContext();
  const types = context?.eventTypes || context?.event_types || {};
  return {
    source: context?.eventSource || null,
    ready: types.APP_READY || 'app_ready',
  };
}

function isSafeLayoutKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_LAYOUT_KEYS.has(key);
}

function normalizeLayoutKey(key) {
  const value = typeof key === 'string' ? key : String(key ?? '');
  return isSafeLayoutKey(value) ? value : null;
}

/**
 * NVUI Kit v2.8.0 的 StorageAdapter 实现。
 *
 * 已核对本地 ui-kit/nvui-api.js（v2.8.0，未改持久化格式）：
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

/** 只读窥视全局 NVUI（给 index.js 的「已有其它插件实例」回退用；不缓存）。 */
export function peekGlobalNVUI() {
  return getGlobalNVUI();
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
 *   getHostInfo: typeof getHostInfo,
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
    getHostInfo,
    layoutStorage,
    get NVUI() {
      return injectedNVUI || getGlobalNVUI();
    },
    EXTENSION_NAME,
  };
}
