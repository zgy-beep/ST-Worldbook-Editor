import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldbookApi } from '../src/worldbook-api.js';

test('modern reads use modern patches even when legacy methods coexist, preserving nested fields', async () => {
  let entries = [{uid:1, name:'港口', extra:{keep:true},
    strategy:{type:'selective',keys:['港口'],keys_secondary:{logic:'and_any',keys:['船']},scan_depth:3},
    position:{type:'at_depth',depth:4,order:50,role:'system'}}];
  const api = createWorldbookApi(()=>({
    getWorldbook: async()=>entries,
    setLorebookEntries:()=>assert.fail('Modern entry must not pass through the legacy setter'),
    updateWorldbookWith:async(book, update)=>entries=await update(entries),
  }));
  await api.setEntries('书',[{uid:1,strategy:{type:'constant',keys_secondary:{logic:'not_any'}},position:{depth:8}}]);
  assert.deepEqual(entries[0].strategy,{type:'constant',keys:['港口'],keys_secondary:{logic:'not_any',keys:['船']},scan_depth:3});
  assert.deepEqual(entries[0].position,{type:'at_depth',depth:8,order:50,role:'system'});
  assert.deepEqual(entries[0].extra,{keep:true});
});

test('modern deletes use a predicate; legacy deletes retain UID arrays', async () => {
  const modern = createWorldbookApi(()=>({deleteWorldbookEntries:async(book,predicate)=>{
    assert.equal(book,'书'); assert.ok(predicate({uid:'7'}));assert.equal(predicate({uid:8}),false);
  }}));
  await modern.deleteEntries('书',[7]);
  const legacy = createWorldbookApi(()=>({deleteLorebookEntries:async(book,uids)=>assert.deepEqual(uids,[7])}));
  await legacy.deleteEntries('书',[7]);
});

test('legacy helper retains legacy patches and lazy helper discovery', async () => {
  let helper = {};
  const api = createWorldbookApi(()=>helper);
  await assert.rejects(api.getBooks(), /酒馆助手缺少/);
  helper = {getLorebooks:()=>['旧书'],setLorebookEntries:async(book,patches)=>patches};
  assert.deepEqual(await api.getBooks(),['旧书']);
  assert.deepEqual(await api.setEntries('旧书',[{uid:2,disable:true}]),[{uid:2,disable:true}]);
});

test('read failures and stale patches surface instead of appearing as an empty worldbook', async () => {
  const api = createWorldbookApi(()=>({getWorldbook:async()=>{throw new Error('读取失败');},
    updateWorldbookWith:async(book,update)=>update([{uid:1}])}));
  await assert.rejects(api.getEntries('书'),/读取失败/);
  await assert.rejects(api.setEntries('书',[{uid:9,content:'不应写入'}]),/已不存在/);
});
