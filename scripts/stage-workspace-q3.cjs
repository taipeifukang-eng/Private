const {ROOT,TARGET,target,all}=require('./workspace-q3-snapshot.cjs'),fs=require('fs'),path=require('path');
(async()=>{
 if(new URL(target.url).hostname!==TARGET+'.supabase.co')throw Error('DEV target mismatch');
 const chunks=JSON.parse(fs.readFileSync(path.join(ROOT,'staging.json'))),plan=JSON.parse(fs.readFileSync(path.join(ROOT,'import-plan.json')));
 for(let i=0;i<chunks.length;i+=4){const results=await Promise.allSettled(chunks.slice(i,i+4).map(async chunk=>{if(chunk.run_id!==plan.runId)throw Error('Run mismatch');const r=await fetch(target.url+'/rest/v1/workspace_snapshot_import_chunks',{method:'POST',headers:{apikey:target.key,Authorization:'Bearer '+target.key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(chunk)});if(!r.ok)throw Error('DEV staging failed '+r.status);}));for(const r of results)if(r.status==='rejected')throw r.reason;if(i%40===0)console.log('Staged '+Math.min(i+4,chunks.length)+' / '+chunks.length);}
 const rows=await all(target,'workspace_snapshot_import_chunks',{select:'run_id,table_name,batch_no,part_no',run_id:'eq.'+plan.runId,order:'table_name.asc,batch_no.asc,part_no.asc'});
 if(rows.length!==chunks.length)throw Error('Staging count mismatch');console.log('All '+rows.length+' chunks verified; ready for atomic DEV import');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
