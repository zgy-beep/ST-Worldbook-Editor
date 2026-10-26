/**
 * 世界书编辑器 · 诊断日志（零运行时依赖，可被 Node 单测）
 * ==================================================================
 * 目标：用户报「出错了」时，能拿到可复制的现场证据 —— 发生了什么、在哪个环节、
 * 环境是什么、错误堆栈是什么。
 *
 * 硬约束（与 AGENTS.md 的日志红线一致）：
 *   1. **只存内存**：环形缓冲，不写 localStorage / sessionStorage / extensionSettings，
 *      不触发额外 saveSettingsDebounced，不影响宿主设置文件体积；
 *   2. **默认不记录用户内容**：世界书正文、聊天文本、提示词原文一律不写进日志
 *      （调用方只传条数 / 长度 / 模型名等元信息）；
 *   3. **脱敏后再入缓冲**：detail 先白名单序列化，`key` / `token` / `Authorization` /
 *      `secret` / `password` 等字段一律替换成 `***`，字符串里的 `sk-…` / `Bearer …` /
 *      `key=…` 也会被就地脱敏；栈与长文本截断，避免日志本身撑爆内存；
 *   4. **控制台镜像保留原有前缀**（`[ST-Worldbook-Editor]` / `[ST-Worldbook-Editor/runtime]`），
 *      行为与旧 console.warn/error 一致，用户无感。
 *
 * 结构：本文件是**叶子模块**（不 import 任何东西），可被 index.js / runtime.js /
 * Worldbook-Editor.js 共同引用，也可被 Node 直接单测。
 */

/** 日志级别，从低到高。 */
export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

const LEVEL_RANK = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const DEFAULT_CAPACITY = 300;
const MAX_STRING = 1600;
const MAX_KEYS = 40;
const MAX_ARRAY = 40;
const MAX_DEPTH = 4;

/** 敏感字段名（只匹配整键，不会误伤世界书条目的 `keys` / `keys_secondary`）。 */
const SENSITIVE_KEY = /^(?:key|apikey|api[-_]?key|authorization|auth|token|access[-_]?token|secret|password|passwd|cookie|set-cookie)$/i;

