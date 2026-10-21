import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMessages, parseAIJSON } from '../src/ai-prompts.js';

const CONTRACT = '仅输出本次任务要求的有效JSON，不输出思考过程/说明/Markdown，保持原任务数组或对象结构';

test('buildMessages 默认顺序：任务 system、任务 user、输出契约 system', () => {
  const messages = buildMessages({ system: 'TASK_SYSTEM', user: 'TASK_USER' });

  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'system']);
  assert.equal(messages[0].content, 'TASK_SYSTEM');
  assert.equal(messages[1].content, 'TASK_USER');
  assert.equal(messages[2].content, CONTRACT);
  assert.equal(messages.length, 3, '没有提供 jailbreak 时不应产生默认破限消息');
});

test('buildMessages 把 style 追加到任务 system，空白 style 不追加', () => {
  const styled = buildMessages({ system: 'TASK', user: 'USER', style: '  简洁冷峻  ' });
  assert.equal(styled[0].role, 'system');
  assert.match(styled[0].content, /^TASK/);
  assert.match(styled[0].content, /简洁冷峻/);
  assert.equal(styled.filter(message => message.role === 'user').length, 1);

  const blank = buildMessages({ system: 'TASK', user: 'USER', style: ' \n\t ' });
  assert.equal(blank[0].content, 'TASK');
});

test('buildMessages 按用户顺序拼装前置 / 后置消息，契约始终压轴', () => {
  const messages = buildMessages({
    system: 'SYS',
    user: 'USER',
    pre: [{ role: 'system', content: '框架声明' }, { role: 'user', content: '请确认以上设定' }],
    post: [{ role: 'system', content: '输出前重申' }],
  });

  assert.deepEqual(messages.map(m => m.role),
    ['system', 'user', 'system', 'user', 'system', 'system']);
  assert.equal(messages[0].content, '框架声明');
  assert.equal(messages[1].content, '请确认以上设定');
  assert.equal(messages[2].content, 'SYS');
  assert.equal(messages[3].content, 'USER');
  assert.equal(messages[4].content, '输出前重申', '后置消息必须紧邻契约之前');
  assert.equal(messages[5].content, CONTRACT, '契约必须压轴');
});

test('buildMessages 丢弃空消息并把非法 role 降级为 system', () => {
  const messages = buildMessages({
    system: 'SYS',
    user: 'USER',
    pre: [{ role: 'system', content: '   ' }, { role: 'assistant', content: '越权角色' }, { role: 'user', content: '合法' }],
    post: [{ role: 'tool', content: '另一个越权角色' }],
  });

  assert.deepEqual(messages.map(m => m.role),
    ['system', 'user', 'system', 'user', 'system', 'system']);
  assert.equal(messages[0].content, '越权角色', '前置区的 assistant 应降级为 system');
  assert.equal(messages[1].content, '合法');
  assert.equal(messages[2].content, 'SYS');
  assert.equal(messages[3].content, 'USER');
  assert.equal(messages[4].content, '另一个越权角色', '后置区的 tool 应降级为 system');
  assert.equal(messages[5].content, CONTRACT);
});

test('buildMessages 不传或传空 pre / post 时只保留任务与契约', () => {
  for (const extra of [{}, { pre: [], post: [] }, { pre: null, post: 'not-an-array' }]) {
    const messages = buildMessages({ system: 'SYS', user: 'USER', ...extra });
    assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'system']);
    assert.equal(messages[0].content, 'SYS');
  }
});

test('buildMessages style 只追加到任务 system，不影响 pre / post', () => {
  const messages = buildMessages({
    system: 'SYS', user: 'USER', style: '  简洁冷峻  ',
    pre: [{ role: 'system', content: 'PRE' }],
    post: [{ role: 'system', content: 'POST' }],
  });
  assert.equal(messages[0].content, 'PRE');
  assert.match(messages[1].content, /SYS/);
  assert.match(messages[1].content, /简洁冷峻/);
  assert.equal(messages[2].content, 'USER');
  assert.equal(messages[3].content, 'POST', 'post 消息紧邻契约之前');
  assert.equal(messages[4].content, CONTRACT);
});

