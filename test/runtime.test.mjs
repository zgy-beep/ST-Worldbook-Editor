import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId=0;
async function fixture(initial={}, legacy=null) {
  const values=new Map();
  if(legacy!==null) values.set('wbe_settings_v1',JSON.stringify(legacy));
  values.set('wbe_other_plugin','keep');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key),
  }});
  let store=initial;
  let saves=0;
  globalThis.SillyTavern={getContext:()=>({extensionSettings:store,saveSettingsDebounced:()=>saves++})};
  const module=await import(`../src/runtime.js?case=${moduleId++}`);
  return {runtime:module.createRuntime(),values,get store(){return store},set store(value){store=value},get saves(){return saves}};
}

test('settings migrate legacy fields while keeping existing ST values and unknown fields',async()=>{
  const f=await fixture({st_worldbook_editor:{key:'current',presets:[],customFuture:true},other:{keep:true}},
    {key:'old',style:'保留地名',temp:0.3,unknownLegacy:7});
  const cfg=f.runtime.getSettings();
  assert.equal(cfg.key,'current');assert.equal(cfg.style,'保留地名');assert.equal(cfg.temp,0.3);
  assert.equal(cfg.customFuture,true);assert.equal(cfg.unknownLegacy,7);
  assert.equal(cfg.jbHead,'');assert.equal(cfg.jbTail,'');
  assert.equal(Object.prototype.hasOwnProperty.call(cfg,'jailbreak'),false,'旧 jailbreak 键应已迁移并删除');
  assert.deepEqual(f.store.other,{keep:true});assert.ok(f.saves>0);
  assert.equal(f.runtime.getSettings(),cfg);
});

test('legacy single jailbreak field migrates into jbHead and the old key is dropped',async()=>{
  const f=await fixture({st_worldbook_editor:{key:'k',jailbreak:'旧的破限文案'}},null);
  const cfg=f.runtime.getSettings();
  assert.equal(cfg.jbHead,'旧的破限文案','旧 jailbreak 应并入首破限');
  assert.equal(cfg.jbTail,'');
  assert.equal(Object.prototype.hasOwnProperty.call(cfg,'jailbreak'),false,'迁移后应删除旧键');
});

test('layout storage isolates its keys, clones values, and supports Kit delete semantics',async()=>{
  const f=await fixture();const cfg=f.runtime.getSettings();
  const value={tab:'ai',size:{width:720}};
  f.runtime.layoutStorage.set('nvui_state_wbe',value);value.size.width=999;
  assert.equal(f.runtime.layoutStorage.get('nvui_state_wbe').size.width,720);
  const read=f.runtime.layoutStorage.get('nvui_state_wbe');read.size.width=300;
  assert.equal(f.runtime.layoutStorage.get('nvui_state_wbe').size.width,720);
  assert.equal(cfg.tab,undefined);assert.equal(cfg.size,undefined);
  f.runtime.layoutStorage.delete('nvui_state_wbe');assert.equal(f.runtime.layoutStorage.get('nvui_state_wbe'),null);
  f.runtime.layoutStorage.set('__proto__',{polluted:true});assert.equal({}.polluted,undefined);
});

test('reset clears only this extension and retains the live settings reference',async()=>{
  const f=await fixture({other:{keep:true}},{key:'old'});
  const cfg=f.runtime.getSettings();cfg.jbHead='用户自填';cfg.layout.a={tab:'ai'};
  const reset=f.runtime.resetSettings();assert.equal(reset,cfg);assert.equal(cfg.key,'');assert.equal(cfg.jbHead,'');assert.equal(cfg.jbTail,'');
  assert.deepEqual(cfg.layout,{});assert.deepEqual(f.store.other,{keep:true});
  assert.equal(f.values.get('wbe_other_plugin'),'keep');assert.equal(f.values.has('wbe_settings_v1'),false);
});

test('runtime reads current host settings and helper instead of caching early snapshots',async()=>{
  const f=await fixture();f.runtime.getSettings();f.store={st_worldbook_editor:{style:'新引用'}};
  assert.equal(f.runtime.getSettings().style,'新引用');
  globalThis.TavernHelper={getWorldbookNames:()=>['第一本']};const one=f.runtime.getHelper();
  globalThis.TavernHelper={getWorldbookNames:()=>['第二本']};assert.notEqual(f.runtime.getHelper(),one);
  assert.deepEqual(f.runtime.getHelper().getWorldbookNames(),['第二本']);delete globalThis.TavernHelper;
});

test('missing context cannot cause an empty settings snapshot to be persisted',async()=>{
  const f=await fixture();delete globalThis.SillyTavern;
  assert.throws(()=>f.runtime.getSettings(),/extensionSettings/);assert.equal(f.saves,0);
  globalThis.SillyTavern={getContext:()=>({extensionSettings:f.store,saveSettingsDebounced(){}})};
  assert.equal(f.runtime.getSettings().mode,'st');
});
