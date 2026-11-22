// PROD is GET/download only. Writes are restricted to the fixed DEV project.
const fs=require('fs'),crypto=require('crypto'),{spawnSync}=require('child_process');
const {source,target,all,read}=require('./workspace-q3-snapshot.cjs');
const {createClient}=require('@supabase/supabase-js');
const root='.tmp-check/pharmacist-copy-2026';const bucket='pharmacist-fee-proofs';
const tables=['pharmacist_annual_master','pharmacist_profiles','pharmacist_annual_fees'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 if(new URL(target.url).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co')throw Error('DEV target required');
 if(fs.existsSync(root+'/completed.json'))throw Error('Already completed; inspect report before rerunning');
 fs.mkdirSync(root,{recursive:true});
 const storeFilter={store_code:'in.(0002,0003,0004,002,003,004)'};
 const [ps,ds]=await Promise.all([all(source,'stores',storeFilter),all(target,'stores',storeFilter)]);
 if(ps.length!==3||ds.length!==3)throw Error('Expected exactly three stores');
 const normalized=x=>String(Number(x));const map=new Map(ps.map(s=>[s.id,ds.find(d=>normalized(d.store_code)===normalized(s.store_code))?.id]));if([...map.values()].some(x=>!x))throw Error('Store mapping missing');
 const master=await all(source,tables[0],{year:'eq.2026',current_store_id:'in.('+[...map.keys()].join(',')+')'});if(master.length!==9)throw Error('Source count changed; inspect');
 const codes=master.map(r=>r.employee_code);const filter={employee_code:'in.('+codes.join(',')+')'};
 const profiles=await all(source,tables[1],filter),fees=await all(source,tables[2],{...filter,fee_year:'eq.2026'});
 const original={master,profiles,fees,stores:ps};fs.writeFileSync(root+'/source.json',JSON.stringify(original,null,2));
 const before={};for(const t of tables)before[t]=await all(target,t);before.locks=await all(target,'pharmacist_annual_master_locks',{order:'year.asc'});before.sync=await all(target,'pharmacist_annual_master_sync_log',{order:'year.asc'});
 fs.writeFileSync(root+'/dev-before.json',JSON.stringify(before,null,2));
 if(before[tables[0]].some(r=>r.year===2026&&codes.includes(r.employee_code))||before[tables[1]].some(r=>codes.includes(r.employee_code))||before[tables[2]].some(r=>codes.includes(r.employee_code)))throw Error('Target data exists; refusing overwrite');
 const src=createClient(source.url,source.key),dst=createClient(target.url,target.key);const copied=[];let committed=false;
 try{
  const proofMap=new Map();for(const f of fees){if(!f.payment_proof_path||proofMap.has(f.payment_proof_path))continue;
   const {data,error}=await src.storage.from(bucket).download(f.payment_proof_path);if(error)throw error;
   const bytes=Buffer.from(await data.arrayBuffer());const path='prod-copy-2026/'+f.payment_proof_path;
   fs.mkdirSync(root+'/proofs',{recursive:true});fs.writeFileSync(root+'/proofs/'+hash(Buffer.from(f.payment_proof_path)),bytes);
   const up=await dst.storage.from(bucket).upload(path,bytes,{contentType:data.type||'application/octet-stream',upsert:false});if(up.error)throw up.error;
   copied.push({source:f.payment_proof_path,target:path,sha256:hash(bytes),size:bytes.length});proofMap.set(f.payment_proof_path,path);
  }
  fs.writeFileSync(root+'/proof-manifest.json',JSON.stringify(copied,null,2));
  const payload={pharmacist_annual_master:master.map(r=>({...r,current_store_id:map.get(r.current_store_id)})),pharmacist_profiles:profiles,pharmacist_annual_fees:fees.map(r=>({...r,payment_proof_path:r.payment_proof_path?proofMap.get(r.payment_proof_path):r.payment_proof_path}))};
  fs.writeFileSync(root+'/payload.json',JSON.stringify(payload,null,2));
  const quote=s=>"'"+s.replaceAll("'","''")+"'";let sql='BEGIN;\nLOCK TABLE public.pharmacist_annual_master, public.pharmacist_profiles, public.pharmacist_annual_fees IN SHARE ROW EXCLUSIVE MODE;\n';
  for(const[t,rows]of Object.entries(payload))if(rows.length)sql+=`INSERT INTO public.${t} SELECT * FROM jsonb_populate_recordset(NULL::public.${t}, ${quote(JSON.stringify(rows))}::jsonb);\n`;
  sql+='COMMIT;\n';fs.writeFileSync(root+'/apply.sql',sql);
  const run=spawnSync(process.execPath,['scripts/dev-cleanup-query.cjs',root+'/apply.sql',root+'/apply-result.json'],{encoding:'utf8'});if(run.status)throw Error(run.stderr||run.stdout);committed=true;
  for(const[t,rows]of Object.entries(payload)){
   const current=await all(target,t,t===tables[0]?{...filter,year:'eq.2026'}:t===tables[2]?{...filter,fee_year:'eq.2026'}:filter);if(current.length!==rows.length)throw Error(t+' count mismatch');
   for(const r of rows){const found=current.find(x=>t===tables[1]?x.employee_code===r.employee_code:x.id===r.id);if(!found||Object.keys(r).some(k=>JSON.stringify(found[k])!==JSON.stringify(r[k])))throw Error(t+' field mismatch');}
  }
  for(const f of copied){const{data,error}=await dst.storage.from(bucket).download(f.target);if(error||hash(Buffer.from(await data.arrayBuffer()))!==f.sha256)throw Error('Proof verification failed');}
  const report={master:master.length,active:master.filter(r=>r.status==='active').length,resigned:master.filter(r=>r.status==='resigned').length,profiles:profiles.length,fees:fees.length,proofs:copied.length,verified:true,sourceReadOnly:true};fs.writeFileSync(root+'/completed.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){if(!committed&&copied.length){const{error}=await dst.storage.from(bucket).remove(copied.map(x=>x.target));if(error)console.error('Storage rollback failed; inspect manifest');}throw e;}
})().catch(e=>{console.error(e.message);process.exitCode=1});