test('buildMessages retry 在最后追加 JSON 强化 system，保留 pre / post', () => {
  const messages = buildMessages({
    system: 'SYS', user: 'USER',
    pre: [{ role: 'system', content: 'PRE' }],
    post: [{ role: 'system', content: 'POST' }],
    retry: true,
  });

  assert.deepEqual(messages.map(m => m.role),
    ['system', 'system', 'user', 'system', 'system', 'system']);
  assert.equal(messages[0].content, 'PRE');
  assert.equal(messages[1].content, 'SYS');
  assert.equal(messages[2].content, 'USER');
  assert.equal(messages[3].content, 'POST');
  assert.equal(messages[4].content, CONTRACT);
  assert.match(messages[5].content, /JSON/, '重试提醒必须最后');
});

test('buildMessages format=text 使用正文契约、保留 pre / post 且不追加 JSON retry', () => {
  const base = {
    system: 'SYS', user: 'USER', style: 'STYLE',
    pre: [{ role: 'system', content: 'PRE' }],
    post: [{ role: 'system', content: 'POST' }],
    retry: true,
  };
  const jsonMessages = buildMessages(base);
  const textMessages = buildMessages({ ...base, format: 'text' });

  assert.deepEqual(textMessages.map(m => m.role),
    ['system', 'system', 'user', 'system', 'system']);
  assert.equal(textMessages[0].content, 'PRE');
  assert.equal(textMessages[3].content, 'POST');
  assert.deepEqual(
    textMessages.slice(0, -1).map(m => m.content),
    jsonMessages.slice(0, 4).map(m => m.content),
    '两种格式必须共用同一套破限与任务消息',
  );

  const contract = textMessages[textMessages.length - 1].content;
  assert.match(contract, /正文/);
  assert.match(contract, /思考/);
  assert.match(contract, /Markdown/);
  assert.doesNotMatch(contract, /JSON/i);
  assert.doesNotMatch(textMessages.map(m => m.content).join('\n'), /重试提醒/);
});

