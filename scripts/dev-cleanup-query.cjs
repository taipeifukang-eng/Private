// Guarded DEV-only query runner. Output is saved locally; never print row contents.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');require('@next/env').loadEnvConfig(process.cwd(),true);
const e=process.env,ref='mjpdfpxqttbhzeimmtqr';
if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!==ref+'.supabase.co'||e.EXPECTED_SUPABASE_PROJECT_REF!==ref||e.ALLOW_DEV_DATABASE_OPERATIONS!=='true'||e.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS!=='true'||fs.readFileSync('supabase/.temp/project-ref','utf8').trim()!==ref)throw Error('DEV guard');
const [sql,out]=process.argv.slice(2);if(!/^\.tmp-check\/[a-zA-Z0-9/_-]+\.sql$/.test(sql||'')||!/^\.tmp-check\/[a-zA-Z0-9/_-]+\.json$/.test(out||''))throw Error('Explicit local audit paths required');
const r=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase db query --linked --file ${sql}`],{encoding:'utf8',maxBuffer:256*1024*1024});if(r.status)throw Error(r.stderr);
const result=JSON.parse(r.stdout);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result.rows));console.log('Saved DEV query result: '+out+' ('+result.rows.length+' rows)');
