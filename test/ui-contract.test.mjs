import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('extension manifest references local assets and exported lifecycle hooks',async()=>{
  const manifest=JSON.parse(read('manifest.json'));
  assert.equal(manifest.version,'0.6.0');
  for(const key of ['js','css']) assert.ok(existsSync(new URL('../'+manifest[key],import.meta.url)));
  const source=read(manifest.js);
  for(const hook of Object.values(manifest.hooks)) assert.match(source,new RegExp(`export (?:async )?function ${hook}\\(`));
  assert.deepEqual(manifest.requires,[]);
});

test('business CSS obeys Kit tokens, scoping, and host compatibility constraints',()=>{
  const css=read('style.css').replace(/\/\*[\s\S]*?\*\//g,'');
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

test('Kit version and desktop geometry match the requested 2.5.0 standard',()=>{
  assert.equal(JSON.parse(read('ui-kit/package.json')).version,'2.5.0');
  assert.match(read('ui-kit/tokens.css'),/--nvui-panel-width:\s*720px/);
  assert.doesNotMatch(read('Worldbook-Editor.js'),/cdn\.jsdelivr|2147483647|showModal\(/);
});
