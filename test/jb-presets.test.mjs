import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMessages } from '../src/ai-prompts.js';
import {
  BUILTIN_JB_PRESETS,
  MAX_JB_MESSAGES,
  MAX_PRESET_NAME_CODE_POINTS,
  createCustomPreset,
  findBuiltinPresetByName,
  findCustomPresetByName,
  readCustomPresets,
  updateCustomPreset,
  validateJbDraft,
  validatePresetName,
} from '../src/jb-presets.js';

const msg = (role, content) => ({ role, content });
const region = (n, role = 'system', content = `第 ${n} 条`) => Array.from({ length: n }, (_, i) => msg(role, `${content}${i + 1}`));

test('内置预设：8 个、命名空间 id 唯一，新模板中立且不使用 assistant', () => {
  assert.equal(BUILTIN_JB_PRESETS.length, 8);
  assert.ok(Object.isFrozen(BUILTIN_JB_PRESETS));
  const ids = new Set(BUILTIN_JB_PRESETS.map(preset => preset.id));
  assert.equal(ids.size, BUILTIN_JB_PRESETS.length, '内置 id 不得重复');
  for (const preset of BUILTIN_JB_PRESETS) {
    assert.match(preset.id, /^builtin:/);
    assert.ok(preset.name && preset.hint);
    assert.ok(preset.pre.length <= MAX_JB_MESSAGES && preset.post.length <= MAX_JB_MESSAGES);
    assert.ok(preset.pre.every(message => ['system', 'user', 'accepted'].includes(message.role)));
    assert.ok(preset.post.every(message => ['system', 'user', 'assistant'].includes(message.role)));
  }

  const template = BUILTIN_JB_PRESETS.find(preset => preset.name === '世界书编辑·结构稳健');
  assert.ok(template, '必须内置「世界书编辑·结构稳健」模板');
  assert.deepEqual(template.pre.map(message => message.role), ['system', 'user']);
  assert.deepEqual(template.post.map(message => message.role), ['system']);
  const all = [...template.pre, ...template.post];
  assert.ok(!all.some(message => message.role === 'assistant'), '模板不得使用 assistant 预填充');
  const text = all.map(message => message.content).join('\n');
  assert.match(text, /虚构/);
  assert.match(text, /既有事实/);
  assert.match(text, /专有名词/);
  assert.match(text, /当前用户任务/);
  assert.doesNotMatch(text, /不受限制|忽略先前|越狱/, '模板不得包含绕过安全机制的措辞');
});

test('预设名称：trim、必填、按 40 个码点限制', () => {
  assert.deepEqual(validatePresetName('  我的结构稳健编排  '), { ok: true, name: '我的结构稳健编排' });
  assert.equal(validatePresetName('   ').ok, false);
  assert.equal(validatePresetName(123).ok, false);

  const exactly40 = '😀'.repeat(MAX_PRESET_NAME_CODE_POINTS);
  assert.deepEqual(validatePresetName(exactly40), { ok: true, name: exactly40 });
  const tooLong = '😀'.repeat(MAX_PRESET_NAME_CODE_POINTS + 1);
  const rejected = validatePresetName(tooLong);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /40/);
});

test('保存前校验：非数组 / 超 6 条 / 非法 role / 非字符串 content 全部拒绝且不裁剪', () => {
  const valid = [msg('system', '正常内容')];
  assert.equal(validateJbDraft(null, valid).ok, false);
  assert.equal(validateJbDraft(valid, 'not-an-array').ok, false);
  assert.equal(validateJbDraft([null], valid).ok, false);
  assert.equal(validateJbDraft([msg('assistant', '前置裸 assistant')], valid).ok, false);
  assert.equal(validateJbDraft(valid, [msg('accepted', '后置 accepted')]).ok, false);
  assert.equal(validateJbDraft([msg('system', 123)], valid).ok, false);

  const tooMany = region(MAX_JB_MESSAGES + 1);
  const over = validateJbDraft(tooMany, valid);
  assert.equal(over.ok, false);
  assert.match(over.error, new RegExp(String(MAX_JB_MESSAGES)));
  assert.equal(tooMany.length, MAX_JB_MESSAGES + 1, '拒绝时不得自动截断原数组');
});

test('全空占位拒绝保存；accepted 与空占位保留，结果与原数组完全解耦', () => {
  const empty = [msg('system', '   '), msg('user', '')];
  assert.equal(validateJbDraft(empty, empty).ok, false);
  assert.match(validateJbDraft(empty, empty).error, /至少要有 1 条非空消息/);

  const pre = [msg('accepted', '上一轮已接受'), msg('system', '')];
  const post = [msg('assistant', '预填充开头')];
  const draft = validateJbDraft(pre, post);
  assert.equal(draft.ok, true);
  assert.equal(draft.pre[0].role, 'accepted', '合法 accepted 不得被降级');
  assert.equal(draft.pre[1].content, '', '空占位可保留');
  assert.equal(draft.post[0].role, 'assistant');
  assert.notEqual(draft.pre, pre);
  assert.notEqual(draft.pre[0], pre[0]);

  draft.pre[0].content = '被测试改掉';
  assert.equal(pre[0].content, '上一轮已接受', '校验结果必须是独立深拷贝');
});

