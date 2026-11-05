const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
require.extensions['.ts']=(module,path)=>module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path);
const {transferMonthPlan:plan}=require('../lib/workspace/transfer-months.ts');
const base={effectiveDate:'2026-07-15',fromStore:'a',toStore:'b',fromName:'南港店',toName:'東湖店',rows:[{id:'source',store_id:'a',year_month:'2026-07',status:'draft',monthly_status:'full_month',work_days:31}],destinationDraftMonths:['2026-06','2026-07','2026-08','2026-08']};
let p=plan(base);assert.equal(p.changes.length,3);assert.equal(p.changes[0].work_days,14);assert.equal(p.changes[1].work_days,17);assert.equal(p.changes[2].work_days,31);assert.equal(p.changes[1].partial_month_notes,'07/15自南港店調入');assert.equal(p.changes[2].partial_month_notes,null);assert.equal(p.conflicts.length,0);
for(const [date,out,inside] of [['2026-07-01',0,31],['2026-07-31',30,1],['2028-02-29',28,1],['2026-02-28',27,1],['2026-12-31',30,1]]){const ym=date.slice(0,7),r=plan({...base,effectiveDate:date,rows:[{...base.rows[0],year_month:ym}],destinationDraftMonths:[ym]});assert.equal(r.changes[0].work_days,out);assert.equal(r.changes[1].work_days,inside);assert.equal(out+inside,r.changes[0].total_days_in_month);}
for(const effectiveDate of ['2026-02-29','0115-07-01','2026/07/01','2026-13-01'])assert.throws(()=>plan({...base,effectiveDate}));
assert.throws(()=>plan({...base,toStore:'a'}));
p=plan({...base,rows:[],destinationDraftMonths:[]});assert.equal(p.changes.length,0);assert.equal(p.destinationMonthInitialized,false);
const target={id:'target',store_id:'b',year_month:'2026-07',status:'draft',monthly_status:'full_month',work_days:31};p=plan({...base,rows:[...base.rows,target]});assert.equal(p.changes[1].operation,'update');assert.equal(p.changes[1].id,'target');
p=plan({...base,rows:[...base.rows,{...target,status:'confirmed'}]});assert.equal(p.conflicts.length,0);assert.deepEqual(p.lockedMonths,['2026-07']);assert(!p.changes.some(r=>r.id==='target'));
p=plan({...base,rows:[...base.rows,{...target,year_month:'2026-09',status:'confirmed'}]});assert.equal(p.conflicts.length,0);assert.deepEqual(p.lockedMonths,['2026-09']);
p=plan({...base,rows:[...base.rows,target,{...target,id:'duplicate'}]});assert.match(p.conflicts.join(),/重複/);
const serialized=JSON.stringify(base);plan(base);assert.equal(JSON.stringify(base),serialized);
console.log('PASS transfer month allocation: first/last day, leap year, year boundary, initialized-only insert, updates, locked later months, duplicates and immutable input');
