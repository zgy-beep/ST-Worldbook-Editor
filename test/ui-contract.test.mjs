import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g,'');
// 同时包含未跟踪的新文件，避免新加的样式/模块在依赖检查里被漏掉
const trackedFiles = () => execSync('git ls-files --cached --others --exclude-standard',{cwd:repoRoot,encoding:'utf8'}).trim().split('\n').filter(Boolean);

test('extension manifest references local assets and exported lifecycle hooks',async()=>{
  const manifest=JSON.parse(read('manifest.json'));
  assert.equal(manifest.version,'0.11.1');
  for(const key of ['js','css']) assert.ok(existsSync(new URL('../'+manifest[key],import.meta.url)));
  const source=read(manifest.js);
  for(const hook of Object.values(manifest.hooks)) assert.match(source,new RegExp(`export (?:async )?function ${hook}\\(`));
  assert.deepEqual(manifest.requires,[]);
});

test('business CSS obeys Kit tokens, scoping, and host compatibility constraints',()=>{
  const css=stripComments(read('src/styles/style.css'));
  const tokens=read('ui-kit/tokens.css');
  const defined=new Set([...tokens.matchAll(/(--nvui-[\w-]+)\s*:/g)].map(m=>m[1]));
  for(const match of css.matchAll(/var\((--nvui-[\w-]+)/g)) assert.ok(defined.has(match[1]),match[1]);
  assert.doesNotMatch(css,/!important|#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(css,/z-index\s*:\s*\d|position\s*:\s*fixed|--SmartTheme/);
  // Strip at-rules before checking each ordinary selector's scope.
  for(const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector=match[1].trim();if(selector.startsWith('@')) continue;
    for(const part of selector.split(',')) assert.ok(part.trim().startsWith('#wbe-overlay'),part);
  }
});

test('host isolation layer is scoped, token-only, and the only place allowed to use !important',()=>{
  const css=stripComments(read('src/styles/host-isolation.css'));
  // 允许 !important（对抗宿主主题的全局 !important），但禁止颜色字面量。
  assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(css,/--SmartTheme/);
  // 必须全部限定在 #wbe-overlay 内，不能污染酒馆宿主。
  for(const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector=match[1].trim();if(selector.startsWith('@')) continue;
    for(const part of selector.split(',')) assert.ok(part.trim().startsWith('#wbe-overlay'),part);
  }
  // 必须真的用上 !important，否则等于没隔离。
  assert.match(css,/!important/);
  // 取值只能走 Kit 令牌。
  const tokens=read('ui-kit/tokens.css');
  const defined=new Set([...tokens.matchAll(/(--nvui-[\w-]+)\s*:/g)].map(m=>m[1]));
  for(const match of css.matchAll(/var\((--nvui-[\w-]+)/g)) assert.ok(defined.has(match[1]),match[1]);
  // 业务样式必须导入这一层，否则宿主主题一装就失效。
  assert.match(stripComments(read('src/styles/style.css')),/@import\s+url\(['"]?\.?\/host-isolation\.css['"]?\)/);
});

test('Kit version and desktop geometry match the requested 2.8.0 standard',()=>{
  const kitVersion=JSON.parse(read('ui-kit/package.json')).version;
  assert.equal(kitVersion,'2.8.0');
  assert.match(read('ui-kit/tokens.css'),/--nvui-panel-width:\s*720px/);
  // v2.8.0 新增 --nvui-kit-version 令牌，必须与 package.json 同版本
  assert.match(read('ui-kit/tokens.css'),new RegExp(`--nvui-kit-version:\\s*["']?${kitVersion.replace(/\./g,'\\.')}`));
  // 业务侧的 Kit 版本守卫不能漂移：升级 Kit 时必须同步 index.js / Worldbook-Editor.js
  for(const file of ['src/index.js','src/Worldbook-Editor.js']) {
    assert.match(read(file),new RegExp(`['"]${kitVersion.replace(/\./g,'\\.')}['"]`),`${file} 的 Kit 版本守卫未同步到 ${kitVersion}`);
  }
  assert.doesNotMatch(read('src/Worldbook-Editor.js'),/cdn\.jsdelivr|2147483647|showModal\(/);
});

test('Kit v2.8.0 self-check is wired into the bootstrap',()=>{
  const source=read('src/index.js');
  assert.match(source,/const KIT_VERSION = '2\.8\.0'/);
  // 运行时自检：版本 / CSS / 玻璃回退一次性诊断
  assert.match(source,/selfCheck\(/);
  assert.match(source,/expect:\s*KIT_VERSION/);
  // 玻璃自动回退是宿主正常降级，不能当成异常反复告警
  assert.match(source,/KIT_SELF_CHECK_IGNORED_ISSUES/);
});

test('diagnostic logger is a zero-dependency leaf wired into bootstrap and settings UI',()=>{
  const loggerSource=read('src/logger.js');
  // 叶子模块：不得 import 任何东西（Node 单测 / 无宿主环境都要能加载）
  assert.doesNotMatch(loggerSource,/^\s*import\s/m);
  // 脱敏红线：敏感字段名 + 运行时密钥形态
  assert.match(loggerSource,/SENSITIVE_KEY/);
  for(const pattern of ['api[-_]?key','authorization','Bearer','sk-']) {
    assert.ok(loggerSource.includes(pattern),`日志脱敏缺少 ${pattern}`);
  }
  // 三个运行时模块统一走 logger，不再各自裸 console
  for(const file of ['src/index.js','src/runtime.js','src/Worldbook-Editor.js']) {
    assert.match(read(file),/from '\.\/logger\.js'/,`${file} 未接入 logger`);
  }
  // 入口：全局异常捕获 + DevTools 排障句柄
  const indexSource=read('src/index.js');
  assert.match(indexSource,/captureGlobalErrors/);
  assert.match(indexSource,/__wbeLog/);
  // 运行时给日志导出提供宿主版本快照
  assert.match(read('src/runtime.js'),/export function getHostInfo/);
  // 设置页：诊断日志折叠条 + 四个动作
  const editorSource=read('src/Worldbook-Editor.js');
  assert.match(editorSource,/wbe-acc-diag/);
  for(const action of ['logcopy','logsave','logclear','logdebug']) {
    assert.match(editorSource,new RegExp(`data-a="${action}"`));
  }
  // 面板增高契约：关闭 size 持久化（防旧 px 存档压矮）+ 业务作用域内把高度 token 提到 94vh
  assert.match(editorSource,/persist: \{ size: false/);
  assert.match(stripComments(read('src/styles/style.css')),/--nvui-panel-max-h:\s*94vh/);
});

test('form controls reuse Kit components instead of re-skinning them',()=>{
  const js=read('src/Worldbook-Editor.js');
  // 批量选择复选框必须复用 Kit 的 .nvui-checkbox（不再自绘皮肤）
  assert.match(js,/class="nvui-checkbox wbe-chk"/);
  // 折叠条交给 Kit 接管持久化，而不是自己往 layout 里塞自定义键
  assert.match(js,/panel\.adoptAccordions\(/);
  assert.doesNotMatch(js,/wbe_acc_state/);
  // 业务样式不得重画 .nvui-checkbox 的皮肤
  assert.doesNotMatch(stripComments(read('src/styles/style.css')),/#wbe-overlay \.wbe-chk\s*\{/);
  // 上游已内置 .nvui-input / select / textarea 的宿主隔离，隔离层不再重复实现
  const isolation=stripComments(read('src/styles/host-isolation.css'));
  assert.doesNotMatch(isolation,/nvui-input/);
});

test('module and asset paths stay resolvable after the src/ reorganisation',()=>{
  const files=new Set(trackedFiles());
  const onDisk=p=>files.has(relative(repoRoot,p).split(sep).join('/'));
  // 运行时依赖边：JS import + CSS @import，必须全部命中仓库内文件。
  // 只检查本扩展自己的 src/ 运行时文件；ui-kit/ 是自包含的独立项目，
  // 其模板目录里的 import 是给使用者参考的示例路径，不是真实依赖。
  const edges=[];
  for(const file of files){
    if(!file.startsWith('src/')) continue;
    if(!file.endsWith('.js')&&!file.endsWith('.css')) continue;
    const source=read(file);
    if(file.endsWith('.js')){
      for(const m of source.matchAll(/(?:^|\n)\s*(?:import[\s\S]*?from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) edges.push([file,m[1]]);
    } else {
      for(const m of stripComments(source).matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)) edges.push([file,m[1]]);
    }
  }
  assert.ok(edges.length>=7,`依赖边过少：${edges.length}`);
  for(const [file,spec] of edges){
    const target=resolve(repoRoot,file,'..',spec);
    assert.ok(onDisk(target),`断链：${file} -> ${spec}`);
  }
});

test('host access stays inside runtime.js and Wave 1 safeguards are wired',()=>{
  // A1：只有 runtime.js 可以直接访问 SillyTavern.getContext()
  const stripJsComments=source=>source
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g,'$1');
  const srcFiles=['src/index.js','src/runtime.js','src/Worldbook-Editor.js','src/ai-prompts.js','src/jb-presets.js','src/worldbook-api.js','src/health-rules.js','src/logger.js'];
  for(const file of srcFiles){
    if(file==='src/runtime.js') continue;
    assert.doesNotMatch(stripJsComments(read(file)),/globalThis\.SillyTavern|SillyTavern\.getContext/,
      `${file} 不应直接访问宿主 context，请通过 runtime.js`);
  }
  assert.match(read('src/runtime.js'),/export function getHostEventApi/);
  assert.match(read('src/index.js'),/getHostEventApi/);
  assert.match(read('src/index.js'),/peekGlobalNVUI/);

  // G02：保存结果可见（宿主没有保存接口时 UI 如实提示）
  assert.match(read('src/runtime.js'),/return persistSettings\(\)/);
  assert.match(read('src/Worldbook-Editor.js'),/仅保存在内存/);

  // G01：冲突报告来源绑定 + 跳转前 uid 校验
  const editor=read('src/Worldbook-Editor.js');
  assert.match(editor,/conflictSrc/);
  assert.match(editor,/来源《/);
  assert.match(editor,/该条目不存在/);

  // G05 / G06：帮助入口、无书引导、导入导出守卫、AI 首次使用提示
  assert.match(editor,/wbe-acc-help/);
  assert.match(editor,/wbe-nobook/);
  assert.match(editor,/请先选择或新建世界书/);
  assert.match(editor,/首次使用/);

  // §9.1 A2：触发命中行可跳转
  assert.match(editor,/wbe-hitrow[^`]*data-a="goto"/);

  // G07：体检规则复用零依赖纯函数模块
  assert.match(editor,/from '\.\/health-rules\.js'/);
  const rules=read('src/health-rules.js');
  assert.doesNotMatch(rules,/^\s*import\s/m);
  assert.match(rules,/invalid-regex/);
  assert.match(rules,/redos/);
});

test('storage red lines and Wave 2 contracts are wired',()=>{
  const stripJsComments=source=>source
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g,'$1');
  const srcFiles=['src/index.js','src/runtime.js','src/Worldbook-Editor.js','src/ai-prompts.js','src/jb-presets.js','src/worldbook-api.js','src/health-rules.js','src/logger.js','src/trigger-sim.js'];
  // A4：存储红线（任何模块都不得清空宿主 localStorage）
  for(const file of srcFiles){
    assert.doesNotMatch(stripJsComments(read(file)),/localStorage\.clear\s*\(/,`${file} 不得调用 localStorage.clear()`);
  }
  assert.match(read('src/runtime.js'),/st_worldbook_editor/);

  const editor=read('src/Worldbook-Editor.js');
  // 业务层不直接碰宿主设置存储 / context
  assert.doesNotMatch(stripJsComments(editor),/extensionSettings|SillyTavern\.getContext/);

  // G03：触发仿真抽成可测纯函数模块
  assert.match(editor,/from '\.\/trigger-sim\.js'/);
  assert.match(read('src/trigger-sim.js'),/from '\.\/health-rules\.js'/);

  // G08：导入先预览、确认后追加；导出「勾选优先」
  assert.match(editor,/wbe-import-preview/);
  assert.match(editor,/importconfirm/);
  assert.match(editor,/S\.checked\.size \? picked\(\) : S\.entries/);

  // G09：AI 结果逐字段采纳
  assert.match(editor,/aokf/);
  assert.match(editor,/采纳「/);

  // G11：分批失败保留部分结果 + 重试失败批次
  assert.match(editor,/aicretry/);
  assert.match(editor,/retryFailedAI/);

  // G04：上一条/下一条、离开页面前拦截、移动端吸底保存栏
  assert.match(editor,/data-a="preved"/);
  assert.match(editor,/beforeunload/);
  assert.match(stripComments(read('src/styles/style.css')),/position:\s*sticky/);

  // A4：data-a ↔ actions 一一对应（静态守卫，防止按钮没有处理函数）
  const actionsStart=editor.indexOf('const actions = {');
  const actionsBlock=editor.slice(actionsStart, editor.indexOf('\n  };', actionsStart));
  const actions=new Set([...actionsBlock.matchAll(/(?:^|\n)\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|:|,)/g)].map(match=>match[1]));
  const dataAs=new Set([...editor.matchAll(/data-a="([A-Za-z_$][\w$-]*)"/g)].map(match=>match[1]));
  for(const key of dataAs){
    assert.ok(actions.has(key),`data-a="${key}" 没有对应的 action`);
  }
});

test('Wave 3 contracts are wired',()=>{
  const editor=read('src/Worldbook-Editor.js');
  // G13：危险操作改用面板内联确认
  assert.match(editor,/wbe-inline-confirm/);
  assert.match(editor,/confirmInline/);
  // G14：高级机制只读展示
  assert.match(editor,/高级机制（只读）/);
  assert.match(editor,/advancedInfo/);
  // G10：破限编排预览 + 单步撤销
  assert.match(editor,/wbe-jbpreview/);
  assert.match(editor,/jbUndo/);
  assert.match(editor,/data-a="jbu"/);
  // G15：配置备份（不含密钥），校验逻辑放在 jb-presets 纯函数
  assert.match(editor,/wbe-acc-backup/);
  assert.match(editor,/buildConfigBundle/);
  assert.match(editor,/validateConfigBundle/);
  const presets=read('src/jb-presets.js');
  assert.match(presets,/export function buildConfigBundle/);
  assert.match(presets,/export function validateConfigBundle/);
  // G12：世界书绑定可视化
  assert.match(editor,/wbe-binding/);
  assert.match(editor,/renderBinding/);
});
