const fs=require('fs');const{source,target,all,read}=require('./workspace-q3-snapshot.cjs');
(async()=>{
const tables=['pharmacist_annual_master','pharmacist_profiles','pharmacist_annual_fees','pharmacist_annual_master_locks','pharmacist_annual_master_sync_log'];
const output={};let sourceCodes=[];
for(const [name,conn]of [['prod',source],['dev',target]]){
 const stores=await all(conn,'stores',{select:'id,store_code',store_code:'in.(0002,0003,0004,002,003,004)'});const ids=new Set(stores.map(s=>s.id));
 const master=await all(conn,'pharmacist_annual_master',{select:'year,employee_code,current_store_id,source,status',order:'employee_code.asc',year:'eq.2026'});const scoped=master.filter(r=>ids.has(r.current_store_id));const codes=name==='prod'?scoped.map(r=>r.employee_code):sourceCodes;if(name==='prod')sourceCodes=codes;
 const details={masterCount:master.length,threeStoreCount:scoped.length,sourceCounts:master.reduce((a,r)=>(a[r.source]=(a[r.source]||0)+1,a),{}),threeStoreStatus:scoped.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),locks:await read(conn,'pharmacist_annual_master_locks',{select:'year,locked_at',year:'eq.2026'}),sync:await read(conn,'pharmacist_annual_master_sync_log',{select:'year,last_synced_at',year:'eq.2026'})};
 for(const table of ['pharmacist_profiles','pharmacist_annual_fees'])details[table]=codes.length?(await all(conn,table,{select:'employee_code',order:'employee_code.asc',employee_code:'in.('+codes.join(',')+')'})).length:0;
 const movements=await all(conn,'employee_movement_history',{select:'onboarding_is_pharmacist',order:'id.asc',store_id:'in.('+[...ids].join(',')+')',movement_type:'eq.onboarding',movement_date:'gte.2026-01-01'});details.pharmacistOnboarding=movements.filter(x=>x.onboarding_is_pharmacist).length;
 output[name]=details;
 const schema=await read(conn,'');output[name].columns=Object.fromEntries(tables.map(t=>[t,Object.keys(schema.definitions?.[t]?.properties||{}).sort()]));
}
const columnsEqual=JSON.stringify(output.prod.columns)===JSON.stringify(output.dev.columns);delete output.prod.columns;delete output.dev.columns;output.columnsEqual=columnsEqual;
fs.mkdirSync('.tmp-check/pharmacist-audit',{recursive:true});fs.writeFileSync('.tmp-check/pharmacist-audit/summary.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
