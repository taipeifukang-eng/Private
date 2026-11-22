const fs=require('fs'),{spawnSync}=require('child_process');require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const check=r=>{if(r.error)throw r.error;return r.data;};
(async()=>{
 const stamp=Date.now().toString().slice(-9);const rows=check(await db.from('store_employees').insert([0,1].map(i=>({employee_code:'VBD'+stamp+i,employee_name:process.argv.includes('--roundtrip')?['=測試,特殊姓名',"'=測試原有單引號"][i]:'Vue 生日交易驗證 '+i,employment_type:'full_time',birthday:'1990-01-01'}))).select('id,employee_code,employee_name'));
 fs.writeFileSync('.tmp-check/birthday-save-fixture.json',JSON.stringify(rows));
 try{const result=spawnSync('python',[process.argv.includes('--roundtrip')?'scripts/test-workspace-birthday-template.py':process.argv.includes('--ui')?'scripts/test-workspace-employee-birthdays-ui.py':'scripts/test-workspace-employee-birthday-save.py'],{stdio:'inherit'});if(result.status)throw Error('Birthday API write test failed');}
 finally{
  const codes=new Set(rows.map(r=>r.employee_code));const receipts=check(await db.from('workspace_birthday_requests').select('request_id,payload'));const ids=receipts.filter(r=>Array.isArray(r.payload)&&r.payload.length>0&&r.payload.every(p=>codes.has(p.employee_code))).map(r=>r.request_id);
  if(ids.length)check(await db.from('workspace_birthday_requests').delete().in('request_id',ids));
  check(await db.from('store_employees').delete().in('id',rows.map(r=>r.id)));console.log('Birthday API test employees and receipts cleaned');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
