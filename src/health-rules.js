/**
 * 世界书体检 / 触发关键词规则 · 零依赖纯函数（可被 Node 单测）
 * ==================================================================
 * 从 `Worldbook-Editor.js` 里抽出可测的判定逻辑，供两处复用：
 *   1. 触发仿真 `hit()`：命中前拦截高危回溯正则（ReDoS）；
 *   2. 世界书体检 `health()`：只读地提示「正则无效 / 概率为 0」这类永不触发的配置。
 *
 * 红线：本模块不 import 任何东西、不访问 DOM / 宿主，只做字符串与正则判定。
 */

/** 嵌套量词启发式：`(a+)+`、`(a*)*`、`a{1,}b{2,}` 这类写法可能灾难性回溯。 */
const NESTED_QUANTIFIER = /(\+|\*|\{[0-9, ]+\})\s*\)?\s*(\+|\*|\{[0-9, ]+\})/;

/** 词条关键词里用 `/pattern/flags` 写的正则，命中前需要先过 ReDoS 启发式与语法校验。 */
const REGEX_KEYWORD = /^\/(.+)\/([gimsuy]*)$/;

export function isRedosPattern(pattern) {
  return NESTED_QUANTIFIER.test(String(pattern ?? ''));
}

/**
 * 分类一个关键词：
 * - `plain`         普通文本关键词（运行时按大小写不敏感包含匹配）；
 * - `regex`         合法正则关键词；
 * - `redos`         正则形态但含高危回溯结构（运行时会被拦截）；
 * - `invalid-regex` 正则形态但语法非法（运行时永远不命中）。
 */
export function classifyKeyword(keyword) {
  const raw = String(keyword ?? '');
  const match = raw.match(REGEX_KEYWORD);
  if (!match) return 'plain';
  if (isRedosPattern(match[1])) return 'redos';
  try {
    // eslint 风格守则：这里只做语法校验，不执行匹配
    // eslint-disable-next-line no-new
    new RegExp(match[1], match[2]);
    return 'regex';
  } catch {
    return 'invalid-regex';
  }
}
