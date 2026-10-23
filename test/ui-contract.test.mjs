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
  assert.equal(manifest.version,'0.7.0');
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

test('Kit version and desktop geometry match the requested 2.7.0 standard',()=>{
  assert.equal(JSON.parse(read('ui-kit/package.json')).version,'2.7.0');
  assert.match(read('ui-kit/tokens.css'),/--nvui-panel-width:\s*720px/);
  assert.doesNotMatch(read('src/Worldbook-Editor.js'),/cdn\.jsdelivr|2147483647|showModal\(/);
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
