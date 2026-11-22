const fs=require('fs'),{spawnSync}=require('child_process'),{randomUUID,randomBytes}=require('crypto');require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),check=r=>{if(r.error)throw r.error;return r.data;};
(async()=>{const ids=Array.from({length:6},()=>randomUUID()),stamp=randomBytes(5).toString('hex');const units=[
 {type:'company',parent_id:null,name:'驗證公司'},
 {type:'headquarters',parent_id:ids[0],name:'驗證總部'},
 {type:'department',parent_id:ids[1],name:'驗證部門'},
 {type:'team',parent_id:ids[2],name:'驗證最下層'},
 {type:'department',parent_id:ids[0],name:'總部外單位'},
 {type:'team',parent_id:ids[2],name:'停用單位',status:'inactive'},
 ].map((u,i)=>({id:ids[i],code:`VMC-${stamp}-${i}`,status:'active',...u}));
 try{for(const u of units)check(await db.from('organization_units').insert(u));fs.writeFileSync('.tmp-check/movement-catalog-fixture.json',JSON.stringify({ids}));const r=spawnSync('python',['scripts/test-workspace-movement-catalog.py'],{stdio:'inherit'});if(r.status)throw Error('Catalog test failed');}
 finally{for(const id of [...ids].reverse())check(await db.from('organization_units').delete().eq('id',id));console.log('6 owned organization catalog fixtures cleaned');}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
