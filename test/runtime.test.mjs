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
  assert.deepEqual(cfg.jbPre,[]);assert.deepEqual(cfg.jbPost,[]);
  for(const gone of ['jailbreak','jbHead','jbTail'])
    assert.equal(Object.prototype.hasOwnProperty.call(cfg,gone),false,`旧键 ${gone} 应已迁移并删除`);
  assert.deepEqual(f.store.other,{keep:true});assert.ok(f.saves>0);
  assert.equal(f.runtime.getSettings(),cfg);
});

test('破限字段迁移链：jailbreak → jbHead/jbTail → jbPre/jbPost',async()=>{
  // 最老一代：单条 jailbreak 进入前置区
  const oldest=await fixture({st_worldbook_editor:{key:'k',jailbreak:'最老的破限'}},null);
  const o=oldest.runtime.getSettings();
  assert.deepEqual(o.jbPre,[{role:'system',content:'最老的破限'}]);
  assert.deepEqual(o.jbPost,[]);
  assert.equal(Object.prototype.hasOwnProperty.call(o,'jailbreak'),false);

  // 上一代：jbHead / jbTail 分别进入前置区与后置区
  const prev=await fixture({st_worldbook_editor:{key:'k',jbHead:'首段',jbTail:'尾段'}},null);
  const p=prev.runtime.getSettings();
  assert.deepEqual(p.jbPre,[{role:'system',content:'首段'}]);
  assert.deepEqual(p.jbPost,[{role:'system',content:'尾段'}]);
  assert.equal(Object.prototype.hasOwnProperty.call(p,'jbHead'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(p,'jbTail'),false);

  // 已有新数组时不覆盖用户编辑，但仍清掉旧键
  const already=await fixture({st_worldbook_editor:{key:'k',jbPre:[{role:'user',content:'新版内容'}],jbHead:'旧首段'}},null);
  const a=already.runtime.getSettings();
  assert.deepEqual(a.jbPre,[{role:'user',content:'新版内容'}],'新数组非空时不得被旧字段覆盖');
  assert.equal(Object.prototype.hasOwnProperty.call(a,'jbHead'),false);
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
  const cfg=f.runtime.getSettings();cfg.jbPre=[{role:'system',content:'用户自填'}];cfg.layout.a={tab:'ai'};
  const reset=f.runtime.resetSettings();assert.equal(reset,cfg);assert.equal(cfg.key,'');assert.deepEqual(cfg.jbPre,[]);assert.deepEqual(cfg.jbPost,[]);
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
