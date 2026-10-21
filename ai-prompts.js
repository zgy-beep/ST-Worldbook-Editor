/**
 * 可复用的 AI 提示词拼装与 JSON 解析。
 *
 * 该模块不依赖酒馆助手运行时，方便 Node 测试；调用方只需把
 * buildMessages() 的返回值放入 generateRaw({ ordered_prompts })。
 */

const JSON_OUTPUT_CONTRACT = '仅输出本次任务要求的有效JSON，不输出思考过程/说明/Markdown，保持原任务数组或对象结构';
const TEXT_OUTPUT_CONTRACT = '仅输出本次任务要求的正文，不输出思考过程/说明/Markdown，不要添加代码块或其他额外内容';
const RETRY_REMINDER = '【重试提醒】上一次输出不是有效 JSON。请严格只输出一个完整的 JSON 对象或对象数组，不要输出思考过程、解释、Markdown 代码块、注释或尾逗号，也不要在 JSON 前后添加任何文字。';
const STYLE_LABEL = '\n\n【创作者的统一设定与文风要求】\n';

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 拼装酒馆助手 ordered_prompts 消息数组。
 *
 * 顺序固定为：任务 system（含 style）→ 任务 user → 自定义 jailbreak user
 * → 输出契约 system → （json 且 retry 时）强化 JSON 提醒 system。
 * 不内置任何破限文案；jailbreak 为空时不会生成额外消息。
 * format='text' 时只要求正文，且不追加 JSON 重试提醒。
 *
 * @param {{system: string, user: string, style?: string, jailbreak?: string, retry?: boolean, format?: 'json'|'text'}} params
 * @returns {Array<{role: 'system'|'user', content: string}>}
 */
export function buildMessages({ system, user, style = '', jailbreak = '', retry = false, format = 'json' } = {}) {
  if (typeof system !== 'string' || !system.trim()) {
    throw new TypeError('buildMessages: system 必须是非空字符串');
  }
  if (typeof user !== 'string' || !user.trim()) {
    throw new TypeError('buildMessages: user 必须是非空字符串');
  }

  const styleText = textValue(style);
  const messages = [
    { role: 'system', content: styleText ? system + STYLE_LABEL + styleText : system },
    { role: 'user', content: user },
  ];

  const jailbreakText = typeof jailbreak === 'string' ? jailbreak : '';
  if (jailbreakText.trim()) messages.push({ role: 'user', content: jailbreakText });

  const isText = format === 'text';
  messages.push({ role: 'system', content: isText ? TEXT_OUTPUT_CONTRACT : JSON_OUTPUT_CONTRACT });
  if (!isText && retry) messages.push({ role: 'system', content: RETRY_REMINDER });

  return messages;
}

const THINKING_TAGS = ['thinking', 'think', 'reasoning', 'thought', 'analysis'];

// 同时匹配 ```json 与 ~~~json；只在这里提取“标记为 json”的围栏，普通围栏
// 仍留在正文里参与候选扫描，以免把示例代码误当成优先结果。
const FENCE_RE = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)\r?\n?[ \t]{0,3}\3[ \t]*(?=\r?\n|$)/g;

function preview(text, max = 180) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim();
  return body.length > max ? body.slice(0, max) + '…' : body;
}

function invalidJSON(reason, text) {
  const body = preview(text);
  return new Error(`AI 返回的不是有效 JSON：${reason}${body ? `。原文：${body}` : ''}`);
}

function ambiguousJSON(count, text) {
  return invalidJSON(
    `检测到 ${count} 个不同的完整 JSON 候选，无法确定哪一个是本次任务的结果；请只输出一个对象或对象数组`,
    text,
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  return ({ string: '字符串', number: '数字', boolean: '布尔值', object: '对象' })[typeof value] || typeof value;
}

/**
 * 单对象变成单元素数组；对象数组原样返回。空数组是合法结果。
 * 数组元素必须全部是对象，字符串数组、混合数组、null 与原始值一律拒绝。
 */
function normalizeParsed(value, original) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const badIndex = value.findIndex(item => !isPlainObject(item));
    if (badIndex !== -1) {
      throw invalidJSON(
        `JSON 数组第 ${badIndex + 1} 项是${valueKind(value[badIndex])}，不是对象；只接受对象或对象数组`,
        original,
      );
    }
    return value;
  }
  if (isPlainObject(value)) return [value];
  throw invalidJSON(`顶层是${valueKind(value)}，不是对象或对象数组`, original);
}

/**
 * 识别一个思考标签。仅支持本模块已知标签名，避免误删普通 HTML。
 * 返回 { closing, selfClosing, end } 或 null。
 */
