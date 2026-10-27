import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSecondary, matchKeyword, simulateTrigger } from '../src/trigger-sim.js';

const item = (patch = {}) => ({
  uid: 1, name: '港口', type: 'selective', enabled: true,
  keys: ['潮汐港'], keysSec: [], secLogic: 'and_any', prob: 100, order: 100,
  ...patch,
});

test('matchKeyword：普通词大小写不敏感，支持正则，非法/高危正则判否', () => {
  assert.equal(matchKeyword('潮汐港', '船驶入潮汐港'), true);
  assert.equal(matchKeyword('Harbor', 'the harbor is busy'), true);
  assert.equal(matchKeyword('/港(?:口|湾)/', '进入港湾'), true);
  assert.equal(matchKeyword('/港(/', '港口'), false);
  assert.equal(matchKeyword('/(a+)+/', 'aaaa'), false);
  assert.equal(matchKeyword('', '任意文本'), false);
});

test('evaluateSecondary：四种次要逻辑的边界', () => {
  assert.deepEqual(evaluateSecondary('and_any', ['船', '海'], '港口有船').ok, true);
  assert.equal(evaluateSecondary('and_any', ['船', '海'], '港口').ok, false);
  assert.equal(evaluateSecondary('and_all', ['船', '海'], '港口有船有海').ok, true);
  assert.equal(evaluateSecondary('and_all', ['船', '海'], '港口有船').ok, false);
  assert.equal(evaluateSecondary('not_any', ['船', '海'], '港口').ok, true);
  assert.equal(evaluateSecondary('not_any', ['船', '海'], '港口有船').ok, false);
  assert.equal(evaluateSecondary('not_all', ['船', '海'], '港口有船').ok, true);
  assert.equal(evaluateSecondary('not_all', ['船', '海'], '港口有船有海').ok, false);
  // 未配置次要词 / 未知逻辑回退 and_any
  assert.equal(evaluateSecondary('and_all', [], '任意').ok, true);
  assert.equal(evaluateSecondary('不存在', ['船'], '港口有船').ok, true);
});

test('simulateTrigger：常驻始终命中，选择性按主词，概率 0 单独列出', () => {
  const { hits, skipped } = simulateTrigger([
    item({ uid: 1, type: 'constant', name: '世界规则' }),
    item({ uid: 2, keys: ['潮汐港'], name: '港口' }),
    item({ uid: 3, keys: ['沙漠'], name: '沙漠' }),
    item({ uid: 4, keys: ['潮汐港'], prob: 0, name: '零概率' }),
    item({ uid: 5, keys: ['潮汐港'], enabled: false, name: '已禁用' }),
  ], '船驶入潮汐港');
  assert.deepEqual(hits.map(hit => hit.uid), [1, 2]);
  assert.equal(hits[0].reason, '常驻条目，始终参与注入');
  assert.deepEqual(hits[1].matchedKeys, ['潮汐港']);
  assert.deepEqual(skipped.map(skip => skip.uid), [4]);
  assert.match(skipped[0].reason, /概率为 0/);
});

test('simulateTrigger：次要逻辑不满足时进入 skipped 并给出原因', () => {
  const { hits, skipped } = simulateTrigger([
    item({ uid: 1, keysSec: ['船', '海'], secLogic: 'and_all', name: '需要全部次要词' }),
    item({ uid: 2, keysSec: ['船'], secLogic: 'and_any', name: '需要任意次要词' }),
    item({ uid: 3, keysSec: ['船'], secLogic: 'not_any', name: '不能出现次要词' }),
  ], '船驶入潮汐港');
  assert.deepEqual(hits.map(hit => hit.uid), [2]);
  assert.deepEqual(skipped.map(skip => skip.uid), [1, 3]);
  assert.match(skipped[0].reason, /需全部 2 个次要词/);
  assert.match(skipped[1].reason, /不应出现次要词/);
});

test('simulateTrigger：命中按 order 倒序，并带出命中词与次要词', () => {
  const { hits } = simulateTrigger([
    item({ uid: 1, order: 10, keys: ['潮汐港'], keysSec: ['船'], secLogic: 'and_any' }),
    item({ uid: 2, order: 300, keys: ['潮汐港'] }),
  ], '潮汐港的船');
  assert.deepEqual(hits.map(hit => hit.uid), [2, 1]);
  assert.deepEqual(hits[1].matchedSec, ['船']);
  assert.match(hits[1].reason, /主词命中/);
});

test('simulateTrigger：空输入安全返回', () => {
  assert.deepEqual(simulateTrigger(null, 'x'), { hits: [], skipped: [] });
  assert.deepEqual(simulateTrigger([], ''), { hits: [], skipped: [] });
});
