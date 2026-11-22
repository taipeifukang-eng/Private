const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
let grants=['active','inactive'];let writes=0;
const catalog=[{id:'active',code:'monthly.status.view',is_active:true},{id:'own',code:'monthly.status.view_own',is_active:true}];
const db={from(table){const q={select(){return q},eq(){return q},order(){return q},single:async()=>({data:{id:'role',is_system:false}}),then(resolve){return Promise.resolve({data:table==='permissions'?catalog:grants.map(permission_id=>({permission_id,is_allowed:true})),error:null}).then(resolve)}};return q},async rpc(name,args){assert.equal(name,'replace_role_permissions');const sorted=x=>JSON.stringify([...x].sort());if(sorted(args.p_expected_permission_ids)!==sorted(grants))return {error:{message:'ROLE_PERMISSIONS_CHANGED'}};if(args.p_permission_ids.some(id=>!catalog.some(p=>p.id===id)))return {error:{message:'INVALID_OR_INACTIVE_PERMISSION'}};grants=[...args.p_permission_ids];writes++;return {data:grants.length,error:null}}};
const deps={'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'admin'}}})}}),createAdminClient:()=>db},'@/lib/permissions/check':{requirePermission:async()=>({allowed:true})}};
const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/api/roles/[id]/permissions/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>{if(!deps[n])throw Error(n);return deps[n]},mod,mod.exports);
(async()=>{
 const api=mod.exports,params={params:{id:'role'}};
 const loaded=await api.GET({},params);assert.equal(loaded.status,200);assert.deepEqual(loaded.body.permissions.map(p=>p.id),['active','own']);assert.deepEqual(loaded.body.expectedPermissionIds,['active','inactive']);
 const prior=console.error;console.error=()=>{};
 try {
 const old=await api.POST({json:async()=>({permissionIds:['own'],expectedPermissionIds:['active']})},params);assert.equal(old.status,409);assert.equal(writes,0);
 const fixed=await api.POST({json:async()=>({permissionIds:['own'],expectedPermissionIds:loaded.body.expectedPermissionIds})},params);assert.equal(fixed.status,200);assert.deepEqual(grants,['own']);assert.equal(writes,1);
 const stale=await api.POST({json:async()=>({permissionIds:['active'],expectedPermissionIds:loaded.body.expectedPermissionIds})},params);assert.equal(stale.status,409);assert.deepEqual(grants,['own']);assert.equal(writes,1);
 }finally{console.error=prior;}
 console.log('PASS: hidden inactive grants included in lock snapshot; active-only UI; save succeeds; stale updates remain rejected.');
})().catch(e=>{console.error(e);process.exitCode=1});
