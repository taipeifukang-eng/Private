const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('assert/strict');const sandbox={exports:{},TextEncoder};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/workspace/employee-birthdays.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
const {parseBirthdayCsv:parse,normalizeBirthday:date,matchBirthdayEmployees:match}=sandbox.exports,today='2026-10-29';
const result=parse('\uFEFF員編,姓名,生日(YYYY-MM-DD)\r\n001,"王,小明",2000/2/29\r\n002,"陳""美""玲",1990-1-2\r\n003,無生日,\r\n004,"跨\n行姓名",1980-10-10',today);
assert.equal(result.rows.length,3);assert.equal(result.rows[0].employee_code,'001');assert.equal(result.rows[0].employee_name,'王,小明');assert.equal(result.rows[1].employee_name,'陳"美"玲');assert.equal(result.rows[0].birthday,'2000-02-29');assert.equal(result.skipped,1);assert.equal(result.rows[2].row,5);
for(const value of ['1900-02-29','2023-02-29','2026-04-31','2026-13-01','2027-01-01','115/1/1','=TODAY()','2000-00-01'])assert.equal(date(value,today),null,value);
assert.equal(date('2024/2/29',today),'2024-02-29');assert.equal(date(today,today),today);
assert.throws(()=>parse('員編,姓名,生日\nA,"未關閉,2000-01-01',today),/引號未關閉/);
assert.throws(()=>parse('員編,姓名,生日\nA,"姓名"其他,2000-01-01',today),/多餘文字/);
assert.throws(()=>parse('員編,員編,生日\nA,B,2000-01-01',today),/標題/);
const invalid=parse('員編,姓名,生日\nA,一,2000-01-01\nA,一,2000-01-02\nB,二,2026-02-30\nC,三,2000-01-01,多欄',today);assert.equal(invalid.errors.length,3);assert.equal(invalid.rows.length,1);
assert.equal(match(result.rows,[{employee_code:'001',employee_name:'王,小明'},{employee_code:'002',employee_name:'不同姓名'}]).length,2);
assert.throws(()=>parse('員編,姓名,生日\n'+'A,一,2000-01-01\n'.repeat(10001),today),/最多/);
console.log('PASS birthday CSV quoting/BOM/multiline/source rows, leading-zero codes, dates/leap years/future rejection, duplicates, limits and employee/name matching');

const restored=sandbox.exports.restoreBirthdayNames([
 {row:2,employee_code:'A',employee_name:"'=特殊姓名",birthday:'2000-01-01'},
 {row:3,employee_code:'B',employee_name:"'=原本含單引號",birthday:'2000-01-01'},
 {row:4,employee_code:'C',employee_name:"'=不符合主檔",birthday:'2000-01-01'}
],[{employee_code:'A',employee_name:'=特殊姓名'},{employee_code:'B',employee_name:"'=原本含單引號"},{employee_code:'C',employee_name:'其他姓名'}]);
assert.equal(restored[0].employee_name,'=特殊姓名');assert.equal(restored[1].employee_name,"'=原本含單引號");assert.equal(restored[2].employee_name,"'=不符合主檔");
console.log('PASS exported formula-safe names restored only against exact canonical name; literal apostrophes preserved');
