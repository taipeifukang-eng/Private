const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('assert/strict');
const js=ts.transpileModule(fs.readFileSync('lib/workspace/employee-directory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const sandbox={exports:{}};vm.runInNewContext(js,sandbox);const directory=sandbox.exports.employeeDirectory;
const master=(code,extra={})=>({employee_code:code,employee_name:code,start_date:null,birthday:null,current_position:null,is_active:true,employment_status:'active',last_movement_date:null,...extra});
const result=directory([
 master(' fk001 ',{is_active:false,employment_status:'resigned',birthday:'1990-01-01',current_position:'舊職位'}),
 master('FK001',{employee_name:'仍在職門市姓名',current_position:'主檔職位',last_movement_date:'2026-07-15'}),
 master('FK004',{employment_status:'resigned',is_active:false}),
],[
 {employee_code:'FK001',employee_name:'月報姓名',position:'月報職位',year_month:'2026-09',monthly_status:'full_month',start_date:'2020-01-01'},
 {employee_code:'FK002',employee_name:'僅有月報',position:'專員',year_month:'2026-09',monthly_status:'leave_of_absence',start_date:'2021-01-01'},
],[
 {employee_code:'FK001',movement_type:'promotion',new_value:'新升遷職位',movement_date:'2026-09-15'},
 {employee_code:'FK003',employee_name:'僅有歷程',movement_type:'resignation',new_value:'resigned',movement_date:'2026-08-15'},
]);
assert.equal(result.length,4);const first=result.find(x=>x.employee_code==='FK001');assert.equal(first.employee_name,'仍在職門市姓名');assert.equal(first.birthday,'1990-01-01');assert.equal(first.current_position,'新升遷職位');assert.equal(first.is_active,true);
assert.equal(result.find(x=>x.employee_code==='FK002').current_status,'leave_of_absence');assert.equal(result.find(x=>x.employee_code==='FK003').is_active,false);assert.equal(result.find(x=>x.employee_code==='FK004').is_active,false);
assert.equal(directory([],[],[]).length,0);
console.log('PASS employee directory preserves active master preference, fallback birthday, monthly-only/movement-only employees, promotion precedence and resigned status');

const returned=directory([master('RETURN',{last_movement_date:'2026-10-01'})],[{employee_code:'RETURN',year_month:'2026-09',monthly_status:'resigned'}],[{employee_code:'RETURN',movement_type:'promotion',movement_date:'2026-10-02',new_value:'專員'},{employee_code:'RETURN',movement_type:'return_to_work',movement_date:'2026-10-01',new_value:'active'}]);
assert.equal(returned[0].is_active,true);console.log('PASS return supersedes prior resigned monthly snapshot even after promotion');