test('自定义预设：稳定命名空间 id、深拷贝、同名查找与更新保留 id', () => {
  const pre = [msg('system', '保存的内容')];
  const post = [msg('system', '后置内容')];
  const created = createCustomPreset({ id: 'custom:stable-1', name: '我的预设', pre, post });
  assert.equal(created.id, 'custom:stable-1');
  assert.notEqual(created.pre, pre);
  created.pre[0].content = '改副本';
  assert.equal(pre[0].content, '保存的内容');

  const auto = createCustomPreset({ name: '自动 id', pre, post });
  assert.match(auto.id, /^custom:/);
  assert.notEqual(auto.id, 'custom:');

  const updated = updateCustomPreset(
    { id: 'custom:stable-1', name: '我的预设', pre, post, legacyField: 'keep' },
    { name: '改名后', pre: [msg('system', '新内容')], post },
  );
  assert.equal(updated.id, 'custom:stable-1', '更新必须保留稳定 id');
  assert.equal(updated.legacyField, 'keep');
  assert.equal(updated.pre[0].content, '新内容');
  assert.ok(findCustomPresetByName([updated], '改名后'));
  assert.equal(findBuiltinPresetByName('基础创作框架').id, 'builtin:basic');
  assert.equal(findBuiltinPresetByName('不存在'), null);
});

test('读取自定义预设：过滤损坏条目、去重、返回独立副本且不回写', () => {
  const stored = [
    { id: 'custom:ok', name: ' 可用预设 ', pre: [msg('system', '正文')], post: [msg('system', '后置')] },
    { id: 'custom:ok', name: '重复 id', pre: [msg('system', '重复')], post: [msg('system', '重复')] },
    { id: 'builtin:not-custom', name: '错误命名空间', pre: [msg('system', 'x')], post: [msg('system', 'y')] },
    { id: 'custom:empty', name: '全空', pre: [], post: [] },
    { id: 'custom:over', name: '超六条', pre: region(7), post: [msg('system', 'y')] },
    { id: 'custom:bad-role', name: '坏角色', pre: [msg('assistant', 'x')], post: [msg('system', 'y')] },
    { id: 'custom:noname', name: '   ', pre: [msg('system', 'x')], post: [msg('system', 'y')] },
    null,
    'garbage',
  ];
  const before = JSON.stringify(stored);
  const presets = readCustomPresets(stored);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, '可用预设');
  assert.equal(presets[0].pre[0].content, '正文');
  assert.equal(JSON.stringify(stored), before, '读取不得改写持久化字段');
  presets[0].pre[0].content = '改副本';
  assert.equal(stored[0].pre[0].content, '正文');
  assert.deepEqual(readCustomPresets('not-an-array'), []);
});

test('模板经 buildMessages 的 json / text 编排与 format 契约一致', () => {
  const template = BUILTIN_JB_PRESETS.find(preset => preset.name === '世界书编辑·结构稳健');
  const json = buildMessages({
    system: '任务说明', user: '任务内容', pre: template.pre, post: template.post, format: 'json',
  });
  assert.deepEqual(json.map(message => message.role), ['system', 'user', 'system', 'user', 'system', 'system']);
  assert.equal(json[0].content, template.pre[0].content);
  assert.equal(json[1].content, template.pre[1].content);
  assert.equal(json[4].content, template.post[0].content);
  assert.match(json.at(-1).content, /JSON/);
  assert.ok(!json.some(message => message.role === 'assistant'));

  const text = buildMessages({
    system: '任务说明', user: '任务内容', pre: template.pre, post: template.post, format: 'text',
  });
  assert.equal(text.length, 6);
  assert.match(text.at(-1).content, /正文/);
  assert.doesNotMatch(text.at(-1).content, /JSON/);
  assert.ok(!text.some(message => message.role === 'assistant'));

  const textRetry = buildMessages({
    system: '任务说明', user: '任务内容', pre: template.pre, post: template.post, format: 'text', retry: true,
  });
  assert.equal(textRetry.length, 6, 'text 格式不追加 JSON 重试提醒');

  const jsonRetry = buildMessages({
    system: '任务说明', user: '任务内容', pre: template.pre, post: template.post, format: 'json', retry: true,
  });
  assert.equal(jsonRetry.length, 7);
  assert.match(jsonRetry.at(-1).content, /重试/);
  assert.equal(jsonRetry[4].content, template.post[0].content, '后置消息仍在契约与重试提醒之前');
  assert.equal(template.pre.length, 2, 'buildMessages 不得改写模板');
});
