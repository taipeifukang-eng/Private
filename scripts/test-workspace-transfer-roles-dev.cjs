const fs=require('fs'),{spawnSync}=require('child_process'),{randomUUID,randomBytes}=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env;if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV only');
const db=require('@supabase/supabase-js').createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),check=r=>{if(r.error)throw r.error;return r.data;};
(async()=>{
 const f={users:[],roles:[],stores:[],requests:[],created:[randomUUID(),randomUUID()],confirmation:{id:randomUUID(),code:'VTC'+randomBytes(6).toString('hex').toUpperCase()},races:['confirm-confirm','same-actor','confirm-reject'].map(kind=>({kind,id:randomUUID(),code:'VTRC'+randomBytes(6).toString('hex').toUpperCase(),target:randomUUID(),month:randomUUID()}))},stamp=randomBytes(6).toString('hex');
 const save=()=>fs.writeFileSync('.tmp-check/transfer-roles-fixture.json',JSON.stringify(f));
 try{
  f.stores=check(await db.from('stores').insert([0,1,2].map(n=>({store_code:'VTR'+stamp+n,store_name:'Vue 調店權限驗證 '+n,is_active:true}))).select('id'));save();
  for(const [key,codes,managed] of [['create',['create'],true],['confirm',['confirm'],true],['both',['create','confirm'],true],['unmanaged',['confirm'],false]]){
   const email=`transfer-${stamp}-${key}@example.invalid`,password=randomBytes(24).toString('hex');
   const user=check(await db.auth.admin.createUser({email,password,email_confirm:true})).user;f.users.push({id:user.id,key,email,password});save();
   check(await db.from('profiles').update({role:'user',full_name:'Vue 調店權限 '+key}).eq('id',user.id));
   const role=check(await db.from('roles').insert({code:'vtr_'+stamp+'_'+key,name:'Vue 調店權限 '+key,is_active:true}).select('id').single());f.roles.push(role.id);save();
   const permissions=check(await db.from('permissions').select('id').in('code',codes.map(c=>'employee.store_transfer.'+c)));
   if(permissions.length!==codes.length)throw Error('Missing permissions');
   check(await db.from('role_permissions').insert(permissions.map(p=>({role_id:role.id,permission_id:p.id,is_allowed:true}))));
   check(await db.from('user_roles').insert({user_id:user.id,role_id:role.id,is_active:true}));
   if(managed)check(await db.from('store_managers').insert({user_id:user.id,store_id:f.stores[0].id,role_type:'supervisor',is_primary:false}));
  }
  f.requests=[randomUUID(),randomUUID(),randomUUID()];save();
  check(await db.from('store_transfer_requests').insert([[0,1],[1,0],[1,2]].map(([from,to],i)=>({id:f.requests[i],employee_code:'VTR'+stamp+i,employee_name:'調店權限驗證',from_store_id:f.stores[from].id,to_store_id:f.stores[to].id,status:'pending'}))));
  if(!process.argv.includes('--confirm-only')&&!process.argv.includes('--races-only')){
  const r=spawnSync('python',['scripts/test-workspace-transfer-roles.py'],{stdio:'inherit'});if(r.status)throw Error('Role matrix failed');
  // The DEV stores RLS grants the all-store catalog through service-center access.
  // Keep the isolated transfer matrix above independent; add catalog access only for creation tests.
  const catalogPermission=check(await db.from('permissions').select('id').eq('code','general_affairs.service_center.access').single());
  check(await db.from('role_permissions').insert({role_id:f.roles[0],permission_id:catalogPermission.id,is_allowed:true}));
  const create=spawnSync('python',['scripts/test-workspace-transfer-create.py'],{stdio:'inherit'});if(create.status)throw Error('Create workflow failed');
  }
  if(!process.argv.includes('--races-only')){
  const code=f.confirmation.code;
  check(await db.from('store_employees').insert({employee_code:code,employee_name:'新版確認驗證',store_id:f.stores[0].id,employment_type:'full_time',employment_status:'active',is_active:true,position:'專員',current_position:'專員'}));
  check(await db.from('monthly_staff_status').insert([{store_id:f.stores[0].id,employee_code:code},{store_id:f.stores[1].id,employee_code:code+'X'}].map(x=>({...x,employee_name:'確認驗證',year_month:'2026-07',employment_type:'full_time',monthly_status:'full_month',work_days:31,status:'draft'}))));
  check(await db.from('store_transfer_requests').insert({id:f.confirmation.id,employee_code:code,employee_name:'新版確認驗證',from_store_id:f.stores[0].id,to_store_id:f.stores[1].id,status:'pending'}));
  const confirm=spawnSync('python',['scripts/test-workspace-transfer-confirm.py'],{stdio:'inherit'});if(confirm.status)throw Error('Confirm workflow failed');
  const master=check(await db.from('store_employees').select('store_id,is_active').eq('employee_code',code));
  if(master.length!==2||!master.some(x=>x.store_id===f.stores[0].id&&!x.is_active)||!master.some(x=>x.store_id===f.stores[1].id&&x.is_active))throw Error('Master readback mismatch');
  const months=check(await db.from('monthly_staff_status').select('store_id,work_days,monthly_status').eq('employee_code',code));
  if(months.length!==2||!months.some(x=>x.store_id===f.stores[0].id&&x.work_days===19&&x.monthly_status==='transferred_out')||!months.some(x=>x.store_id===f.stores[1].id&&x.work_days===12&&x.monthly_status==='transferred_in'))throw Error('Monthly readback mismatch');
  console.log('PASS API/UI confirmation master and monthly database readback');
  const actual=check(await db.from('workspace_transfer_corrections').select('created_at').eq('transfer_id',f.confirmation.id).single());
  check(await db.from('workspace_transfer_corrections').insert(Array.from({length:24},(_,i)=>({request_id:randomUUID(),actor_id:f.users.find(u=>u.key==='confirm').id,transfer_id:f.confirmation.id,old_date:'2026-07-15',new_date:'2026-07-20',reason:'分頁驗證 '+String(i+1).padStart(2,'0')+'\n多行原因',before_data:{private_marker:'must_not_return'},result:{},created_at:new Date(Date.parse(actual.created_at)-(i+1)*60000).toISOString()}))));
  check(await db.from('store_transfer_requests').update({status:'confirmed',effective_date:'2026-07-12',corrected_at:new Date().toISOString(),corrected_by:f.users.find(u=>u.key==='confirm').id,correction_reason:'只有最後更正的舊紀錄'}).eq('id',f.requests[0]));
  const historyTest=spawnSync('python',['scripts/test-workspace-transfer-history.py'],{stdio:'inherit'});if(historyTest.status)throw Error('Correction history test failed');
  }
  for(const race of f.races){
   check(await db.from('store_employees').insert([{id:randomUUID(),store_id:f.stores[0].id,is_active:true,employment_status:'active',position:'專員',current_position:'專員',is_pharmacist:true,birthday:'1990-02-01',start_date:'2020-01-01'},{id:race.target,store_id:f.stores[1].id,is_active:false,employment_status:'resigned',position:'新人',current_position:'新人',is_pharmacist:false}].map(x=>({...x,employee_code:race.code,employee_name:'並行驗證',employment_type:'full_time'}))));
   check(await db.from('monthly_staff_status').insert([{id:randomUUID(),store_id:f.stores[0].id},{id:race.month,store_id:f.stores[1].id,notes:'保留手動備註',extra_tasks:['既有工作'],monthly_transport_expense:123}].map(x=>({...x,employee_code:race.code,employee_name:'並行驗證',year_month:'2026-07',employment_type:'full_time',monthly_status:'full_month',work_days:31,status:'draft'}))));
   check(await db.from('store_transfer_requests').insert({id:race.id,employee_code:race.code,employee_name:'並行驗證',from_store_id:f.stores[0].id,to_store_id:f.stores[1].id,status:'pending'}));
  }
  const races=spawnSync('python',['scripts/test-workspace-transfer-races.py'],{stdio:'inherit'});if(races.status)throw Error('Concurrent workflow failed');
  for(const race of f.races){
   const request=check(await db.from('store_transfer_requests').select('status,movement_history_id').eq('id',race.id).single()),confirmed=request.status==='confirmed';
   const history=check(await db.from('employee_movement_history').select('id').eq('employee_code',race.code));
   const masters=check(await db.from('store_employees').select('id,store_id,is_active,is_pharmacist,birthday,start_date,current_position').eq('employee_code',race.code));
   const months=check(await db.from('monthly_staff_status').select('id,store_id,work_days,notes,extra_tasks,monthly_transport_expense').eq('employee_code',race.code));
   const target=masters.find(m=>m.id===race.target),month=months.find(m=>m.id===race.month);
   if(history.length!==(confirmed?1:0)||masters.length!==2||months.length!==2||target?.is_active!==confirmed||!masters.some(m=>m.store_id===f.stores[0].id&&m.is_active===!confirmed)||!months.some(m=>m.store_id===f.stores[0].id&&m.work_days===(confirmed?14:31))||month?.notes!=='保留手動備註'||JSON.stringify(month?.extra_tasks)!==JSON.stringify(['既有工作'])||month?.monthly_transport_expense!==123||month?.work_days!==(confirmed?17:31))throw Error('Concurrent data mismatch: '+race.kind);
   if(confirmed&&(!target.is_pharmacist||target.current_position!=='專員'||target.birthday!=='1990-02-01'||target.start_date!=='2020-01-01'||request.movement_history_id!==history[0].id))throw Error('Existing destination master not synchronized');
  }
  console.log('PASS concurrent database readback: one history, stable existing master/month IDs, source metadata and unrelated monthly fields preserved');
 }finally{
  check(await db.from('workspace_transfer_corrections').delete().in('transfer_id',[...f.requests,...f.created,f.confirmation.id,...f.races.map(r=>r.id)]));
  check(await db.from('store_transfer_requests').delete().in('id',[...f.requests,...f.created,f.confirmation.id,...f.races.map(r=>r.id)]));
  check(await db.from('employee_movement_history').delete().in('employee_code',[f.confirmation.code,...f.races.map(r=>r.code)]));
  check(await db.from('monthly_staff_status').delete().in('employee_code',[f.confirmation.code,f.confirmation.code+'X',...f.races.map(r=>r.code)]));
  check(await db.from('store_employees').delete().in('employee_code',[f.confirmation.code,...f.races.map(r=>r.code)]));
  const ids=f.users.map(u=>u.id);if(ids.length){check(await db.from('store_managers').delete().in('user_id',ids));check(await db.from('user_roles').delete().in('user_id',ids));}
  if(f.roles.length){check(await db.from('role_permissions').delete().in('role_id',f.roles));check(await db.from('roles').delete().in('id',f.roles));}
  for(const id of ids)check(await db.auth.admin.deleteUser(id));
  if(f.stores.length)check(await db.from('stores').delete().in('id',f.stores.map(s=>s.id)));
  console.log('Owned transfer role fixtures cleaned');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});

