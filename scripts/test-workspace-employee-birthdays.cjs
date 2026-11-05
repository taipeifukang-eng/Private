const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('assert/strict');const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
// employee-birthdays.ts 依 M2 E.1 引用 ./employee-id-rule；沙箱的 require 只放行這一個相對模組（同樣在沙箱內編譯）。
const ruleBox={exports:{}};vm.runInNewContext(compile('lib/workspace/employee-id-rule.ts'),ruleBox);
const sandbox={exports:{},TextEncoder,require:name=>{if(name==='./employee-id-rule')return ruleBox.exports;throw new Error('sandbox require not allowed: '+name);}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/workspace/employee-birthdays.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
const {parseBirthdayCsv:parse,normalizeBirthday:date,matchBirthdayEmployees:match}=sandbox.exports,today='2026-10-29';
const result=parse('\uFEFF員編,姓名,生日(YYYY-MM-DD)\r\nFK8001,"王,小明",2000/2/29\r\nFK8002,"陳""美""玲",1990-1-2\r\nFK8003,無生日,\r\nFK8004,"跨\n行姓名",1980-10-10',today);
assert.equal(result.rows.length,3);assert.equal(result.rows[0].employee_code,'FK8001');assert.equal(result.rows[0].employee_name,'王,小明');assert.equal(result.rows[1].employee_name,'陳"美"玲');assert.equal(result.rows[0].birthday,'2000-02-29');assert.equal(result.skipped,1);assert.equal(result.rows[2].row,5);
for(const value of ['1900-02-29','2023-02-29','2026-04-31','2026-13-01','2027-01-01','115/1/1','=TODAY()','2000-00-01'])assert.equal(date(value,today),null,value);
assert.equal(date('2024/2/29',today),'2024-02-29');assert.equal(date(today,today),today);
assert.throws(()=>parse('員編,姓名,生日\nFK8101,"未關閉,2000-01-01',today),/引號未關閉/);
assert.throws(()=>parse('員編,姓名,生日\nFK8101,"姓名"其他,2000-01-01',today),/多餘文字/);
assert.throws(()=>parse('員編,員編,生日\nFK8101,FK8102,2000-01-01',today),/標題/);
const invalid=parse('員編,姓名,生日\nFK8101,一,2000-01-01\nFK8101,一,2000-01-02\nFK8102,二,2026-02-30\nFK8103,三,2000-01-01,多欄',today);assert.equal(invalid.errors.length,3);assert.equal(invalid.rows.length,1);
assert.equal(match(result.rows,[{employee_code:'FK8001',employee_name:'王,小明'},{employee_code:'FK8002',employee_name:'不同姓名'}]).length,2);
assert.throws(()=>parse('員編,姓名,生日\n'+'FK8101,一,2000-01-01\n'.repeat(10001),today),/最多/);
const badIds=parse('員編,姓名,生日\nFKI001,實習,2000-01-01\n001,舊格式,2000-01-01\nfk8201,小寫,2000-01-01',today);assert.equal(badIds.errors.length,2);assert.equal(badIds.rows.length,1);assert.equal(badIds.rows[0].employee_code,'FK8201');
console.log('PASS birthday CSV quoting/BOM/multiline/source rows, leading-zero codes, dates/leap years/future rejection, duplicates, limits and employee/name matching');

const restored=sandbox.exports.restoreBirthdayNames([
 {row:2,employee_code:'A',employee_name:"'=特殊姓名",birthday:'2000-01-01'},
 {row:3,employee_code:'B',employee_name:"'=原本含單引號",birthday:'2000-01-01'},
 {row:4,employee_code:'C',employee_name:"'=不符合主檔",birthday:'2000-01-01'}
],[{employee_code:'A',employee_name:'=特殊姓名'},{employee_code:'B',employee_name:"'=原本含單引號"},{employee_code:'C',employee_name:'其他姓名'}]);
assert.equal(restored[0].employee_name,'=特殊姓名');assert.equal(restored[1].employee_name,"'=原本含單引號");assert.equal(restored[2].employee_name,"'=不符合主檔");
console.log('PASS exported formula-safe names restored only against exact canonical name; literal apostrophes preserved');
