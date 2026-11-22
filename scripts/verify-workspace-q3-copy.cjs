const {ROOT,target,all,save}=require('./workspace-q3-snapshot.cjs'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'prepared-data.json'))),schema=JSON.parse(fs.readFileSync(path.join(ROOT,'source-schema.json'))).definitions;
const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
const inList=values=>'in.('+values.join(',')+')';
(async()=>{
 const results=[];
 for(const [table,expected] of Object.entries(data)){
  let actual=[];
  if(table==='inventory_result_items'){for(const batch of data.inventory_result_batches)actual.push(...await all(target,table,{batch_id:'eq.'+batch.id,order:'row_number.asc,id.asc'}));}
  else if(expected[0]?.id){for(let i=0;i<expected.length;i+=80)actual.push(...await all(target,table,{id:inList(expected.slice(i,i+80).map(r=>r.id))}));}
  else actual=await all(target,table,{store_id:inList(data.stores.map(r=>r.id)),year_month:'in.(2026-07,2026-08,2026-09)'});
  assert.equal(actual.length,expected.length,table+' count');const byId=new Map(actual.map(r=>[r.id||r.store_id+':'+r.year_month,r]));
  for(const row of expected){const saved=byId.get(row.id||row.store_id+':'+row.year_month);assert(saved,table+' missing row');for(const [key,value]of Object.entries(row)){let a=saved[key],b=value;if((schema[table]?.properties[key]?.format||'').includes('timestamp')){if(a)a=new Date(a).toISOString();if(b)b=new Date(b).toISOString();}assert.deepEqual(normalize(a),normalize(b),table+'.'+key+' value mismatch');}}
  results.push({table,rows:actual.length,allCopiedFieldsMatch:true});console.log('PASS '+table+' '+actual.length);
 }
 const plan=JSON.parse(fs.readFileSync(path.join(ROOT,'import-plan.json')));const remaining=await all(target,'workspace_snapshot_import_chunks',{select:'run_id',run_id:'eq.'+plan.runId,order:'part_no.asc'});assert.equal(remaining.length,0);
 save('verification',{verifiedAt:new Date().toISOString(),tables:results,stagingCleared:true,total:results.reduce((n,r)=>n+r.rows,0)});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
