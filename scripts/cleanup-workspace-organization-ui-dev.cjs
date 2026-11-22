const fs=require('fs');
require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;
if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const fixture=JSON.parse(fs.readFileSync('.tmp-check/organization-ui-fixture.json','utf8'));
if(!/^VORG-UI-[A-F0-9]{8}$/.test(fixture.code))throw Error('Unexpected fixture');
(async()=>{
 const {data,error}=await db.from('organization_units').select('id,code').eq('id',fixture.id).single();if(error||data.code!==fixture.code)throw Error('Fixture mismatch');
 for(const table of ['organization_memberships','organization_manager_assignments']){const r=await db.from(table).delete().eq('organization_unit_id',fixture.id);if(r.error)throw r.error;}
 const receipts=await db.from('workspace_organization_requests').select('request_id,payload,result');if(receipts.error)throw receipts.error;
 const ids=receipts.data.filter(r=>r.result?.id===fixture.id||(r.payload?.updates?.length===1&&r.payload.updates[0].id===fixture.id)).map(r=>r.request_id);
 if(ids.length){const r=await db.from('workspace_organization_requests').delete().in('request_id',ids);if(r.error)throw r.error;}
 const r=await db.from('organization_units').delete().eq('id',fixture.id).eq('code',fixture.code);if(r.error)throw r.error;
 console.log('Organization UI fixture and its receipts removed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