/** 字符串内联脱敏规则：覆盖常见的密钥形态，避免事件消息里夹带 token。 */
const INLINE_RULES = [
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
    [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
    [/\b((?:api[-_]?)?key|token|secret|password|authorization)\s*[:=]\s*["']?(?!Bearer\b)[^\s"',;}]{6,}/gi, '$1=***'],
];

function clampString(text, max = MAX_STRING) {
    const value = String(text);
    return value.length > max ? `${value.slice(0, max)}…（已截断 ${value.length - max} 字）` : value;
}

/** 对任意文本做内联脱敏 + 截断（导出、入缓冲、控制台镜像共用）。 */
export function redactText(value) {
    let text = String(value ?? '');
    for (const [pattern, replacement] of INLINE_RULES) text = text.replace(pattern, replacement);
    return clampString(text);
}

/**
 * 把任意 detail 转成可安全打印 / 存储的普通值：
 * Error → { name, message, stack }；循环引用 → '[Circular]'；DOM 节点 → '[DOM 标签]'；
 * 敏感字段 → '***'；超深 / 超长 → 占位说明。
 */
export function sanitizeDetail(value, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'string') return redactText(value);
    if (type === 'bigint') return `${value}n`;
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (type === 'symbol') return String(value);

    if (value instanceof Error) {
        const out = {
            name: String(value.name || 'Error'),
            message: redactText(value.message || ''),
            stack: clampString(value.stack || ''),
        };
        if (value.cause !== undefined && depth < MAX_DEPTH) out.cause = sanitizeDetail(value.cause, depth + 1, seen);
        return out;
    }

    if (type !== 'object') return String(value);
    if (depth >= MAX_DEPTH) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
        if (typeof value.nodeType === 'number' && typeof value.nodeName === 'string') return `[DOM ${value.nodeName}]`;
        if (Array.isArray(value)) {
            const list = value.slice(0, MAX_ARRAY).map(item => sanitizeDetail(item, depth + 1, seen));
            if (value.length > MAX_ARRAY) list.push(`…共 ${value.length} 项`);
            return list;
        }
        if (value instanceof Set) {
            const list = [...value].slice(0, MAX_ARRAY).map(item => sanitizeDetail(item, depth + 1, seen));
            if (value.size > MAX_ARRAY) list.push(`…共 ${value.size} 项`);
            return list;
        }
        if (value instanceof Map) {
            const out = {};
            let count = 0;
            for (const [k, v] of value) {
                if (count >= MAX_KEYS) { out['…'] = `…共 ${value.size} 项`; break; }
                out[String(k)] = SENSITIVE_KEY.test(String(k)) ? '***' : sanitizeDetail(v, depth + 1, seen);
                count += 1;
            }
            return out;
        }
        const out = {};
        const keys = Object.keys(value);
        for (const key of keys.slice(0, MAX_KEYS)) {
            out[key] = SENSITIVE_KEY.test(key) ? '***' : sanitizeDetail(value[key], depth + 1, seen);
        }
        if (keys.length > MAX_KEYS) out['…'] = `…共 ${keys.length} 个字段`;
        return out;
    } catch {
        return '[Unserializable]';
    } finally {
        seen.delete(value);
    }
}

function pad(value, width = 2) {
    return String(value).padStart(width, '0');
}

/** 本地时间（含毫秒），用于日志行与导出文件。 */
export function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function detailToText(detail) {
    if (detail === null || detail === undefined) return '';
    if (typeof detail === 'string') return detail;
    try {
        return JSON.stringify(detail, null, 2);
    } catch {
        return String(detail);
    }
}

function indentLines(text, prefix = '    ') {
    return String(text).split('\n').map(line => prefix + line).join('\n');
}

function makeLogger(shared, scope) {
    // 缓冲里存完整层级（wbe/runtime/ai），控制台镜像沿用旧前缀（去掉根 wbe）：
    // [ST-Worldbook-Editor] / [ST-Worldbook-Editor/runtime]。
    const consoleScope = scope === 'wbe' ? '' : String(scope || '').replace(/^wbe\//, '');
    const scopeTag = consoleScope ? `${shared.prefix}/${consoleScope}` : shared.prefix;

    function notify(event) {
        for (const listener of [...shared.listeners]) {
            try {
                listener(event);
            } catch {
                /* 日志监听只读展示，监听器异常绝不能反过来影响业务 */
            }
        }
    }

    function add(level, message, detail) {
        if (LEVEL_RANK[level] < LEVEL_RANK[shared.level]) return null;
        const entry = {
            seq: ++shared.seq,
            time: formatTime(shared.now()),
            level,
            scope,
            message: redactText(message),
            detail: detail === undefined ? null : sanitizeDetail(detail),
        };
        shared.entries.push(entry);
        if (shared.entries.length > shared.capacity) {
            shared.entries.splice(0, shared.entries.length - shared.capacity);
        }
        if (shared.mirror) {
            const method = shared.mirror[level] || shared.mirror.log;
            if (typeof method === 'function') {
                try {
                    if (entry.detail === null) method.call(shared.mirror, `[${scopeTag}]`, entry.message);
                    else method.call(shared.mirror, `[${scopeTag}]`, entry.message, entry.detail);
                } catch {
                    /* 控制台被宿主接管时静默，缓冲仍然有效 */
                }
            }
        }
        notify({ type: 'add', entry });
        return entry;
    }

    const api = {
        debug(message, detail) { return add('debug', message, detail); },
        info(message, detail) { return add('info', message, detail); },
        warn(message, detail) { return add('warn', message, detail); },
        error(message, detail) { return add('error', message, detail); },

        /** 派生子 logger：共享同一份缓冲 / 级别 / 监听器，只换 scope 层级。 */
        child(childScope) {
            const next = scope ? `${scope}/${childScope}` : String(childScope);
            return makeLogger(shared, next);
        },

        getScope() { return scope; },
        getLevel() { return shared.level; },
        setLevel(level) {
            if (!LOG_LEVELS.includes(level)) return shared.level;
            shared.level = level;
            notify({ type: 'level', level });
            return shared.level;
        },
        isEnabled(level) { return LEVEL_RANK[level] >= LEVEL_RANK[shared.level]; },
        getCapacity() { return shared.capacity; },

        /** 取出日志副本（最新在后）。level 传最低级别，limit 只取末尾 N 条。 */
        getEntries(options = {}) {
            let list = shared.entries;
            if (options.level && LEVEL_RANK[options.level]) {
                const min = LEVEL_RANK[options.level];
                list = list.filter(entry => LEVEL_RANK[entry.level] >= min);
            }
            if (options.limit > 0) list = list.slice(-options.limit);
            return list.map(entry => ({ ...entry }));
        },

        counts() {
            const out = { total: shared.entries.length, debug: 0, info: 0, warn: 0, error: 0 };
            for (const entry of shared.entries) out[entry.level] += 1;
            return out;
        },

        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            shared.listeners.add(listener);
            return () => shared.listeners.delete(listener);
        },

        clear() {
            shared.entries.length = 0;
            shared.seq = 0;
            notify({ type: 'clear' });
        },

        /** 导出为纯文本（用户可直接复制 / 下载发给开发者）。env 由调用方给环境快照。 */
        exportText(options = {}) {
            const env = options.env && typeof options.env === 'object' ? options.env : {};
            const lines = ['ST-Worldbook-Editor 诊断日志', `导出时间: ${formatTime(shared.now())}`];
            for (const [key, value] of Object.entries(env)) {
                const text = typeof value === 'string' ? value : JSON.stringify(value);
                lines.push(`${key}: ${redactText(text)}`);
            }
            lines.push(`日志级别: ${shared.level}`, `条数: ${shared.entries.length}/${shared.capacity}`, '', '--- 日志明细 ---');
            for (const entry of shared.entries) {
                lines.push(`[${entry.time}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`);
                const detail = detailToText(entry.detail);
                if (detail) lines.push(indentLines(detail));
            }
            if (!shared.entries.length) lines.push('（暂无日志）');
            return lines.join('\n');
        },
    };
    return api;
}

/** 创建独立日志实例（测试 / 多实例场景用；业务统一走 getLogger）。 */
export function createLogger(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => new Date();
    const mirror = options.mirror === undefined
        ? (typeof console !== 'undefined' ? console : null)
        : options.mirror;
    const shared = {
        capacity: Math.max(1, Number(options.capacity) || DEFAULT_CAPACITY),
        level: LOG_LEVELS.includes(options.level) ? options.level : 'info',
        entries: [],
        seq: 0,
        listeners: new Set(),
        prefix: options.prefix || 'ST-Worldbook-Editor',
        mirror,
        now,
    };
    return makeLogger(shared, options.scope || 'wbe');
}

let defaultLogger = null;

/** 业务统一使用的单例（懒创建，顶层不访问 DOM，Node 下安全）。 */
export function getLogger() {
    if (!defaultLogger) defaultLogger = createLogger({ scope: 'wbe' });
    return defaultLogger;
}

/** 仅供单测：丢弃单例，避免用例之间串日志。 */
export function resetLoggerForTests() {
    defaultLogger = null;
}

/**
 * 接管全局未捕获异常（`error` / `unhandledrejection`），让「刷新前一刻的崩溃」
 * 也能进入缓冲；返回注销函数（扩展 disable 时调用）。Node / 无 window 环境安全返回空函数。
 */
export function captureGlobalErrors(logger, target = typeof globalThis === 'undefined' ? null : globalThis) {
    const log = logger && typeof logger.error === 'function' ? logger : getLogger().child('global');
    if (!target || typeof target.addEventListener !== 'function') return () => {};

    const onError = event => {
        const error = event && event.error;
        log.error('未捕获异常', {
            message: event && event.message ? event.message : (error && error.message) || '未知错误',
            error: error || null,
            source: event && event.filename ? String(event.filename) : null,
            line: event && typeof event.lineno === 'number' ? event.lineno : null,
            column: event && typeof event.colno === 'number' ? event.colno : null,
        });
    };
    const onRejection = event => {
        log.error('未处理的 Promise 拒绝', { reason: event ? event.reason : null });
    };

    try {
        target.addEventListener('error', onError);
        target.addEventListener('unhandledrejection', onRejection);
    } catch {
        return () => {};
    }

    return () => {
        try {
            target.removeEventListener('error', onError);
            target.removeEventListener('unhandledrejection', onRejection);
        } catch {
            /* 忽略 */
        }
    };
}
