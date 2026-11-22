const fs=require('fs');require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),path='.tmp-check/organization-permissions-fixture.json';
const check=r=>{if(r.error)throw r.error;return r.data;};
async function main(){
 if(process.argv.includes('--cleanup')){
  const f=JSON.parse(fs.readFileSync(path,'utf8'));
  for(const u of f.units){const rows=check(await db.from('organization_units').select('id,code').eq('id',u.id));if(rows.some(row=>row.code!==u.code||!row.code.startsWith('VORGP-')))throw Error('Fixture mismatch');}
  const ids=f.units.map(u=>u.id);
  if(ids.length){
   const items=check(await db.from('work_items').select('id').in('organization_unit_id',ids));const itemIds=items.map(i=>i.id);
   if(itemIds.length){check(await db.from('work_assignments').delete().in('work_item_id',itemIds));const workReceipts=check(await db.from('workspace_department_requests').select('request_id,result'));const workRequestIds=workReceipts.filter(r=>itemIds.includes(r.result?.id)).map(r=>r.request_id);if(workRequestIds.length)check(await db.from('workspace_department_requests').delete().in('request_id',workRequestIds));check(await db.from('work_items').delete().in('id',itemIds));}
   check(await db.from('work_categories').delete().in('organization_unit_id',ids));
   for(const table of ['organization_memberships','organization_manager_assignments'])check(await db.from(table).delete().in('organization_unit_id',ids));
   const receipts=check(await db.from('workspace_organization_requests').select('request_id,result'));
   const selected=receipts.filter(r=>ids.includes(r.result?.id)).map(r=>r.request_id);if(selected.length)check(await db.from('workspace_organization_requests').delete().in('request_id',selected));
   check(await db.from('organization_units').delete().in('id',ids));}
  for(const a of f.actors){if(!a.email.startsWith('vorgp-')||!a.email.endsWith('@example.invalid'))throw Error('Unexpected actor');check(await db.from('user_roles').delete().eq('user_id',a.id));check(await db.auth.admin.deleteUser(a.id));}
  if(f.roles.length){check(await db.from('role_permissions').delete().in('role_id',f.roles));check(await db.from('roles').delete().in('id',f.roles));}
  fs.unlinkSync(path);console.log('Organization permission fixtures cleaned');return;
 }
 if(fs.existsSync(path))throw Error('Clean existing permission fixture before reseeding');
 const stamp=Date.now().toString(),f={actors:[],roles:[],units:[]};const persist=()=>fs.writeFileSync(path,JSON.stringify(f));persist();
 for(const [key,code] of Object.entries({view:'organization.organization.view',members:'organization.member.manage',managers:'organization.manager.manage',edit:'organization.department.edit',create:'organization.department.create'})){
  const email=`vorgp-${stamp}-${key}@example.invalid`,password=require('crypto').randomBytes(24).toString('hex');const user=check(await db.auth.admin.createUser({email,password,email_confirm:true})).user;
  require('../tests/support/credentials.cjs').registerAccount(`vorgp:${stamp}:${key}`,{email,password,userId:user.id});f.actors.push({key,id:user.id,email});persist();check(await db.from('profiles').update({role:'member',full_name:`Vue 組織驗證 ${key}`,department:null}).eq('id',user.id));
  const role=check(await db.from('roles').insert({code:`vorgp_${stamp}_${key}`,name:`組織驗證 ${key}`,is_active:true}).select('id').single());f.roles.push(role.id);persist();
  const permission=check(await db.from('permissions').select('id').eq('code',code).single());check(await db.from('role_permissions').insert({role_id:role.id,permission_id:permission.id,is_allowed:true}));check(await db.from('user_roles').insert({user_id:user.id,role_id:role.id,is_active:true}));
 }
 f.units=check(await db.from('organization_units').insert([0,1].map(i=>({code:`VORGP-${stamp}-${i}`,name:`Vue 組織權限測試 ${i}`,type:'department',status:'active'}))).select('id,code,name'));persist();console.log('Created 5 isolated permission actors and 2 departments');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
