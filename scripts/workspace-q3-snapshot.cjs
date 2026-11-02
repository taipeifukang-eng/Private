const fs=require('fs'),path=require('path');
const ROOT=path.join(process.cwd(),'.tmp-check','prod-q3-copy');
const SOURCE='odvksgucvfoaqrumpran',TARGET='mjpdfpxqttbhzeimmtqr';
function env(file){const values={};for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)values[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}return values;}
function connection(file,ref){const e=env(file),url=e.NEXT_PUBLIC_SUPABASE_URL,key=e.SUPABASE_SERVICE_ROLE_KEY;if(new URL(url).hostname!==ref+'.supabase.co'||!key)throw Error('Environment mismatch');return {url,key};}
const source=connection('.env.local',SOURCE),target=connection('.env.development.local',TARGET);
async function read(conn,resource,params={}){const url=new URL('/rest/v1/'+resource,conn.url);for(const [k,v] of Object.entries(params))url.searchParams.append(k,v);const r=await fetch(url,{method:'GET',headers:{apikey:conn.key,Authorization:'Bearer '+conn.key,Accept:resource?'application/json':'application/openapi+json'}});if(!r.ok)throw Error(`${resource} read ${r.status}: ${await r.text()}`);return r.json();}
async function all(conn,table,params={}){let rows=[];const file=path.join(ROOT,(conn===source?'source':'target')+'-schema.json');const props=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).definitions?.[table]?.properties:{};const keys=Object.keys(props||{}).filter(k=>(props[k].description||'').includes('<pk/>'));const order=(keys.length?keys:props?.id?['id']:[Object.keys(props||{})[0]||'id']).map(k=>k+'.asc').join(',');for(let offset=0;;offset+=500){const part=await read(conn,table,{select:'*',order,...params,limit:'500',offset:String(offset)});rows.push(...part);if(part.length<500)break;}return rows;}
function save(name,data){fs.mkdirSync(ROOT,{recursive:true});fs.writeFileSync(path.join(ROOT,name+'.json'),JSON.stringify(data,null,2));}
async function inspect(){
 const [prodSchema,devSchema,stores]=await Promise.all([read(source,''),read(target,''),all(source,'stores',{or:'(store_code.in.(002,003,004),store_name.ilike.*南港*,store_name.ilike.*東湖*,store_name.ilike.*文德*)'})]);
 save('source-schema',prodSchema);save('target-schema',devSchema);save('store-candidates',stores);
 console.log(JSON.stringify(stores.map(s=>({id:s.id,code:s.store_code,name:s.store_name,active:s.is_active})),null,2));
 console.log('Source tables: '+Object.keys(prodSchema.definitions||{}).length+'; target tables: '+Object.keys(devSchema.definitions||{}).length);
}
if(require.main===module)inspect().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={ROOT,SOURCE,TARGET,source,target,read,all,save};
