const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,deps){const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',js)((name)=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)},m,m.exports);return m.exports;}
const bonus='monthly.allowance.edit_support_bonus',manual='monthly.status.add_employee';
let permissions=new Set(),assigned=true,confirmed=false,writes=0;
const db={from(table){const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:table==='store_managers'?(assigned?{id:'assignment'}:null):{store_status:confirmed?'confirmed':'pending'},error:null}),insert(){writes++;return q},update(){writes++;return q},delete(){writes++;return q}};return q;}};
const hasPermission=async(_,p)=>permissions.has(p);
const server={createAdminClient:()=>db,createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})};
const guard=load('lib/permissions/monthly-registration.ts',{'@/lib/supabase/server':server,'./check':{hasPermission}});
async function denied(p,status=403){await assert.rejects(()=>guard.authorizeMonthlyRegistration('user','store','2026-11',p),e=>e.status===status)}
(async()=>{
permissions=new Set([manual]);await guard.authorizeMonthlyRegistration('user','store','2026-11',manual);await denied(bonus);
permissions=new Set([bonus]);await guard.authorizeMonthlyRegistration('user','store','2026-11',bonus);await denied(manual);
assigned=false;await denied(bonus);permissions.add('monthly.status.view_all');await guard.authorizeMonthlyRegistration('user','store','2026-11',bonus);
confirmed=true;await denied(bonus,409);confirmed=false;assigned=true;
permissions=new Set(['monthly.status.edit','monthly.allowance.edit_transport','monthly.allowance.edit_meal','monthly.allowance.edit_talent']);await denied(bonus);await denied(manual);
const next={NextResponse:{json:(body,options={})=>({body,status:options.status||200})}};
const deps={'@/lib/supabase/server':server,'@/lib/permissions/check':{hasPermission},'@/lib/permissions/monthly-registration':guard,'next/server':next};
// Invoke actual handlers: a crafted direct request cannot bypass either group.
for(const route of ['transport-expense/save','talent-cultivation/save','spring-festival-bonus/save','support-bonus/save','meal-allowance']){
 const handler=load('app/api/'+route+'/route.ts',deps);
 const request={json:async()=>({year_month:'2026-11',store_id:'store',expenses:[],bonuses:[],records:[]}),nextUrl:new URL('http://localhost/?id=record')};
 const prior=console.error;console.error=()=>{};
 try{assert.equal((await handler.POST(request)).status,403,route);if(handler.DELETE)assert.equal((await handler.DELETE(request)).status,403,'meal deletion');}finally{console.error=prior;}
}
const actions=load('app/store/actions.ts',{...deps,'next/cache':{revalidatePath:()=>{}},'@/lib/store/historical':{}});
const previousError=console.error;console.error=()=>{};
try {
 permissions=new Set([bonus]);
 assert.equal((await actions.addManualEmployee('store','2026-11',{})).success,false,'bonus grant cannot add staff');
 permissions=new Set([manual]);
 assert.equal((await actions.addManualEmployee('store','2026-11',{last_month_single_item_bonus:100})).success,false,'manual grant cannot smuggle a bonus through staff creation');
} finally {console.error=previousError;}
assert.equal(writes,0,'denied requests must never write');
if (fs.existsSync('lib/workspace/monthly-tools.ts')) {
const workspace=load('lib/workspace/monthly-tools.ts',{'./server':{WorkspaceError:Error,checked:x=>x.data}});
assert.equal(new Set(Object.values(workspace.monthlyTools).map(x=>x.permission)).size,1);
for(const tool of Object.values(workspace.monthlyTools))assert.equal(tool.permission,bonus);
}
console.log('PASS: independent manual/bonus grants; legacy grants denied; assigned/all-store scope; confirmed month; all five POST handlers and meal DELETE deny without writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