function readThinkingTag(text, index) {
  if (text[index] !== '<') return null;

  let i = index + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  let closing = false;
  if (text[i] === '/') {
    closing = true;
    i += 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
  }

  let name = '';
  for (const candidate of THINKING_TAGS) {
    const part = text.slice(i, i + candidate.length).toLowerCase();
    if (part !== candidate) continue;
    const after = text[i + candidate.length];
    if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
      name = candidate;
      break;
    }
  }
  if (!name) return null;

  const gt = text.indexOf('>', i + name.length);
  if (gt === -1) return null;
  const inside = text.slice(i + name.length, gt);
  return {
    closing,
    selfClosing: !closing && /\/\s*$/.test(inside),
    end: gt + 1,
  };
}

/**
 * quote-aware 剥离思考标签：只在 JSON 结构之外的字符串状态中识别标签。
 * JSON 字符串里的 <think> 等文本会原样保留；思考块支持嵌套，未闭合时
 * 一直剥到输出末尾。只有在进入 {…}/[…] 后才把双引号视作字符串边界，
 * 避免正文里的普通引号把状态带偏。
 */
function stripThinking(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let structDepth = 0;
  let thinkingDepth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (thinkingDepth === 0) out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === '"' && structDepth > 0) {
      if (thinkingDepth === 0) out += ch;
      inString = true;
      escaped = false;
      i += 1;
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (thinkingDepth === 0) out += ch;
      structDepth += 1;
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (thinkingDepth === 0) out += ch;
      if (structDepth > 0) structDepth -= 1;
      if (structDepth === 0) inString = false;
      i += 1;
      continue;
    }

    if (ch === '<') {
      const tag = readThinkingTag(text, i);
      if (tag) {
        if (tag.closing) {
          if (thinkingDepth > 0) thinkingDepth -= 1;
          if (thinkingDepth === 0) {
            // 丢弃思考块内可能未配平的括号/字符串状态，避免影响后续正文。
            structDepth = 0;
            inString = false;
            escaped = false;
          }
        } else if (!tag.selfClosing) {
          thinkingDepth += 1;
        }
        i = tag.end;
        continue;
      }
    }

    if (thinkingDepth === 0) out += ch;
    i += 1;
  }

  return out;
}

/**
 * 按 Markdown 围栏提取代码块及字符区间。围栏内的正文不会被围栏外的
 * 扫描器重复当成多个候选。
 */
function splitFences(text) {
  const blocks = [];
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const start = match.index + match[1].length;
    const end = match.index + match[0].length;
    const info = match[4].trim();
    blocks.push({
      start,
      end,
      info,
      body: match[5],
      markedJSON: /^json(?:\s|$)/i.test(info),
    });
    if (FENCE_RE.lastIndex <= match.index) FENCE_RE.lastIndex = match.index + 1;
  }
  return blocks;
}

function removeFences(text, blocks) {
  if (!blocks.length) return text;
  let out = '';
  let cursor = 0;
  for (const block of blocks) {
    out += text.slice(cursor, block.start) + '\n';
    cursor = block.end;
  }
  return out + text.slice(cursor);
}

/**
 * 判断一个未闭合片段是否明显是要写 JSON。用于避免把
 * {"outer":{"inner":1} 这种截断对象里的内层对象“捞”出来当成成功结果；
 * 而正文里偶然出现的孤立 { 仍会跳过后继续寻找后面的真正 JSON。
 */
function looksLikeJSONStart(text, index) {
  let j = index + 1;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  if (j >= text.length) return false;
  const next = text[j];
  if (text[index] === '{') return next === '"' || next === '}';
  return (
    next === '{' || next === '[' || next === '"' || next === ']' ||
    next === '-' || (next >= '0' && next <= '9') ||
    next === 't' || next === 'f' || next === 'n'
  );
}

/**
 * 平衡括号 + 字符串状态扫描。只提取顶层完整的 {…} 或 […]；字符串中的
 * 花括号、方括号、转义引号不会影响深度。不会用“第一个 [ 到最后一个 ]”
 * 的方式吞掉多段内容。
 */
function scanBalancedSegments(text) {
  const segments = [];
  let malformed = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '{' && text[i] !== '[') {
      i += 1;
      continue;
    }

    const start = i;
    const stack = [text[i] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    let completed = false;
    let mismatched = false;
    let j = i + 1;

    for (; j < text.length; j += 1) {
      const ch = text[j];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        stack.push('}');
        continue;
      }
      if (ch === '[') {
        stack.push(']');
        continue;
      }

      const expected = stack[stack.length - 1];
      if (ch === expected) {
        stack.pop();
        if (stack.length === 0) {
          segments.push(text.slice(start, j + 1));
          i = j + 1;
          completed = true;
          break;
        }
        continue;
      }

      if (ch === '}' || ch === ']') {
        mismatched = true;
        break;
      }
    }

    if (!completed) {
      if (looksLikeJSONStart(text, start)) {
        // 这看起来是截断/错配的 JSON，不允许从它内部再捞一个“看起来完整”
        // 的子对象；只记录下来，交给 chooseResult 报错。
        malformed += 1;
        if (mismatched) i = j + 1;
        else break;
      } else {
        // 正文里的孤立括号：跳过起点继续找，避免吞掉后面的真正结果。
        i = start + 1;
      }
    }
  }

  return { segments, malformed };
}

