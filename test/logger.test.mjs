import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_LEVELS,
  captureGlobalErrors,
  createLogger,
  formatTime,
  getLogger,
  redactText,
  resetLoggerForTests,
  sanitizeDetail,
} from '../src/logger.js';

const fixedNow = () => new Date(2026, 9, 26, 23, 5, 7, 42);

function quietLogger(options = {}) {
  return createLogger({ mirror: null, now: fixedNow, ...options });
}

test('日志级别：默认 info 过滤 debug，setLevel 可开关', () => {
  const log = quietLogger();
  assert.equal(log.getLevel(), 'info');
  assert.equal(log.debug('不该出现'), null);
  log.info('普通');
  log.warn('注意');
  log.error('报错');
  assert.deepEqual(log.getEntries().map(entry => entry.level), ['info', 'warn', 'error']);

  assert.equal(log.setLevel('debug'), 'debug');
  assert.equal(log.setLevel('不存在的级别'), 'debug');
  log.debug('现在可见');
  assert.equal(log.getEntries().at(-1).level, 'debug');
  assert.equal(log.isEnabled('debug'), true);
  assert.deepEqual(log.counts(), { total: 4, debug: 1, info: 1, warn: 1, error: 1 });
  assert.deepEqual(LOG_LEVELS, ['debug', 'info', 'warn', 'error']);
});

test('环形缓冲：只保留最新 capacity 条，seq 单调递增', () => {
  const log = quietLogger({ capacity: 5 });
  for (let i = 0; i < 8; i += 1) log.info(`第 ${i} 条`);
  const entries = log.getEntries();
  assert.equal(entries.length, 5);
  assert.equal(entries[0].message, '第 3 条');
  assert.equal(entries.at(-1).message, '第 7 条');
  assert.equal(entries.at(-1).seq, 8);
  assert.equal(log.getCapacity(), 5);
});

test('getEntries 支持按最低级别过滤与 limit 取末尾', () => {
  const log = quietLogger();
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepEqual(log.getEntries({ level: 'warn' }).map(entry => entry.level), ['warn', 'error']);
  assert.deepEqual(log.getEntries({ limit: 2 }).map(entry => entry.message), ['w', 'e']);
});

test('child：共享缓冲，scope 带层级路径', () => {
  const log = quietLogger();
  const runtimeLog = log.child('runtime');
  const aiLog = runtimeLog.child('ai');
  runtimeLog.warn('运行时告警');
  aiLog.error('AI 失败');
  assert.deepEqual(log.getEntries().map(entry => entry.scope), ['wbe/runtime', 'wbe/runtime/ai']);
  assert.equal(log.counts().total, 2);
  assert.match(log.exportText(), /\[WARN\] \[wbe\/runtime\]/);
});

test('脱敏：敏感字段名整体替换，世界书 keys 不受影响', () => {
  const log = quietLogger();
  log.warn('设置快照', {
    key: 'sk-should-not-leak-123456',
    apiKey: 'sk-another-secret',
    authorization: 'Bearer abcdefghijklmnop',
    nested: { token: 'tok_abcdefgh', password: 'p@ssw0rd' },
    keys: ['港口', '潮汐'],
    keys_secondary: ['海船'],
  });
  const detail = log.getEntries()[0].detail;
  assert.equal(detail.key, '***');
  assert.equal(detail.apiKey, '***');
  assert.equal(detail.authorization, '***');
  assert.equal(detail.nested.token, '***');
  assert.equal(detail.nested.password, '***');
  assert.deepEqual(detail.keys, ['港口', '潮汐']);
  const text = JSON.stringify(detail);
  for (const secret of ['sk-should-not-leak', 'sk-another-secret', 'abcdefghijklmnop', 'tok_abcdefgh', 'p@ssw0rd']) {
    assert.ok(!text.includes(secret), `日志不应包含敏感值：${secret}`);
  }
});

test('脱敏：消息文本里的 Bearer / sk- / key= 形态被就地替换', () => {
  assert.equal(redactText('Authorization: Bearer abcdefghijklmnopq'), 'Authorization: Bearer ***');
  assert.equal(redactText('模型返回 401，key=sk-1234567890abcdef'), '模型返回 401，key=***');
  const sanitized = sanitizeDetail({ note: 'Bearer zzzzzzzzzzzz', endpoint: 'https://api.example.com/v1' });
  assert.equal(sanitized.note, 'Bearer ***');
  assert.equal(sanitized.endpoint, 'https://api.example.com/v1');
});

