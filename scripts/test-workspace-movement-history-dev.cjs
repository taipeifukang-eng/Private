const {spawnSync}=require('child_process');require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const check=r=>{if(r.error)throw r.error;return r.data;};
(async()=>{const code='VMH'+require('crypto').randomBytes(6).toString('hex').toUpperCase();const ids=Array.from({length:105},()=>require('crypto').randomUUID());
 try{check(await db.from('employee_movement_history').insert(ids.map((id,i)=>({id,employee_code:code,employee_name:'異動分頁驗證',movement_type:'promotion',movement_date:'2026-08-'+String(i%28+1).padStart(2,'0'),old_value:'專員',new_value:'主任',notes:'專用測試紀錄 '+i}))));
 const r=spawnSync('python',['scripts/test-workspace-movement-history.py'],{stdio:'inherit',env:{...process.env,MOVEMENT_HISTORY_FIXTURE_CODE:code}});if(r.status)throw Error('Movement history verification failed');
 }finally{check(await db.from('employee_movement_history').delete().in('id',ids));console.log('105 owned movement-history fixtures cleaned');}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
