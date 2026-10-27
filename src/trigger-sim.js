/**
 * 世界书触发仿真 · 零依赖纯函数（可被 Node 单测）
 * ==================================================================
 * 给「工具 → 触发测试」提供与 SillyTavern / 酒馆助手语义对齐的只读模拟：
 *   - 常驻条目始终命中；
 *   - 选择性 / 向量化条目命中的前提是**主关键词**至少一个命中；
 *   - 配置了次要关键词时，再按次要逻辑（and_any / and_all / not_any / not_all）判定；
 *   - 概率为 0 的条目永远不会触发（单独列为 skipped，方便用户排错）。
 *
 * 不模拟：实际概率掷骰、递归触发、向量相似度、扫描深度/角色约束。
 * 这些边界由 UI 明确说明，避免用户误以为仿真是完整运行时。
 *
 * 本模块只 import 另一个零依赖叶子模块，可被 Node 直接测试。
 */

import { isRedosPattern } from './health-rules.js';

const SEC_LABEL = Object.freeze({
  and_any: '次要词任意命中',
  and_all: '次要词全部命中',
  not_any: '次要词都不命中',
  not_all: '次要词不全命中',
});

/** 单个关键词是否在文本中命中（支持 `/pattern/flags`；高危回溯正则直接判否）。 */
export function matchKeyword(keyword, text) {
  const k = String(keyword ?? '');
  if (!k) return false;
  const t = String(text ?? '');
  const regex = k.match(/^\/(.+)\/([gimsuy]*)$/);
  if (!regex) return t.toLowerCase().includes(k.toLowerCase());
  if (isRedosPattern(regex[1])) return false;
  try {
    return new RegExp(regex[1], regex[2]).test(t);
  } catch {
    return false;
  }
}

/** 次要逻辑判定：返回 { ok, reason }。次要词为空时视为通过。 */
export function evaluateSecondary(logic, secondaryKeys, text) {
  const keys = Array.isArray(secondaryKeys) ? secondaryKeys : [];
  if (!keys.length) return { ok: true, matched: [], reason: '' };
  const matched = keys.filter(key => matchKeyword(key, text));
  const mode = SEC_LABEL[logic] ? logic : 'and_any';
  const label = SEC_LABEL[mode];
  switch (mode) {
    case 'and_all': {
      const ok = matched.length === keys.length;
      return { ok, matched, reason: ok ? `${label}（${matched.length}/${keys.length}）` : `需全部 ${keys.length} 个次要词，只命中 ${matched.length} 个` };
    }
    case 'not_any': {
      const ok = matched.length === 0;
      return { ok, matched, reason: ok ? `${label}（0/${keys.length}）` : `不应出现次要词，但命中 ${matched.length} 个` };
    }
    case 'not_all': {
      const ok = matched.length < keys.length;
      return { ok, matched, reason: ok ? `${label}（${matched.length}/${keys.length}）` : `不应全部命中次要词，实际全部命中` };
    }
    default: {
      const ok = matched.length > 0;
      return { ok, matched, reason: ok ? `${label}（${matched.length}/${keys.length}）` : `需至少 1 个次要词，实际 0 个` };
    }
  }
}

/**
 * 仿真一次触发测试。
 *
 * @param {{uid:number|string,name:string,type:string,enabled:boolean,keys:string[],keysSec:string[],secLogic:string,prob:number,order:number}[]} items
 * @param {string} text
 * @returns {{hits: object[], skipped: {uid:any,name:string,reason:string}[]}}
 */
export function simulateTrigger(items, text) {
  const hits = [];
  const skipped = [];
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (!item || item.enabled === false) continue;
    const name = String(item.name || '（无标题）');
    if (item.type === 'constant') {
      hits.push({ uid: item.uid, name, type: 'constant', order: Number(item.order) || 0, matchedKeys: [], matchedSec: [], reason: '常驻条目，始终参与注入' });
      continue;
    }
    const prob = Number(item.prob);
    if (prob === 0) {
      skipped.push({ uid: item.uid, name, reason: '触发概率为 0，永远不会触发' });
      continue;
    }
    const keys = Array.isArray(item.keys) ? item.keys : [];
    const matchedKeys = keys.filter(key => matchKeyword(key, text));
    if (!matchedKeys.length) continue;
    const secondary = evaluateSecondary(item.secLogic, item.keysSec, text);
    if (!secondary.ok) {
      skipped.push({ uid: item.uid, name, reason: `主词命中，但${secondary.reason}` });
      continue;
    }
    const reason = secondary.matched.length
      ? `主词命中 + ${secondary.reason}`
      : '主词命中（未配置次要逻辑）';
    hits.push({
      uid: item.uid, name, type: item.type || 'selective', order: Number(item.order) || 0,
      matchedKeys, matchedSec: secondary.matched, reason,
    });
  }
  hits.sort((a, b) => b.order - a.order);
  return { hits, skipped };
}
