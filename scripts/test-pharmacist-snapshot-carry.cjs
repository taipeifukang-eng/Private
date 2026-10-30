const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const moduleContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/pharmacist-snapshot-carry.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,moduleContext);
const source = fs.readFileSync('app/admin/pharmacist-management/page.tsx','utf8');
const start = source.indexOf('  async function ensureSnapshotForMonth(');
const end = source.indexOf('\n  let currentRowsRaw:',start);
const functionSource = ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function fixture(movements = [], locked = false) {
 const tables = {
  pharmacist_monthly_snapshot: [
   {id:'aug-late',year_month:'2026-08',store_id:'0008',employee_code:'FKPT096',employee_name:'鄭翊群',is_active:true,position:'藥師'},
   {id:'sep-existing',year_month:'2026-09',store_id:'0008',employee_code:'OTHER',is_active:true},
  ],
  pharmacist_monthly_snapshot_sync_log: [{year_month:'2026-09',last_synced_at:'2026-10-01T00:00:00Z'}],
  store_employees: [{employee_code:'FKPT096',store_id:'0008',is_pharmacist:true}],
  employee_movement_history: movements,
 };
 let writes = 0;
 const client = {from(table) {
  let filters=[],range=null,mode='read',payload,options={};
  const q={
   select(_fields,opts={}) {options=opts;return q},
   eq(k,v){filters.push(r=>r[k]===v);return q},
   in(k,vs){filters.push(r=>vs.includes(r[k]));return q},
   gt(k,v){filters.push(r=>r[k]>v);return q},
   gte(k,v){filters.push(r=>r[k]>=v);return q},
   lte(k,v){filters.push(r=>r[k]<=v);return q},
   or(){return q},order(){return q},
   range(a,b){range=[a,b];return q},
   maybeSingle(){mode='single';return q},
   delete(){mode='delete';return q},
   upsert(value){mode='upsert';payload=Array.isArray(value)?value:[value];return q},
   then(resolve,reject){return Promise.resolve().then(()=>{
    let data=tables[table].filter(r=>filters.every(f=>f(r)));
    if(mode==='upsert') {writes++;for(const row of payload){const key=table==='pharmacist_monthly_snapshot'?['year_month','store_id','employee_code']:['year_month'];const old=tables[table].find(r=>key.every(k=>r[k]===row[k]));if(old)Object.assign(old,row);else tables[table].push({...row});}return {error:null};}
    if(mode==='delete'){tables[table]=tables[table].filter(r=>!data.includes(r));return {error:null};}
    if(range)data=data.slice(range[0],range[1]+1);
    return {data:mode==='single'?data[0]||null:data,count:data.length,error:null};
   }).then(resolve,reject)}
  };return q;
 }};
 const context={adminSupabase:client,canUseSnapshot:true,lockedMonthSet:new Set(locked?['2026-09']:[]),storeIds:['0008'],getPreviousYearMonth:()=> '2026-08',hasMissingPharmacistCarry:moduleContext.exports.hasMissingPharmacistCarry};
 vm.createContext(context);vm.runInContext(functionSource,context);
 return {run:()=>context.ensureSnapshotForMonth('2026-09'),tables,writes:()=>writes};
}
(async()=>{
 const f=fixture();await f.run();
 const carried=f.tables.pharmacist_monthly_snapshot.find(r=>r.year_month==='2026-09'&&r.employee_code==='FKPT096');
 assert.ok(carried,'Late August onboarding must persist into already-synced September even with no September movements');assert.equal(carried.is_active,true);
 const writes=f.writes();await f.run();assert.equal(f.writes(),writes,'Repeated visit skips unchanged snapshot');
 const locked=fixture([],true);await locked.run();assert.equal(locked.writes(),0,'Locked month remains unchanged');
 const resigned=fixture([{employee_code:'FKPT096',movement_type:'resignation',store_id:'0008',movement_date:'2026-09-15',created_at:'2026-09-15'}]);await resigned.run();
 assert.equal(resigned.tables.pharmacist_monthly_snapshot.find(r=>r.year_month==='2026-09'&&r.employee_code==='FKPT096').is_active,false,'Apply September resignation after carry');
 console.log('Passed: late onboarding carried and persisted, repeat visit unchanged, locked month preserved, target-month resignation applied.');
})().catch(error=>{console.error(error);process.exitCode=1});
