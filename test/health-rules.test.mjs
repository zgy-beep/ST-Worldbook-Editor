import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKeyword, isRedosPattern } from '../src/health-rules.js';

test('isRedosPattern：识别嵌套量词，放过普通关键词与线性正则', () => {
  assert.equal(isRedosPattern('(a+)+'), true);
  assert.equal(isRedosPattern('(a*)*'), true);
  assert.equal(isRedosPattern('(a{1,})+'), true);
  assert.equal(isRedosPattern('港口'), false);
  assert.equal(isRedosPattern('潮汐|海港'), false);
  assert.equal(isRedosPattern('^港口$'), false);
  assert.equal(isRedosPattern('(?:港|湾)+'), false);
  assert.equal(isRedosPattern(''), false);
});

test('classifyKeyword：普通 / 合法正则 / 非法正则 / 高危回溯', () => {
  assert.equal(classifyKeyword('潮汐港'), 'plain');
  assert.equal(classifyKeyword('海港|船舶'), 'plain');
  assert.equal(classifyKeyword('/港(?:口|湾)/'), 'regex');
  assert.equal(classifyKeyword('/港口/gi'), 'regex');
  assert.equal(classifyKeyword('/港(/'), 'invalid-regex');
  assert.equal(classifyKeyword('/(a+)+/'), 'redos');
  assert.equal(classifyKeyword('/(a*)*b/'), 'redos');
  // 空值与异常输入不抛错
  assert.equal(classifyKeyword(''), 'plain');
  assert.equal(classifyKeyword(null), 'plain');
  assert.equal(classifyKeyword(undefined), 'plain');
  assert.equal(classifyKeyword(123), 'plain');
});
