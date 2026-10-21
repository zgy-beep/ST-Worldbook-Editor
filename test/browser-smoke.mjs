import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs against a local ST fixture. No requests go to a model or a live worldbook.
const require = createRequire(import.meta.url);

/**
 * 解析 Playwright。
 *
 * 本项目刻意保持零依赖（package.json 不声明 playwright），所以这里不自动安装，
 * 而是把可用的来源依次试一遍：显式指定的 PLAYWRIGHT_MODULE_PATH → playwright → playwright-core。
 * 全都失败时打印可操作的修复指引，而不是抛裸 MODULE_NOT_FOUND。
 */
function resolveChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    'playwright-core',
  ].filter(Boolean);
  const tried = [];

  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && mod.chromium) return mod.chromium;
      tried.push(`${candidate} → 已加载，但没有导出 chromium`);
    } catch (err) {
      tried.push(`${candidate} → ${err.code || err.message}`);
    }
  }

  console.error([
    '',
    '[browser-smoke] 无法加载 Playwright，浏览器冒烟测试未启动。',
    '',
    '本项目保持零依赖，不会自动安装 Playwright。请任选一种方式解决：',
    '',
    '  1) 安装到本项目：',
    '       npm i -D playwright && npx playwright install chromium',
    '',
    '  2) 指向本机已有的 playwright / playwright-core 目录：',
    '       cmd       : set PLAYWRIGHT_MODULE_PATH=C:/path/to/node_modules/playwright-core',
    '       PowerShell: $env:PLAYWRIGHT_MODULE_PATH="C:/path/to/node_modules/playwright-core"',
    '       bash      : export PLAYWRIGHT_MODULE_PATH=/path/to/node_modules/playwright-core',
    '',
    '  3) 改用系统 Chrome（需同时设置 CHROME_PATH）：',
    '       set CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"',
    '',
    '已尝试的来源：',
    ...tried.map(entry => `  - ${entry}`),
    '',
  ].join('\n'));
  process.exit(1);
}

const chromium = resolveChromium();

