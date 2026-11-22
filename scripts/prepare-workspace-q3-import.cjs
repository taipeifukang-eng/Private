const {ROOT,TARGET,target,all,save}=require('./workspace-q3-snapshot.cjs'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const load=n=>JSON.parse(fs.readFileSync(path.join(ROOT,n+'.json'))),data=load('data'),sourceSchema=load('source-schema').definitions,devSchema=load('target-schema').definitions;
const q=s=>"'"+String(s).replaceAll("'","''")+"'",identifier=s=>'"'+s.replaceAll('"','""')+'"';
async function devAuth(profile){
 if(new URL(target.url).hostname!==TARGET+'.supabase.co')throw Error('Target mismatch');
 const email='q3-snapshot-'+profile.id+'@example.invalid';
 const r=await fetch(target.url+'/auth/v1/admin/users',{method:'POST',headers:{apikey:target.key,Authorization:'Bearer '+target.key,'Content-Type':'application/json'},body:JSON.stringify({email,password:crypto.randomBytes(48).toString('base64url'),email_confirm:true,ban_duration:'876000h',user_metadata:{full_name:profile.full_name,snapshot_only:true}})});
 const result=await r.json();if(!r.ok)throw Error('DEV identity creation failed: '+r.status);return {id:result.id,email};
}
(async()=>{
 const stores=await all(target,'stores',{select:'id,store_code'});for(const s of data.stores)if(stores.some(d=>d.id===s.id||d.store_code===s.store_code))throw Error('Target store already exists; inspect before importing');
 const identities=fs.existsSync(path.join(ROOT,'identities.json'))?load('identities'):{};
 for(const p of data.profiles){if(!identities[p.id]){identities[p.id]=await devAuth(p);save('identities',identities);}}
 data.store_employees=data.store_employees.filter(e=>data.monthly_staff_status.some(r=>r.store_id===e.store_id&&r.employee_code===e.employee_code));
 const runId=crypto.randomUUID(),staging=[];const mapped={};for(const [table,rows]of Object.entries(data)){
  if(!rows.length)continue;
  mapped[table]=rows.map(row=>{const r={...row};for(const [key,val]of Object.entries(r)){const prop=sourceSchema[table]?.properties[key];if(val&&identities[val]&&(/<fk table='profiles'/.test(prop?.description||'')||['created_by','updated_by','imported_by','completed_by','improved_by','inspector_id','closed_by','prescription_data_updated_by'].includes(key)))r[key]=identities[val].id;}
   if(table==='profiles')return {...r,id:identities[row.id].id,email:identities[row.id].email,role:'member'};
   if(table==='stores')r.phone=null;
   if(table==='store_employees')r.birthday=null;
   if(table==='campaigns'){r.published_to_supervisors=false;r.published_to_store_managers=false;r.published_to_inventory_team=false;r.published_at=null;}
   return r;
  });
 }
 save('prepared-data',mapped);
 const order=['profiles','stores','store_employees','inspection_templates','inspection_grade_mapping','inspection_bonus_config','campaigns','store_performance','store_performance_thresholds','monthly_store_summary','monthly_staff_status','monthly_bonus_records','monthly_prescription_reports','support_staff_bonus','meal_allowance_records','talent_cultivation_bonus','spring_festival_bonus','pharmacist_monthly_snapshot','monthly_performance_details','inspection_masters','inspection_results','inspection_on_duty_staff','inspection_improvements','inventory_result_batches','inventory_result_items','campaign_schedules','campaign_store_details','campaign_store_headcount','campaign_store_own_staff','campaign_checklist_items','campaign_checklist_completions','campaign_department_publish'];
 let sql=`BEGIN;\nSET LOCAL statement_timeout='180s';\nALTER TABLE public.store_performance ALTER COLUMN business_days TYPE numeric(4,1) USING business_days::numeric(4,1);\nALTER TABLE public.monthly_store_summary ALTER COLUMN business_days TYPE numeric(4,1) USING business_days::numeric(4,1);\nALTER TABLE public.stores ADD COLUMN IF NOT EXISTS gps_latitude numeric, ADD COLUMN IF NOT EXISTS gps_longitude numeric;\nALTER TABLE public.monthly_store_summary ADD COLUMN IF NOT EXISTS regular_prescription_point_value numeric(12,4), ADD COLUMN IF NOT EXISTS chronic_prescription_point_value numeric(12,4), ADD COLUMN IF NOT EXISTS prescription_data_updated_at timestamptz, ADD COLUMN IF NOT EXISTS prescription_data_updated_by uuid REFERENCES public.profiles(id), ADD COLUMN IF NOT EXISTS total_chronic_prescription_count numeric(12,1);\n`;
 const included=order.filter(t=>mapped[t]?.length);
 for(const t of included)sql+=`ALTER TABLE public.${identifier(t)} DISABLE TRIGGER USER;\n`;
 // Backup was taken before this DEV-only configuration replacement.
 sql+='UPDATE public.inspection_templates SET is_active=false WHERE is_active=true;\nDELETE FROM public.inspection_grade_mapping;\nDELETE FROM public.inspection_bonus_config;\n';
 for(const t of included){const rows=mapped[t],keys=Object.keys(rows[0]);
  for(let i=0;i<rows.length;i+=300){const batch=rows.slice(i,i+300);const cols=keys.filter(k=>!(t==='monthly_prescription_reports'&&k==='total_chronic_prescription_count'));const list=cols.map(identifier).join(',');
   const payload=JSON.stringify(batch);let part=0;for(let start=0;start<payload.length;){let end=Math.min(start+240000,payload.length);const code=payload.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--;staging.push({run_id:runId,table_name:t,batch_no:i/300,part_no:part++,payload:payload.slice(start,end)});start=end;}
   sql+=`INSERT INTO public.${identifier(t)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${identifier(t)},(SELECT string_agg(payload,'' ORDER BY part_no)::jsonb FROM public.workspace_snapshot_import_chunks WHERE run_id=${q(runId)}::uuid AND table_name=${q(t)} AND batch_no=${i/300}))`;
   if(t==='profiles')sql+=` ON CONFLICT(id) DO UPDATE SET full_name=EXCLUDED.full_name,employee_code=EXCLUDED.employee_code,department=EXCLUDED.department,job_title=EXCLUDED.job_title,role='member'`;
   sql+=';\n';
  }
 }
 for(const t of included)sql+=`ALTER TABLE public.${identifier(t)} ENABLE TRIGGER USER;\n`;
 sql+=`DELETE FROM public.workspace_snapshot_import_chunks WHERE run_id=${q(runId)}::uuid;\n`;
 save('staging',staging);
 sql+="NOTIFY pgrst,'reload schema';\nCOMMIT;\n";
 fs.writeFileSync(path.join(ROOT,'import.sql'),sql);save('import-plan',{runId,stagingChunks:staging.length,createdAt:new Date().toISOString(),counts:Object.fromEntries(included.map(t=>[t,mapped[t].length])),identities:Object.keys(identities).length,notifications:'publication flags cleared; no production login credentials copied',configBackup:['target-before-inspection_grade_mapping.json','target-before-inspection_bonus_config.json']});
 console.log('Prepared DEV transaction; records '+Object.values(mapped).reduce((n,r)=>n+r.length,0)+'; disabled-login identities '+Object.keys(identities).length+'; SQL bytes '+Buffer.byteLength(sql));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
