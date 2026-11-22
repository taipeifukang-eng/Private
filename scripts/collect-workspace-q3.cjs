const {ROOT,source,target,all,save}=require('./workspace-q3-snapshot.cjs'),fs=require('fs'),path=require('path');
const schema=JSON.parse(fs.readFileSync(path.join(ROOT,'source-schema.json'))).definitions;
const stores=JSON.parse(fs.readFileSync(path.join(ROOT,'stores.json')));if(stores.length!==3||stores.map(s=>s.store_code).sort().join()!=='0002,0003,0004')throw Error('Unexpected stores');
const data={stores},ids=stores.map(s=>s.id),inList=a=>'in.('+[...new Set(a)].join(',')+')';
async function collect(table,params){if(!schema[table])throw Error('Missing source table '+table);data[table]=await all(source,table,params);console.log(table+': '+data[table].length);}
async function children(table,key,parents){const values=[...new Set(parents.filter(Boolean))];data[table]=[];for(let i=0;i<values.length;i+=80)data[table].push(...await all(source,table,{[key]:inList(values.slice(i,i+80))}));console.log(table+': '+data[table].length);}
(async()=>{
 const months=['monthly_staff_status','monthly_store_summary','monthly_bonus_records','monthly_prescription_reports','support_staff_bonus','meal_allowance_records','talent_cultivation_bonus','spring_festival_bonus','pharmacist_monthly_snapshot'];
 const jobs=months.map(t=>()=>collect(t,{store_id:inList(ids),year_month:'in.(2026-07,2026-08,2026-09)'}));
 jobs.push(()=>collect('store_performance',{store_id:inList(ids),year:'eq.2026',month:'in.(7,8,9)'}),()=>collect('store_performance_thresholds',{store_id:inList(ids)}),()=>collect('inspection_masters',{store_id:inList(ids),and:'(inspection_date.gte.2026-07-01,inspection_date.lt.2026-10-01)'}),()=>collect('inventory_result_batches',{store_id:inList(ids),year_month:'in.(2026-07,2026-08,2026-09)'}),()=>collect('campaign_schedules',{store_id:inList(ids),and:'(activity_date.gte.2026-07-01,activity_date.lt.2026-10-01)'}),()=>collect('store_employees',{store_id:inList(ids)}));
 for(let i=0;i<jobs.length;i+=4){const results=await Promise.allSettled(jobs.slice(i,i+4).map(f=>f()));for(const r of results)if(r.status==='rejected')throw r.reason;}
 await children('monthly_performance_details','staff_status_id',data.monthly_staff_status.map(r=>r.id));
 for(const t of ['inspection_results','inspection_on_duty_staff','inspection_improvements'])await children(t,'inspection_id',data.inspection_masters.map(r=>r.id));
 await children('inspection_templates','id',data.inspection_results.map(r=>r.template_id));
 data.inventory_result_items=[];for(const batch of data.inventory_result_batches)data.inventory_result_items.push(...await all(source,'inventory_result_items',{batch_id:'eq.'+batch.id,order:'row_number.asc,id.asc'}));console.log('inventory_result_items: '+data.inventory_result_items.length);
 const campaigns=data.campaign_schedules.map(r=>r.campaign_id);await children('campaigns','id',campaigns);
 for(const t of ['campaign_store_details','campaign_store_headcount','campaign_store_own_staff']){await children(t,'campaign_id',campaigns);data[t]=data[t].filter(r=>ids.includes(r.store_id));}
 for(const t of ['campaign_checklist_items','campaign_department_publish'])await children(t,'campaign_id',campaigns);
 await children('campaign_checklist_completions','checklist_item_id',data.campaign_checklist_items.map(r=>r.id));data.campaign_checklist_completions=data.campaign_checklist_completions.filter(r=>ids.includes(r.store_id));
 const profileIds=new Set();for(const [t,rows]of Object.entries(data))for(const row of rows)for(const [key,prop]of Object.entries(schema[t]?.properties||{}))if(row[key]&&(/<fk table='profiles'/.test(prop.description||'')||['created_by','updated_by','imported_by','completed_by','improved_by','inspector_id','closed_by'].includes(key)))profileIds.add(row[key]);
 data.profiles=[];const pids=[...profileIds];for(let i=0;i<pids.length;i+=80)data.profiles.push(...await all(source,'profiles',{id:inList(pids.slice(i,i+80)),select:'id,full_name,employee_code,department,job_title'}));
 // Snapshot configuration is current; the source does not retain historical versions.
 for(const t of ['inspection_grade_mapping','inspection_bonus_config'])await collect(t,{});
 save('data',data);save('manifest',{stores:stores.map(s=>({id:s.id,code:s.store_code,name:s.short_name})),period:['2026-07-01','2026-09-30'],capturedAt:new Date().toISOString(),counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length]))});
 const missing={};const devSchema=JSON.parse(fs.readFileSync(path.join(ROOT,'target-schema.json'))).definitions;
 for(const [t,rows]of Object.entries(data))if(rows.length){const keys=Object.keys(rows[0]).filter(k=>!devSchema[t]?.properties[k]);if(keys.length)missing[t]=keys;}
 console.log('Schema differences: '+JSON.stringify(missing));console.log('Profiles required: '+data.profiles.length);save('schema-differences',missing);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
