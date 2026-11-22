/** One-off authorized anniversary snapshot. Production connection is GET/download only. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {source,target,TARGET,all}=require('./workspace-q3-snapshot.cjs');
const {createClient}=require('@supabase/supabase-js');require('@next/env').loadEnvConfig(process.cwd(),true);
const ROOT='.tmp-check/anniversary-2026-copy/',CID='721ca172-56ac-4938-8142-196af89df09c';
const read=n=>JSON.parse(fs.readFileSync(ROOT+n+'.json')),save=(n,v)=>fs.writeFileSync(ROOT+n+'.json',JSON.stringify(v,null,2));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const ids=['3737b4f9-0a0c-4c5b-8d6d-dadedc135187','80b3800d-4d6e-4556-8515-2b3a124852e7','94f5ad28-5105-4277-b7fb-f09683157463'];
const e=process.env;if(new URL(target.url).hostname!==TARGET+'.supabase.co'||e.EXPECTED_SUPABASE_PROJECT_REF!==TARGET||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true'||e.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS!=='true'||fs.readFileSync('supabase/.temp/project-ref','utf8').trim()!==TARGET)throw Error('DEV guard');
const dst=createClient(target.url,target.key,{auth:{persistSession:false}}),src=createClient(source.url,source.key,{auth:{persistSession:false}});
(async()=>{
 const d=read('selected'),actors=read('source-actors'),existing=await all(target,'profiles',{select:'id,employee_code,full_name'}),stores=await all(target,'stores');
 assert.equal(stores.length,3);assert(stores.every(s=>ids.includes(s.id)));
 assert.equal(d.campaigns[0].id,CID);assert.equal(d.campaigns[0].name,'2026年周年慶');
 assert.equal((await all(target,'campaigns',{or:'(id.eq.'+CID+',name.eq.2026年周年慶)'})).length,0,'Already imported; never overwrite');
 for(const [t,rows]of Object.entries(d))for(const r of rows){if(r.store_id)assert(ids.includes(r.store_id));if(r.requesting_store_id)assert(ids.includes(r.requesting_store_id)&&ids.includes(r.supporting_store_id));}
 const actorIds=[...new Set(Object.values(d).flat().flatMap(r=>Object.entries(r).filter(([k,v])=>/_by$/.test(k)&&v).map(([k,v])=>v)))];
 const identityMap={},needed=[];for(const id of actorIds){const p=actors.find(p=>p.id===id);assert(p,'Missing original actor');const match=existing.find(x=>x.id===id||(p.employee_code&&x.employee_code===p.employee_code));if(match)identityMap[id]=match.id;else needed.push(p);}
 const bucket='campaign-department-assets',assets=[];fs.mkdirSync(ROOT+'assets',{recursive:true});
 for(const [i,key]of d.campaign_department_publish[0].marketing_image_paths.entries()){
  assert(!key.includes('..')&&!key.startsWith('http'),'Unexpected source path');
  const r=await src.storage.from(bucket).download(key);if(r.error)throw Error('Source asset download failed '+i);
  const bytes=Buffer.from(await r.data.arrayBuffer()),file=i+'-'+path.basename(key),targetPath='campaign/'+CID+'/marketing/'+file;
  fs.writeFileSync(ROOT+'assets/'+file,bytes);assets.push({sourcePath:key,targetPath,file,bytes:bytes.length,type:r.data.type,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 save('assets-manifest',assets);save('preflight',{capturedAt:new Date().toISOString(),campaign:CID,counts:Object.fromEntries(Object.entries(d).map(([t,r])=>[t,r.length])),neededDisabledIdentities:needed.length,assets:assets.length,excludedExternalRequests:12,stores:3});
 console.log('Preflight ready: '+needed.length+' disabled snapshot identities, '+assets.length+' assets');
 if(process.argv[2]!=='--apply')return;
 const created=[];save('created-identities',created);
 for(const p of needed){const email='anniversary-snapshot-'+p.id+'@example.invalid';const r=await dst.auth.admin.createUser({email,password:crypto.randomBytes(48).toString('base64url'),email_confirm:true,ban_duration:'876000h',user_metadata:{full_name:p.full_name,snapshot_only:true}});if(r.error)throw Error('DEV identity creation failed');identityMap[p.id]=r.data.user.id;created.push({sourceId:p.id,targetId:r.data.user.id,email});save('created-identities',created);}
 save('identity-map',identityMap);
 const uploaded=[];save('uploaded-assets',uploaded);for(const a of assets){const r=await dst.storage.from(bucket).upload(a.targetPath,fs.readFileSync(ROOT+'assets/'+a.file),{contentType:a.type,upsert:false});if(r.error)throw Error('DEV asset upload failed '+a.file);uploaded.push(a.targetPath);save('uploaded-assets',uploaded);}
 for(const rows of Object.values(d))for(const r of rows)for(const [k,v]of Object.entries(r))if(/_by$/.test(k)&&v){assert(identityMap[v]);r[k]=identityMap[v];}
 d.campaign_department_publish[0].marketing_image_paths=assets.map(a=>a.targetPath);
 const order=['campaigns','campaign_schedules','campaign_store_details','campaign_store_headcount','campaign_store_own_staff','campaign_support_requests','campaign_support_staff','campaign_equipment_trips','campaign_checklist_items','campaign_department_publish'];
 const runId=crypto.randomUUID();let sql="BEGIN;\nSET LOCAL statement_timeout='120s';\n";
 sql+="DO $$ BEGIN IF EXISTS(SELECT 1 FROM campaigns WHERE id="+quote(CID)+"::uuid OR name='2026年周年慶') THEN RAISE EXCEPTION 'Activity already exists'; END IF; END $$;\n";
 for(const p of needed){const mapped=identityMap[p.id];sql+='UPDATE profiles SET full_name='+quote(p.full_name)+',employee_code='+(p.employee_code?quote(p.employee_code):'NULL')+",role='member' WHERE id="+quote(mapped)+'::uuid;\n';}
 for(const t of order){const rows=d[t];if(!rows?.length)continue;const payload=JSON.stringify(rows);let part=0;for(let start=0;start<payload.length;){let end=Math.min(start+100000,payload.length);if(payload.charCodeAt(end-1)>=0xD800&&payload.charCodeAt(end-1)<=0xDBFF)end--;const r=await dst.from('workspace_snapshot_import_chunks').insert({run_id:runId,table_name:t,batch_no:0,part_no:part++,payload:payload.slice(start,end)});if(r.error)throw Error('DEV staging failed');start=end;}
 const columns=Object.keys(rows[0]).filter(k=>k!=='workspace_version').map(k=>'"'+k+'"').join(',');sql+='INSERT INTO public."'+t+'" ('+columns+') SELECT '+columns+' FROM jsonb_populate_recordset(NULL::public."'+t+'",(SELECT string_agg(payload,\'\' ORDER BY part_no)::jsonb FROM workspace_snapshot_import_chunks WHERE run_id='+quote(runId)+'::uuid AND table_name='+quote(t)+'));\n';}
 sql+='DELETE FROM workspace_snapshot_import_chunks WHERE run_id='+quote(runId)+'::uuid;\nCOMMIT;\nSELECT count(*) AS imported_campaigns FROM campaigns WHERE id='+quote(CID)+'::uuid;\n';
 fs.writeFileSync('.tmp-check/anniversary-import.sql',sql);save('prepared',d);save('import-plan',{runId,campaignId:CID,created:created.length,assets:assets.length,preparedAt:new Date().toISOString()});console.log('DEV staging and import transaction ready');
})().catch(e=>{console.error(e.message);process.exitCode=1});
