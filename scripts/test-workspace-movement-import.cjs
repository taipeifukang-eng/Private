const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),XLSX=require('xlsx');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
const {parseMovementWorkbook:parse}=require('../lib/workspace/movement-import.ts');const today='2026-10-29';
const stores=[{id:'11111111-1111-4111-8111-111111111111',code:'0002',name:'南港店'},{id:'22222222-2222-4222-8222-222222222222',code:'0003',name:'東湖店'}];
const header=['員編','姓名','異動類型','任職門市ID','是否為藥師','生日','升任後職位','升任後新人/行政等級','原任職門市ID','新任職門市ID','生效日期','備註'];
const row=['0001','測試姓名','入職','002南港','否','2000/2/29','','','','',46204,'文字'];
function book(rows,edit=()=>{},date1904=false){const b=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet(rows);edit(s);XLSX.utils.book_append_sheet(b,s,'異動');b.Workbook={WBProps:{date1904}};return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}
function read(rows,edit=()=>{},s=stores,date1904=false){return parse(book(rows,edit,date1904),today,s,[]);}
let result=read([header,row]);assert.equal(result.valid,true,JSON.stringify(result.errors));assert.equal(result.rows[0].employee_code,'FK0001');assert.equal(result.rows[0].store_id,stores[0].id);assert.equal(result.rows[0].effective_date,'2026-07-01');assert.equal(result.rows[0].birthday,'2000-02-29');
result=read([header,[],row],s=>s.K3={t:'n',v:46204-1462},stores,true);assert.equal(result.rows[0].effective_date,'2026-07-01');assert.deepEqual(result.sourceRows,[3]);
assert.equal(read([header,row],s=>{s.A2={t:'n',v:1,z:'0000'};}).rows[0].employee_code,'FK0001');
result=read([header,row],s=>s.K2={t:'s',v:'07/01/2026'});assert.equal(result.rows[0].effective_date,'2026-07-01');
assert.equal(read([header,row],s=>s.B2={t:'s',v:'=文字',f:'1+1'}).valid,false);
assert.equal(read([header,row],s=>s.K2={t:'e',v:7}).valid,false);
assert.equal(read([header,row],s=>s.E2={t:'s',v:'不是很確定'}).valid,false);
assert.equal(read([header,row],s=>s.F2={t:'s',v:'2001-02-29'}).valid,false);
result=read([header,row],s=>s.D2={t:'s',v:'2'},[...stores,{id:'33333333-3333-4333-8333-333333333333',code:'0002A',name:'分店'}]);assert.equal(result.valid,false);assert(result.errors.some(e=>e.message.includes('多個')));
const transfer=[...row];transfer[2]='調店';transfer[3]='';transfer[8]='0002';transfer[9]='0003';assert.equal(read([header,transfer]).valid,true);
assert.throws(()=>read([['員編','員編'],row]));assert.throws(()=>read([header,...Array(501).fill(row)]));assert.throws(()=>parse(Buffer.alloc(0),today,stores,[]));
console.log('PASS movement Excel parsing: legacy headers/codes/locations, 1900/1904 dates, source rows, typed pharmacist, transfers, ambiguity, formulas/errors and limits');