/** 启动浏览器；缺少浏览器二进制时给出 CHROME_PATH 指引。 */
async function launchBrowser() {
  const options = { headless: true };
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH;

  try {
    return await chromium.launch(options);
  } catch (err) {
    console.error([
      '',
      '[browser-smoke] 浏览器启动失败。',
      '',
      `原始错误：${err.message}`,
      '',
      '若提示找不到浏览器二进制，请任选一种方式解决：',
      '  1) npx playwright install chromium',
      '  2) 设置 CHROME_PATH 指向系统 Chrome / Edge：',
      '       set CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"',
      '',
    ].join('\n'));
    process.exit(1);
  }
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stPublic = process.env.ST_PUBLIC_DIR || resolve(root, '../../APP/SillyTavern/public');
const jquery = await readFile(resolve(stPublic, 'lib/jquery-3.5.1.min.js'));
const fixture = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/host/css/fontawesome.min.css">
<link rel="stylesheet" href="/src/styles/style.css"><style>
html { transform: translateZ(0); } body { margin:0; font-family: sans-serif; }
#sheld { position:absolute; inset:0; z-index:30; background:#30343b; }
#extensionsMenu { position:relative; z-index:31; } button { font:inherit; }
/* 模拟宿主第三方酒馆主题对全局表单控件的 !important 覆盖
   （真实环境见 ST-Styles 等主题：元素选择器 + !important + 宿主主题色）。
   没有这段，浅色主题下的配色断言就恒成立、失去区分力。 */
input[type="text"], input[type="number"], input:not([type]),
textarea:not([type="search"]) {
  background-color: #2e2e34 !important;
  border: 1px solid #4a4a52 !important;
}
select {
  background-color: #2e2e34 !important;
  border: 1px solid #4a4a52 !important;
  margin: 4px 0 !important;
}
select option { background-color: #2e2e34 !important; }
input[type="checkbox"] {
  appearance: none; display: grid;
  background-color: #13131a;
  box-shadow: 0 0 0 1px #9ca3af;
}
</style></head><body><div id="sheld"></div>
<div id="extensionsMenu"><button id="extensionsMenuButton">扩展菜单</button></div>
<script src="/jquery.js"></script><script>
window.saved = 0; window.calls = []; window.notices = []; window.listeners = new Map();
window.invalidOnce = true; window.replyKind = 'batch';
window.settings = { unrelated: { keep: true } };
window.toastr = Object.fromEntries(['info','error','warning','success'].map(k => [k, m => notices.push([k,m])]));
window.eventBus = {
  on(k, fn) { const s = listeners.get(k) || new Set(); s.add(fn); listeners.set(k,s); },
  once(k, fn) { const f=(...a)=>{this.removeListener(k,f);fn(...a)}; this.on(k,f); },
  removeListener(k, fn) { listeners.get(k)?.delete(fn); },
  emit(k) { for(const fn of [...(listeners.get(k)||[])]) fn(); }
};
window.SillyTavern = { getContext: () => ({
  extensionSettings: settings, saveSettingsDebounced: () => saved++,
  eventSource: eventBus, eventTypes: { APP_READY: 'app_ready', APP_INITIALIZED: 'app_initialized' }
}) };
window.entries = [{uid:1,name:'港口',content:'潮汐港是一座繁忙的港口。',enabled:true,
  strategy:{type:'selective',keys:['潮汐港'],keys_secondary:{logic:'and_any',keys:[]}},
  position:{type:'after_character_definition',depth:0,order:100},probability:100,group:''},
  // 填充条目：把列表撑高，使 .nvui-panel-body 可滚动，才能验证滚动行为。
  // uid 从 100 起，避开 createWorldbookEntries 使用的 10+i 段位。
  ...Array.from({length:20},(_,i)=>({uid:100+i,name:'填充条目 '+(i+1),
    content:'第 '+(i+1)+' 条填充内容。'.repeat(4),enabled:true,
    strategy:{type:'selective',keys:['填充'+(i+1)],keys_secondary:{logic:'and_any',keys:[]}},
    position:{type:'after_character_definition',depth:0,order:100},probability:100,group:''}))];
window.TavernHelper = {
  getWorldbookNames: () => ['验收世界书'], getWorldbook: async()=>structuredClone(entries),
  updateWorldbookWith: async(book, fn) => { entries=await fn(structuredClone(entries));return entries; },
  createWorldbookEntries: async(book, list) => {entries.push(...list.map((e,i)=>({...e,uid:10+i})));return entries;},
  deleteWorldbookEntries: async(book, fn) => {entries=entries.filter(e=>!fn(e));return {worldbook:entries};},
  generateRaw: async cfg => { calls.push(structuredClone(cfg));
    if (invalidOnce) {invalidOnce=false;return '这里是格式错误的说明文字';}
    if (replyKind==='keys') return JSON.stringify({keys:['海港','船舶']});
    if (replyKind==='text') return '港口的灯火沿着海岸延伸。';
    return '<think>先分析例子 [{"uid":999,"content":"忽略"}]</think>\\n结果如下：\\n' +
      '\u0060\u0060\u0060json\\n[{"uid":1,"content":"潮汐港是一座依海而建的繁忙港口。"}]\\n\u0060\u0060\u0060'; }
};
localStorage.setItem('wbe_settings_v1', JSON.stringify({style:'保留原有地名',temp:0.4}));
localStorage.setItem('wbe_other_plugin', 'preserve');
</script><script type="module">
window.extension = await import('/src/index.js');
for(const name of ['onActivate','init','activate']) if(typeof extension[name]==='function') { await extension[name]();break; }
eventBus.emit('app_initialized'); eventBus.emit('app_ready');
</script></body></html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return; }
    if (pathname === '/jquery.js') {res.setHeader('Content-Type','text/javascript');res.end(jquery);return;}
    if (pathname.startsWith('/host/')) {
      const target=resolve(stPublic,pathname.slice(6));
      if(!target.startsWith(stPublic+sep)) {res.writeHead(403).end();return;}
      res.setHeader('Content-Type',types[extname(target)]||'application/octet-stream');
      res.end(await readFile(target));return;
    }
    const target = resolve(root, '.' + pathname);
    if (!target.startsWith(root + sep)) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await launchBrowser();
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const context = await browser.newContext({viewport:{width:1280,height:900}, reducedMotion:'reduce'});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
page.on('request', req => { assert.ok(req.url().startsWith(origin), `Unexpected external request: ${req.url()}`); });

try {
  await page.goto(origin);
  await page.locator('#wbe-menu').waitFor();
  await page.locator('#wbe-menu').click();
  await page.locator('#wbe-overlay:not([hidden])').waitFor();
  await page.locator('.wbe-row').first().waitFor();
  const desktop = await page.locator('.nvui-panel').boundingBox();
  assert.equal(Math.round(desktop.width),720);
  assert.ok(await page.locator('.nvui-tabs').isVisible());
  assert.equal(await page.locator('.nvui-bottom-nav').isVisible(),false);
  assert.equal(await page.locator('dialog:modal').count(),0);
  assert.equal(await page.evaluate(()=>typeof window.generateRaw),'undefined');
  assert.equal(await page.evaluate(()=>settings.st_worldbook_editor.style),'保留原有地名');
  await page.screenshot({path:resolve(root,'.test-output/entries.png')});

  // 破限页：前置 / 后置各加一条消息，验证它们进到请求的正确位置
  await page.locator('#wbe-tab-jb').click();
  await page.locator('[data-a=jbadd][data-k=pre]').click();
  await page.locator('#wbe-jbpre .wbe-jbtext').first().fill('保持创作上下文，直接完成编辑任务。');
  await page.locator('[data-a=jbadd][data-k=post]').click();
  // role 白名单：前置区不得提供 assistant（多数 API 拒绝首条非 user/system）
  const roleOpts = await page.evaluate(() => ({
    pre: [...document.querySelectorAll('#wbe-jbpre .wbe-jbrole option')].map(o => o.value),
    post: [...document.querySelectorAll('#wbe-jbpost .wbe-jbrole option')].map(o => o.value),
  }));
  assert.deepEqual(roleOpts.pre, ['system', 'user'], '前置区不应提供 assistant');
  assert.deepEqual(roleOpts.post, ['system', 'user', 'assistant'], '后置区应提供 assistant 预填充');
  await page.locator('#wbe-jbpost .wbe-jbtext').first().fill('结尾重申：按既定尺度输出。');
  await page.evaluate(()=>{window.jbNode=document.querySelector('#wbe-jbpre .wbe-jbtext');});

  await page.locator('#wbe-tab-ai').click();
  await page.locator('[name=instr]').fill('润色港口描述');
  await page.locator('[data-a=aigo]').click();
  await page.locator('[data-a=aiapply]').waitFor();
  const prompts = await page.evaluate(()=>calls[0].ordered_prompts);
  assert.ok(prompts[0].content.includes('保持创作上下文'), '前置消息必须是第一条');
  assert.equal(prompts[0].role, 'system', '破限消息默认以 system 口吻下达');
  const tailIdx = prompts.findIndex(p=>p.content.includes('结尾重申'));
  // 契约固定压轴（最后一条），后置消息必须紧邻它之前
  assert.equal(tailIdx, prompts.length - 2,
    `后置消息应紧邻输出契约之前（tail=${tailIdx} len=${prompts.length}）`);
  assert.ok(prompts.at(-1).content.includes('JSON'));
  assert.equal(await page.evaluate(()=>calls.length),2);
  assert.match(await page.evaluate(()=>calls[1].ordered_prompts.at(-1).content),/重试/);
  assert.ok(await page.evaluate(()=>calls[1].ordered_prompts.some(p=>p.content.includes('保持创作上下文'))));
  assert.ok(await page.evaluate(()=>calls[1].ordered_prompts.some(p=>p.content.includes('结尾重申'))));
  assert.ok(await page.locator('.wbe-card').count());
  assert.equal(await page.evaluate(()=>entries[0].content),'潮汐港是一座繁忙的港口。');

  // 切 tab 不应重建 DOM：破限页节点在来回切换后必须是同一个引用
  await page.locator('#wbe-tab-set').click();
  await page.locator('#wbe-tab-jb').click();
  assert.ok(await page.evaluate(()=>window.jbNode===document.querySelector('#wbe-jbpre .wbe-jbtext')));
  assert.equal(await page.locator('#wbe-jbpost .wbe-jbtext').first().inputValue(),'结尾重申：按既定尺度输出。');

  await page.locator('#wbe-tab-ai').click();
  assert.equal(await page.locator('[name=instr]').inputValue(),'润色港口描述');
  await page.locator('[data-a=aiapply]').click();
  await page.waitForFunction(()=>entries[0].content.includes('依海而建'));
  // The updated helper API must receive patches in its own modern shape.
  assert.equal(await page.evaluate(()=>entries[0].strategy.type),'selective');

  // Preserve text-only editing and keyword extraction, including custom API config.
  await page.locator('#wbe-tab-set').click();
  await page.locator('[data-a=smode][data-v=custom]').click();
  for(const [name,value] of [['s_apiurl','https://example.test/v1'],['s_model','fixture-model']]) {
    await page.locator(`[name=${name}]`).fill(value);await page.locator(`[name=${name}]`).press('Tab');
  }
  await page.locator('#wbe-tab-entries').click();
  await page.evaluate(()=>replyKind='keys');
  await page.locator('[data-a=aikeys]').click();
  await page.locator('.wbe-mainchips [data-k="海港"]').waitFor();
  const custom=await page.evaluate(()=>calls.at(-1).custom_api);
  assert.equal(custom.model,'fixture-model');assert.equal(custom.apiurl,'https://example.test/v1');
  await page.evaluate(()=>replyKind='text');
  await page.locator('[data-a=selai][data-i="0"]').click();
  await page.locator('[data-a=selrep]').waitFor();
  assert.doesNotMatch(await page.evaluate(()=>calls.at(-1).ordered_prompts.at(-1).content),/JSON/);
  assert.ok(await page.evaluate(()=>calls.at(-1).ordered_prompts.some(p=>p.content.includes('保持创作上下文'))));
  await page.locator('[data-a=seldrop]').click();
  await page.locator('[data-a=save]').click();
  await page.waitForFunction(()=>entries[0].strategy.keys.includes('海港'));
  await page.locator('#wbe-tab-ai').click();

  await page.locator('.nvui-theme-toggle').click();
  assert.ok(await page.locator('#wbe-layer').evaluate(el=>el.classList.contains('nvui-theme-light')));
  await page.screenshot({path:resolve(root,'.test-output/light.png')});
  await page.locator('.nvui-theme-toggle').click();

  await page.evaluate(()=>{
    const dlg=document.createElement('dialog');dlg.id='host-modal';dlg.textContent='宿主模态';
    document.body.append(dlg);dlg.showModal();
  });
  await page.waitForFunction(()=>document.querySelector('#wbe-layer').classList.contains('is-host-modal'));
  await page.evaluate(()=>{document.querySelector('#host-modal').close();document.querySelector('#host-modal').remove();});
  await page.waitForFunction(()=>!document.querySelector('#wbe-layer').classList.contains('is-host-modal'));

  // 回归：选择条目不得引起滚动跳动。
  // 列表与编辑区共享 Kit 的唯一滚动层 .nvui-panel-body，一旦该层被 scrollIntoView
  // 拉走，左侧列表会跟着一起跳走（实测 Δ -768px），用户刚点的那一行直接被滚出视野。
  await page.locator('#wbe-tab-entries').click();
  await page.evaluate(() => {
    window.__sivCalls = 0;
    const orig = Element.prototype.scrollIntoView;
    window.__sivRestore = () => { Element.prototype.scrollIntoView = orig; };
    Element.prototype.scrollIntoView = function (...args) { window.__sivCalls++; return orig.apply(this, args); };
  });
  await page.evaluate(() => { document.querySelector('.nvui-panel-body').scrollTop = 150; });
  await page.waitForTimeout(200);
  const scrollBefore = await page.evaluate(() => document.querySelector('.nvui-panel-body').scrollTop);
  await page.locator('.wbe-row').nth(5).click();
  await page.waitForTimeout(300);
  const scrollAfter = await page.evaluate(() => document.querySelector('.nvui-panel-body').scrollTop);
  assert.equal(await page.evaluate(() => window.__sivCalls), 0, '选择条目不应调用 scrollIntoView');
  assert.equal(scrollAfter, scrollBefore, `选择条目不应引起滚动跳动 (${scrollBefore} -> ${scrollAfter})`);
  await page.evaluate(() => window.__sivRestore());
  await page.locator('#wbe-tab-ai').click();

  // 回归：浅色主题下，关键词输入框必须透明嵌在 chips 容器里。
  // 宿主的 `input:not([type])` 会命中 .wbe-chipin（它没有 type 属性），
  // 未隔离时浅色主题下会变成一块突兀的深色长条。
  await page.locator('#wbe-tab-entries').click();
  await page.waitForTimeout(200);
  await page.locator('.nvui-theme-toggle').click();
  await page.waitForTimeout(300);
  const chipInBg = await page.evaluate(() => getComputedStyle(document.querySelector('.wbe-chipin')).backgroundColor);
  assert.match(chipInBg, /rgba\(0, 0, 0, 0\)/, `关键词输入框应透明，实际 ${chipInBg}`);
  const chkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.wbe-chk')).backgroundColor);
  // 浅色主题下 --nvui-input-bg = rgba(255,255,255,0.9)；宿主默认是 #13131a 深色
  assert.match(chkBg, /rgba\(255, 255, 255, 0\.9\)/, `批量选择复选框应跟随 Kit 令牌，实际 ${chkBg}`);
  await page.locator('.nvui-theme-toggle').click();
  await page.waitForTimeout(250);
  // 切回 AI 标签：Kit 会持久化当前标签，后续流程期望重开后停在 AI
  await page.locator('#wbe-tab-ai').click();
  await page.waitForTimeout(200);

  // 回归：折叠条开合状态必须持久化。
  // v2.6.0 起由 Kit 的 panel.adoptAccordions() 接管（GitHub issue #11），
  // 状态存在 Kit 自己的 nvui_state_wbe.accordion 里，键取折叠条的稳定 id。
  await page.locator('#wbe-tab-set').click();
  await page.waitForTimeout(250);
  await page.locator('#wbe-acc-api .nvui-acc-head').click();
  await page.waitForTimeout(700);
  // Kit 的落盘有 250ms 防抖，等它真正写进 storage 再断言
  const accDiag = await page.waitForFunction(() => {
    const st = (settings.st_worldbook_editor.layout || {}).nvui_state_wbe;
    const acc = st && st.accordion;
    if (acc && acc['wbe-acc-api'] === false) return { ok: true, accordion: acc };
    const setAccs = [...document.querySelectorAll('#wbe-set .nvui-acc')];
    return {
      ok: false,
      accordion: acc,
      apiOpen: document.querySelector('#wbe-acc-api')?.classList.contains('is-open'),
      setAccSetOpen: setAccs.map(a => typeof a.setOpen),
      setAccIds: setAccs.map(a => a.id),
    };
  }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => ({ ok: false, timeout: true }));
  assert.ok(accDiag && accDiag.ok, `折叠条状态未写入：${JSON.stringify(accDiag)}`);
  // 切回 AI 标签：Kit 会持久化当前标签，后续流程期望重开后停在 AI
  await page.locator('#wbe-tab-ai').click();
  await page.waitForTimeout(200);

  await mkdir(resolve(root,'.test-output'),{recursive:true});
  await page.screenshot({path:resolve(root,'.test-output/desktop.png')});
  // Kit persists layout with a 250ms debounce; wait for its observable storage write.
  await page.waitForFunction(()=>Object.keys(settings.st_worldbook_editor.layout||{}).length>0);
  await page.locator('[aria-label="关闭面板"]').click();
  await page.waitForFunction(()=>document.querySelector('#wbe-overlay').hidden);
  assert.ok(await page.evaluate(()=>['wbe-menu','extensionsMenuButton'].includes(document.activeElement.id)));
  await page.locator('#wbe-menu').click();
  await page.waitForFunction(()=>document.querySelector('#wbe-pane-ai').classList.contains('is-active'));

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.nvui-tabs').isVisible(),false);
  assert.ok(await page.locator('.nvui-bottom-nav').isVisible());
  const mobile = await page.locator('.nvui-panel').boundingBox();
  assert.ok(mobile.x>=0 && mobile.x+mobile.width<=391);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(root,'.test-output/mobile.png')});

  // 回归：移动端单栏下，选中条目后编辑区标题栏必须进入可视区（revealEditTop 生效）。
  await page.locator('.nvui-bottom-nav-item[data-key="entries"]').click();
  await page.waitForTimeout(250);
  const backBtn = page.locator('.wbe-back');
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    if (getComputedStyle(document.querySelector('#wbe-list')).display === 'none') {
      document.querySelector('#wbe-md').classList.remove('show-edit');
    }
  });
  await page.waitForTimeout(250);
  await page.locator('.wbe-row').nth(5).click();
  await page.waitForTimeout(350);
  const mobileBar = await page.evaluate(() => {
    const pb = document.querySelector('.nvui-panel-body');
    const bar = document.querySelector('#wbe-ebar');
    const b = bar.getBoundingClientRect(), p = pb.getBoundingClientRect();
    return {
      listHidden: getComputedStyle(document.querySelector('#wbe-list')).display === 'none',
      visible: b.top >= p.top - 1 && b.bottom <= p.bottom + 1,
      barTop: Math.round(b.top), panelTop: Math.round(p.top),
    };
  });
  assert.ok(mobileBar.listHidden, '移动端选中条目后应切换到单栏编辑视图');
  assert.ok(mobileBar.visible,
    `移动端选中后编辑区标题栏应可见 (barTop=${mobileBar.barTop} panelTop=${mobileBar.panelTop})`);

  // Disabling and activating must clean up and recreate exactly one menu/panel.
  await page.evaluate(async()=>{
    if(extension.onDisable) await extension.onDisable();
    else if(extension.destroy) await extension.destroy();
  });
  assert.equal(await page.locator('#wbe-menu').count(),0);
  assert.equal(await page.locator('#wbe-layer').count(),0);
  await page.evaluate(async()=>{
    for(const name of ['onActivate','init','activate']) if(typeof extension[name]==='function') {await extension[name]();break;}
  });
  await page.locator('#wbe-menu').waitFor();
  assert.equal(await page.locator('#wbe-menu').count(),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('wbe_other_plugin')),'preserve');

  // 重建面板后，折叠条开合状态应从扩展设置里恢复。
  await page.locator('#wbe-menu').click();
  await page.waitForFunction(()=>{
    const o=document.querySelector('#wbe-overlay');return o && !o.hidden;
  });
  await page.waitForTimeout(300);
  const accRestored = await page.evaluate(() => {
    const acc = document.querySelector('#wbe-acc-api');
    return acc ? acc.classList.contains('is-open') : null;
  });
  assert.equal(accRestored, false, '重建面板后折叠条应保持折叠状态');
  assert.deepEqual(errors,[]);
  console.log('Browser smoke passed: standard entry, migration, helper bridge, AI prompts/parse/apply, tabs, desktop/mobile, host modal, layout, lifecycle.');
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
}
