const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');require('@next/env').loadEnvConfig(process.cwd(),true);const e=process.env;
if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV mismatch');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const ok=r=>{if(r.error)throw Error(r.error.message);return r.data;};
(async()=>{
 const f=JSON.parse(fs.readFileSync('.tmp-check/task-archive-fixture.json','utf8'));
 const source=ok(await db.from('assignments').select('*,template:templates(description)').eq('id',f.own).single());assert.equal(source.template.description,'Vue 封存交易專用測試');
 const count=()=>db.from('assignments').select('id',{count:'exact',head:true}).eq('template_id',source.template_id);const before=await count();if(before.error)throw before.error;
 const args={p_id:f.own,p_actor:f.manager,p_version:source.workspace_version,p_write:crypto.randomUUID(),p_department:'Vue 測試部門'};
 const results=await Promise.all([db.rpc('workspace_copy_archived_task',args),db.rpc('workspace_copy_archived_task',args)]);assert.equal(ok(results[0]),ok(results[1]));const after=await count();assert.equal(after.count,before.count+1);
 const id=results[0].data,collabs=ok(await db.from('assignment_collaborators').select('user_id,section_id').eq('assignment_id',id));assert.equal(collabs.length,1);assert.equal(collabs[0].user_id,f.manager);assert.equal(collabs[0].section_id,null);assert.equal(ok(await db.from('logs').select('id').eq('assignment_id',id)).length,0);console.log('PASS simultaneous same-write requests create exactly one assignment with one collaborator and no history');
 assert.equal(ok(await db.from('assignments').select('workspace_version').eq('id',f.own).single()).workspace_version,source.workspace_version);console.log('PASS copying does not change the archived source revision');
 const anon=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});assert((await anon.rpc('workspace_copy_archived_task',{...args,p_write:crypto.randomUUID()})).error);console.log('PASS copy RPC is inaccessible to anonymous clients');
})();