test('sanitizeDetail：Error 保留名称/消息/栈，循环引用与深度安全', () => {
  const error = new Error('接口返回 500');
  error.name = 'HttpError';
  const circular = { name: 'loop' };
  circular.self = circular;
  const sanitized = sanitizeDetail({ error, circular, when: 1n });
  assert.equal(sanitized.error.name, 'HttpError');
  assert.equal(sanitized.error.message, '接口返回 500');
  assert.match(sanitized.error.stack, /HttpError/);
  assert.equal(sanitized.circular.self, '[Circular]');
  assert.equal(sanitized.when, '1n');

  let deep = { leaf: true };
  for (let i = 0; i < 8; i += 1) deep = { next: deep };
  assert.match(JSON.stringify(sanitizeDetail(deep)), /\[MaxDepth\]/);

  const long = 'x'.repeat(5000);
  assert.match(sanitizeDetail({ long }).long, /已截断/);
});

test('exportText：包含环境快照、级别与明细，不泄露密钥', () => {
  const log = quietLogger();
  log.info('启动完成');
  log.error('保存失败', { key: 'sk-export-secret-123456', error: new Error('quota exceeded') });
  const text = log.exportText({ env: { 扩展版本: '0.11.1', Kit: '2.8.0', 页面: 'http://127.0.0.1:8000/#chat' } });
  assert.match(text, /ST-Worldbook-Editor 诊断日志/);
  assert.match(text, /导出时间: 2026-10-26 23:05:07\.042/);
  assert.match(text, /扩展版本: 0\.11\.1/);
  assert.match(text, /\[INFO\] \[wbe\] 启动完成/);
  assert.match(text, /\[ERROR\] \[wbe\] 保存失败/);
  assert.match(text, /quota exceeded/);
  assert.ok(!text.includes('sk-export-secret'), '导出文本不得包含 API Key');
  assert.match(text, /"key": "\*\*\*"/);
});

test('导出空缓冲时给出明确占位', () => {
  assert.match(quietLogger().exportText(), /（暂无日志）/);
});

test('subscribe：add / clear / level 事件可订阅，取消后不再收到', () => {
  const log = quietLogger();
  const events = [];
  const off = log.subscribe(event => events.push(event.type));
  log.info('一');
  log.setLevel('debug');
  log.clear();
  assert.deepEqual(events, ['add', 'level', 'clear']);
  off();
  log.info('二');
  assert.deepEqual(events, ['add', 'level', 'clear']);
  // 监听器抛错不能影响写日志
  log.subscribe(() => { throw new Error('监听器炸了'); });
  assert.doesNotThrow(() => log.info('三'));
  assert.equal(log.getEntries().at(-1).message, '三');
});

test('formatTime：固定注入时间可复现', () => {
  assert.equal(formatTime(new Date(2026, 0, 2, 3, 4, 5, 6)), '2026-01-02 03:04:05.006');
});

test('captureGlobalErrors：捕获 error / unhandledrejection，注销后停止', () => {
  const handlers = new Map();
  const target = {
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type); },
  };
  const log = quietLogger();
  const dispose = captureGlobalErrors(log, target);
  assert.equal(typeof handlers.get('error'), 'function');
  assert.equal(typeof handlers.get('unhandledrejection'), 'function');

  handlers.get('error')({ message: 'smoke-boom', error: new Error('smoke-boom'), filename: 'app.js', lineno: 12, colno: 3 });
  handlers.get('unhandledrejection')({ reason: new Error('promise-boom') });
  const entries = log.getEntries({ level: 'error' });
  assert.equal(entries.length, 2);
  assert.match(entries[0].message, /未捕获异常/);
  assert.equal(entries[0].detail.message, 'smoke-boom');
  assert.match(entries[1].message, /Promise/);

  dispose();
  assert.equal(handlers.size, 0);
  assert.doesNotThrow(() => captureGlobalErrors(log, null)());
});

test('getLogger：懒创建单例，reset 后拿到新实例', () => {
  resetLoggerForTests();
  const first = getLogger();
  assert.equal(getLogger(), first);
  first.info('单例');
  assert.equal(first.counts().total, 1);
  resetLoggerForTests();
  const second = getLogger();
  assert.notEqual(second, first);
  assert.equal(second.counts().total, 0);
  resetLoggerForTests();
});