function parseSegment(segment, original) {
  let parsed;
  try {
    parsed = JSON.parse(segment);
  } catch {
    return { ok: false, syntax: true };
  }
  try {
    return { ok: true, value: normalizeParsed(parsed, original) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 分析一段来源文本（正文或某个 json 围栏内部）。
 * 只有整段都是 JSON 时才优先直接解析；否则用平衡扫描找完整候选。
 */
function analyzeSource(source, original) {
  const text = String(source ?? '').trim();
  const result = { values: [], shapeErrors: [], completeCount: 0 };
  if (!text) return result;

  let direct;
  let directOK = false;
  try {
    direct = JSON.parse(text);
    directOK = true;
  } catch {
    // 后面走平衡扫描
  }

  if (directOK) {
    result.completeCount = 1;
    try {
      result.values.push(normalizeParsed(direct, original));
    } catch (error) {
      result.shapeErrors.push(error);
    }
    return result;
  }

  const scan = scanBalancedSegments(text);
  result.completeCount += scan.malformed;
  for (const segment of scan.segments) {
    result.completeCount += 1;
    const parsed = parseSegment(segment, original);
    if (parsed.ok) result.values.push(parsed.value);
    else if (parsed.error) result.shapeErrors.push(parsed.error);
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uniqueValues(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = canonical(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function chooseResult(analysis, original, label) {
  const values = uniqueValues(analysis.values);

  if (values.length > 1) throw ambiguousJSON(values.length, original);
  if (values.length === 1) {
    // 同一段输出里既有可用结果，又有数组元素类型错误等结构错误时，不静默
    // 选一个；这类输出本身就存在歧义。
    if (analysis.shapeErrors.length) {
      throw invalidJSON(
        `${label}中同时出现了可解析结果和不符合“对象或对象数组”要求的内容，无法确定哪一个是任务结果`,
        original,
      );
    }
    return values[0];
  }

  if (analysis.shapeErrors.length) throw analysis.shapeErrors[0];
  if (analysis.completeCount > 0) {
    throw invalidJSON(
      `${label}中找到 ${analysis.completeCount} 段 JSON 片段，但无法解析（可能是括号不完整、尾逗号、注释或非法转义；不进行自动修复）`,
      original,
    );
  }
  return null;
}

function mergeAnalysis(target, source) {
  target.values.push(...source.values);
  target.shapeErrors.push(...source.shapeErrors);
  target.completeCount += source.completeCount;
}

/**
 * 从模型输出中提取 JSON 对象或对象数组。
 *
 * 优先级：整段纯 JSON → 去除思考标签后的 ```json/~~~json 围栏 →
 * 剩余正文中的平衡候选。多个不同候选会显式报错，不猜测；错误信息始终
 * 包含“有效 JSON”，以兼容已有 askJSON 的重试判断。
 *
 * @param {unknown} text
 * @returns {object[]}
 */
export function parseAIJSON(text) {
  const raw = String(text ?? '').replace(/^\uFEFF+/, '').trim();
  if (!raw) throw invalidJSON('输出为空，没有可解析内容', raw);

  let direct;
  let directOK = false;
  try {
    direct = JSON.parse(raw);
    directOK = true;
  } catch {
    // 继续做带说明文字/围栏/思考标签的提取
  }
  if (directOK) return normalizeParsed(direct, raw);

  const withoutThinking = stripThinking(raw).trim();
  if (!withoutThinking) {
    throw invalidJSON('剥离模型思考内容后没有剩余的 JSON 结果', raw);
  }

  const fences = splitFences(withoutThinking);
  const markedFences = fences.filter(block => block.markedJSON);

  if (markedFences.length) {
    const markedAnalysis = { values: [], shapeErrors: [], completeCount: 0 };
    for (const block of markedFences) {
      mergeAnalysis(markedAnalysis, analyzeSource(block.body, raw));
    }
    // 只有 json 围栏里确实存在候选时才优先裁决；如果围栏只是写坏了，
    // 仍继续看正文，避免把后面真正合法的结果一起吞掉。
    if (markedAnalysis.values.length || markedAnalysis.shapeErrors.length) {
      const markedResult = chooseResult(markedAnalysis, raw, '标记为 json 的代码块');
      if (markedResult) return markedResult;
    }
  }

  // 已解析的 json 围栏从正文中移除，避免同一内容被重复扫描；普通围栏保留，
  // 这样里面若只是示例，会与正文中的真正结果一起触发歧义报错，而不是被
  // “选第一个/最大的”这种猜测规则误用。
  const freeText = removeFences(withoutThinking, markedFences);
  const freeAnalysis = analyzeSource(freeText, raw);
  const freeResult = chooseResult(freeAnalysis, raw, '正文');
  if (freeResult) return freeResult;

  throw invalidJSON('未找到完整的 JSON 对象或对象数组（可能缺少闭合括号，或结果被截断）', raw);
}

export default { buildMessages, parseAIJSON };