test('parseAIJSON 接受纯对象并返回单元素数组，也接受对象数组与空数组', () => {
  assert.deepEqual(parseAIJSON('{"name":"甲","keys":["a","b"]}'), [{ name: '甲', keys: ['a', 'b'] }]);
  assert.deepEqual(parseAIJSON('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseAIJSON('[]'), []);
});

test('parseAIJSON 处理 trim 与 BOM', () => {
  assert.deepEqual(parseAIJSON('\uFEFF  \n {"ok":true}\n\n'), [{ ok: true }]);
});

test('parseAIJSON 处理 Markdown json 围栏及前后说明文字', () => {
  const text = '下面是本次结果：\n```json\n[{"name":"甲"},{"name":"乙"}]\n```\n请查收。';
  assert.deepEqual(parseAIJSON(text), [{ name: '甲' }, { name: '乙' }]);
});

test('parseAIJSON 剥离 think/thinking 内的假 JSON，只取真正结果', () => {
  const withThink = `<think>先想想：{"fake":true,"content":"不应采用"}</think>\n说明：\n[{"real":1}]`;
  assert.deepEqual(parseAIJSON(withThink), [{ real: 1 }]);

  const withThinking = '<thinking>\n```json\n{"fake":"thinking"}\n```\n</thinking>\n最终：\n```json\n{"real":2}\n```';
  assert.deepEqual(parseAIJSON(withThinking), [{ real: 2 }]);
});

test('parseAIJSON 保留 JSON 字符串里的 think 标签文本', () => {
  const payload = [
    {
      content: '保留 <think>文本</think> 原样',
      note: '未闭合的 <thinking> 也保留',
      nested: '外层 <think>内层</think> 结尾',
    },
  ];

  assert.deepEqual(parseAIJSON(JSON.stringify(payload)), payload);

  const plainProse = '结果如下：\n' + JSON.stringify(payload) + '\n请查收。';
  assert.deepEqual(parseAIJSON(plainProse), payload);

  const fenced = '结果如下：```json\n' + JSON.stringify(payload) + '\n```\n请查收。';
  assert.deepEqual(parseAIJSON(fenced), payload);
});

test('parseAIJSON 使用 quote-aware 剥离，字符串外的未闭合思考标签不会泄漏假结果', () => {
  const payload = [{ content: '字符串内未闭合的 <think> 标签仍保留' }];
  const fenced = '说明：\n```json\n' + JSON.stringify(payload) + '\n```';
  assert.deepEqual(parseAIJSON(fenced), payload);

  assert.throws(
    () => parseAIJSON('<think>未闭合的思考 {"fake":true}\n[{"real":4}]'),
    /有效 JSON/,
  );

  assert.deepEqual(
    parseAIJSON('[{"real":5}]\n<think>尾随未闭合的思考 {"fake":true}'),
    [{ real: 5 }],
  );
});

test('parseAIJSON 支持嵌套思考标签，并继续采用块外结果', () => {
  const text = '<think>外层 <think>内层假 JSON {"fake":true}</think> 仍在思考</think>\n最终：\n[{"real":3}]';
  assert.deepEqual(parseAIJSON(text), [{ real: 3 }]);
});

test('parseAIJSON 正确扫描字符串内的转义引号、反斜杠与括号', () => {
  const payload = {
    content: '他说："这里 } [ { 都不是结构"；反斜杠 \\ 和逗号, 都在字符串里',
    nested: { text: '结尾 }' },
  };
  const text = `说明文字\n${JSON.stringify(payload)}\n后续说明`;
  assert.deepEqual(parseAIJSON(text), [payload]);
});

test('parseAIJSON 不会把多个候选用首个 [ 到末个 ] 吞成一段', () => {
  const text = '坏的片段：{"a":1,}\n真正结果：{"b":2}\n结束';
  assert.deepEqual(parseAIJSON(text), [{ b: 2 }]);
});

test('parseAIJSON 遇到正文孤立括号仍能找到后面的完整 JSON', () => {
  const text = '说明里的孤立括号 { 不是 JSON\n真正结果：[{"ok":1}]';
  assert.deepEqual(parseAIJSON(text), [{ ok: 1 }]);
});

test('parseAIJSON 不会从截断的外层对象中捞出内层对象当成功', () => {
  assert.throws(() => parseAIJSON('{"outer":{"inner":1}'), /有效 JSON/);
});

test('parseAIJSON 拒绝字符串数组与混合数组', () => {
  assert.throws(() => parseAIJSON('["a","b"]'), /有效 JSON/);
  assert.throws(() => parseAIJSON('[{"a":1},"bad",2]'), /有效 JSON/);
  assert.throws(() => parseAIJSON('["a"]'), /对象或对象数组/);
});

test('parseAIJSON 拒绝 null、原始值和无意义输出', () => {
  assert.throws(() => parseAIJSON('null'), /有效 JSON/);
  assert.throws(() => parseAIJSON('42'), /有效 JSON/);
  assert.throws(() => parseAIJSON('true'), /有效 JSON/);
  assert.throws(() => parseAIJSON('这不是 JSON，只是普通说明文字。'), /有效 JSON/);
});

test('parseAIJSON 对不合法 JSON 抛出含“有效 JSON”的错误且截短正文', () => {
  assert.throws(() => parseAIJSON('{"a":1,}'), /有效 JSON/);
  assert.throws(() => parseAIJSON('{"a":1,}'), /不进行自动修复|无法解析/);

  const longText = '说明'.repeat(300) + '\n{"broken": }' + '结尾'.repeat(300);
  assert.throws(
    () => parseAIJSON(longText),
    error => {
      assert.match(error.message, /有效 JSON/);
      assert.ok(error.message.length < 320, `错误信息应截短，实际长度 ${error.message.length}`);
      return true;
    },
  );
});

test('parseAIJSON 对多个不同候选显式报歧义而不猜', () => {
  const text = '候选一：{"first":1}\n候选二：{"second":2}';
  assert.throws(() => parseAIJSON(text), /有效 JSON/);
  assert.throws(() => parseAIJSON(text), /候选|无法确定/);
});

test('parseAIJSON 优先明确的 json 围栏，不把正文里的小示例当结果', () => {
  const text = '示例（不要采用）：{"demo":true}\n```json\n{"actual":{"ok":true}}\n```';
  assert.deepEqual(parseAIJSON(text), [{ actual: { ok: true } }]);
});

test('parseAIJSON 对多个不同的 json 围栏同样报歧义', () => {
  const text = '```json\n{"first":1}\n```\n```json\n{"second":2}\n```';
  assert.throws(() => parseAIJSON(text), /有效 JSON/);
});

test('parseAIJSON 的 json 围栏写坏时仍不吞掉正文中的有效结果', () => {
  const text = '```json\n{"broken": }\n```\n[{"ok":1}]';
  assert.deepEqual(parseAIJSON(text), [{ ok: 1 }]);
});

test('buildMessages 参数缺失时给出明确错误', () => {
  assert.throws(() => buildMessages({ user: 'U' }), /system/);
  assert.throws(() => buildMessages({ system: 'S' }), /user/);
});
