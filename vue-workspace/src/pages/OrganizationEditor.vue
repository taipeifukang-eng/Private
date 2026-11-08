<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { api, ApiError } from '../api';
import { useWorkspace, type WorkTab } from '../stores';
import { unitTypes, managerRoles, descendants } from '../organization';
import Modal from '../components/Modal.vue';
const props = defineProps<{tab: WorkTab}>();
const mode = props.tab.payload?.mode || 'basic';
const work = useWorkspace();
const units = ref<any[]>([]), people = ref<any[]>([]), version = ref(''), loading = ref(false), error = ref(''), message = ref(''), conflict = ref(false), permitted = ref(false), search = ref(''), confirm = ref(false);
const form = ref<any>({code:'',name:'',short_name:'',type:'department',parent_id:props.tab.payload?.parentId || null,status:'active',description:'',sort_order:0});
const review=ref(false),latest=ref<any>(null);
const members = ref<string[]>([]), managers = ref<any[]>([]);
let baseline = '', pendingKey = '', requestId = '', resolveConfirm: ((ok:boolean)=>void)|null = null;
const current = computed(() => units.value.find(u => u.id === props.tab.recordId));
const state = () => JSON.stringify(mode === 'members' ? [...members.value].sort() : mode === 'managers' ? managers.value : form.value);
watch([form,members,managers], () => { if(baseline) props.tab.dirty = state() !== baseline; message.value=''; }, {deep:true,flush:'sync'});
const parentOptions = computed(() => { const excluded = descendants(units.value, props.tab.recordId || ''); return units.value.filter(u => !excluded.has(u.id) && (u.status==='active' || u.id===form.value.parent_id)); });
const filteredPeople = computed(() => people.value.filter(p => [p.full_name,p.email,p.employee_code,p.job_title].some(v => String(v||'').toLowerCase().includes(search.value.trim().toLowerCase()))));
const personName = (id:string) => { const p=people.value.find(p=>p.id===id);return p ? `${p.employee_code||''} ${p.full_name||p.email}` : current.value?.members?.find((m:any)=>m.user_id===id)?.user?.full_name || id; };
const labels:Record<string,string>={code:'單位代碼',name:'單位名稱',short_name:'簡稱',type:'類型',parent_id:'上層單位',status:'狀態',description:'說明',sort_order:'排序'};
const differences=computed(()=>mode==='basic'&&latest.value?Object.keys(labels).filter(k=>JSON.stringify(form.value[k])!==JSON.stringify(latest.value[k])):[]);
function display(value:any,key:string){if(key==='parent_id')return units.value.find(u=>u.id===value)?.name||'無上層單位';if(key==='type')return unitTypes[value];if(key==='status')return value==='active'?'啟用':'停用';return value??'未填寫';}
function useLatest(key?:string){if(mode==='basic'&&key)form.value[key]=latest.value[key];else if(mode==='members')members.value=[...latest.value];else if(mode==='managers')managers.value=latest.value.map((m:any)=>({...m}));}
async function load(preserve=false) {
 loading.value=true;error.value='';
 try {
  const d=await api('organization'); units.value=d.units;version.value=d.version;
  permitted.value=Boolean(d.capabilities[mode==='basic'?(props.tab.recordId?'update':'create'):mode]);
  if(props.tab.recordId&&!current.value)throw Error('此組織單位已不存在');
  if(mode!=='basic' && permitted.value)people.value=(await api('organization-people')).people;
  let remote:any=null;
  if(current.value){
   if(mode==='members')remote=current.value.members.map((m:any)=>m.user_id).sort();
   else if(mode==='managers')remote=current.value.managers.map((m:any)=>({user_id:m.user_id,manager_role:m.manager_role,is_primary:m.is_primary}));
   else{remote={};for(const k of Object.keys(form.value))remote[k]=current.value[k]??(k==='parent_id'?null:'');}
  }
  if(preserve&&remote){const snapshot=JSON.stringify(remote);review.value=snapshot!==baseline;latest.value=remote;baseline=snapshot;props.tab.dirty=state()!==baseline;}
  else if(!preserve){if(remote){if(mode==='members')members.value=remote;else if(mode==='managers')managers.value=remote;else form.value=remote;}baseline=state();props.tab.dirty=false;review.value=false;latest.value=null;}
  conflict.value=false;
 }catch(e){error.value=(e as Error).message;conflict.value=true;}finally{loading.value=false;}
}
function toggleManager(person:any) {
 const index=managers.value.findIndex(m=>m.user_id===person.id);
 if(index>=0){const wasPrimary=managers.value[index].is_primary;managers.value.splice(index,1);if(wasPrimary&&managers.value.length)managers.value[0].is_primary=true;}
 else managers.value.push({user_id:person.id,manager_role:'manager',is_primary:managers.value.length===0});
}
function primary(id:string){for(const m of managers.value)m.is_primary=m.user_id===id;}
function answer(ok:boolean){confirm.value=false;resolveConfirm?.(ok);resolveConfirm=null;}
async function save():Promise<boolean>{
 if(!permitted.value||loading.value||props.tab.busy||conflict.value||review.value||confirm.value)return false;
 error.value='';
 if(mode==='basic'&&(!form.value.name.trim()||!/^[A-Za-z0-9_-]{2,30}$/.test(form.value.code))){error.value='請填寫名稱與 2–30 位英數字、底線或連字號代碼';return false;}
 if(mode==='managers'&&managers.value.length&&managers.value.filter(m=>m.is_primary).length!==1){error.value='請指定一位主要主管';return false;}
 if(mode!=='basic'||(current.value?.status==='active'&&form.value.status==='inactive')){if(!await new Promise<boolean>(r=>{resolveConfirm=r;confirm.value=true;}))return false;}
 props.tab.busy=true;
 const operation=mode==='basic'?(props.tab.recordId?'update':'create'):mode;
 const data=mode==='members'?{id:props.tab.recordId,user_ids:members.value}:mode==='managers'?{id:props.tab.recordId,assignments:managers.value}:{...form.value,id:props.tab.recordId};
 const key=JSON.stringify({operation,data});if(key!==pendingKey){pendingKey=key;requestId=crypto.randomUUID();}
 try{
  const r=await api('organization',{method:'POST',body:JSON.stringify({operation,data,requestId,expected:version.value})});
  work.organizationRevision++;props.tab.recordId=r.id;props.tab.title=`${mode==='members'?'成員':mode==='managers'?'主管':'組織'} · ${mode==='basic'?form.value.name:current.value?.name}`;baseline=state();props.tab.dirty=false;pendingKey='';requestId='';await load();
  message.value=error.value?'已儲存，請重新載入確認最新內容':'組織資料已儲存';if(error.value)conflict.value=true;return true;
 }catch(e){error.value=(e as Error).message;conflict.value=e instanceof ApiError&&e.status===409&&error.value.includes('其他操作');return false;}
 finally{props.tab.busy=false;}
}
props.tab.save=save;onMounted(()=>load());onBeforeUnmount(()=>{answer(false);delete props.tab.save;});
</script>
<template>
 <header class="page-heading"><div><p class="eyebrow">組織與門市 / 公司組織</p><h1>{{mode==='members'?'設定成員':mode==='managers'?'設定主管':tab.recordId?'編輯組織單位':'新增組織單位'}}</h1><p v-if="current">{{current.code}} · {{current.name}}</p></div><button :disabled="loading||tab.busy||confirm" @click="load(tab.dirty)">{{tab.dirty?'重新載入（保留草稿）':'重新載入'}}</button></header>
 <p v-if="error" role="alert" class="notice error">{{error}}</p><p v-if="message" role="status" class="notice">{{message}}</p><p v-if="loading" role="status">載入組織資料…</p><p v-if="!loading&&!permitted" class="notice">此操作目前無權限。</p>
 <section v-if="review" class="review" aria-label="核對最新組織資料"><h2>核對目前資料與草稿</h2><p>其他操作已更新此單位。請確認要保留的內容，再繼續儲存。</p><template v-if="mode==='basic'"><div v-for="key in differences" :key="key" class="difference"><h3>{{labels[key]}}</h3><div class="comparison"><div><strong>目前資料</strong><p>{{display(latest[key],key)}}</p></div><div><strong>你的草稿</strong><p>{{display(form[key],key)}}</p></div></div><button type="button" @click="useLatest(key)">採用目前的{{labels[key]}}</button></div><p v-if="!differences.length">草稿已與目前資料相同。</p></template><template v-else><div class="comparison"><div><h3>目前{{mode==='members'?'成員':'主管'}}</h3><p v-if="!latest.length">尚未指派</p><p v-for="entry in latest" :key="mode==='members'?entry:entry.user_id">{{personName(mode==='members'?entry:entry.user_id)}}<template v-if="mode==='managers'"> · {{managerRoles[entry.manager_role]}}{{entry.is_primary?'（主要）':''}}</template></p></div><div><h3>你的草稿</h3><p v-if="!(mode==='members'?members:managers).length">尚未指派</p><p v-for="entry in (mode==='members'?members:managers)" :key="typeof entry==='string'?entry:entry.user_id">{{personName(typeof entry==='string'?entry:entry.user_id)}}<template v-if="typeof entry!=='string'"> · {{managerRoles[entry.manager_role]}}{{entry.is_primary?'（主要）':''}}</template></p></div></div><button type="button" @click="useLatest()">採用目前全部指派</button></template><div class="dialog-actions"><button class="primary" :disabled="loading||tab.busy" @click="review=false">已核對，繼續編輯</button></div></section><form v-if="version" @submit.prevent="save"><fieldset :disabled="!permitted||loading||tab.busy||conflict||review||confirm">
  <div v-if="mode==='basic'" class="organization-form">
   <label>單位代碼<input v-model="form.code" required maxlength="30"></label><label>單位名稱<input v-model="form.name" required maxlength="200"></label>
   <label>簡稱<input v-model="form.short_name" maxlength="100"></label><label>類型<select aria-label="類型" v-model="form.type" :disabled="!!tab.recordId" @change="form.type==='company'&&(form.parent_id=null)"><option v-for="(label,key) in unitTypes" :value="key">{{label}}</option></select></label>
   <label>上層單位<select aria-label="上層單位" v-model="form.parent_id" :disabled="form.type==='company'"><option :value="null">無上層單位</option><option v-for="u in parentOptions" :value="u.id">{{u.code}} {{u.name}}{{u.status==='inactive'?'（停用）':''}}</option></select></label>
   <label>排序<input v-model.number="form.sort_order" type="number" min="0" max="1000000" required></label>
   <label>狀態<select aria-label="狀態" v-model="form.status"><option value="active">啟用</option><option value="inactive">停用</option></select></label><label class="wide">說明<textarea v-model="form.description" rows="4" maxlength="5000"/></label>
  </div>
  <template v-else>
   <section v-if="mode==='managers'" aria-label="已選主管"><h2>已選主管（{{managers.length}}）</h2><p v-if="!managers.length">尚未指派主管</p><div v-for="m in managers" :key="m.user_id" class="manager-row"><strong>{{personName(m.user_id)}}</strong><select v-model="m.manager_role" :aria-label="personName(m.user_id)+'角色'"><option v-for="(label,key) in managerRoles" :value="key">{{label}}</option></select><label class="check"><input type="radio" :name="tab.id+'primary'" :checked="m.is_primary" @change="primary(m.user_id)">主要主管</label><button type="button" @click="toggleManager({id:m.user_id})">移除</button></div></section>
   <section v-else><h2>已選成員（{{members.length}}）</h2><p v-if="!members.length">尚未選擇成員</p><div v-for="id in members" :key="id" class="selected-person"><span>{{personName(id)}}</span><button type="button" @click="members=members.filter(x=>x!==id)">移除</button></div></section>
   <label class="people-search">搜尋人員<input v-model="search" placeholder="姓名、員工代碼、職稱或 Email"></label>
   <p>{{filteredPeople.length}} 位符合搜尋</p><div class="people-list"><label v-for="p in filteredPeople" :key="p.id" class="check person"><input v-if="mode==='members'" type="checkbox" :value="p.id" v-model="members"><input v-else type="checkbox" :checked="managers.some(m=>m.user_id===p.id)" @change="toggleManager(p)"><span>{{p.employee_code}} {{p.full_name||p.email}}<small>{{p.job_title||'未設定職稱'}}</small></span></label></div><p v-if="!filteredPeople.length">找不到符合的人員</p>
  </template>
 </fieldset><div class="dialog-actions"><button v-if="permitted" class="primary" :disabled="loading||tab.busy||conflict||review||confirm||!tab.dirty">{{tab.busy?'儲存中…':'儲存組織資料'}}</button></div></form>
 <Modal v-if="confirm" title="確認組織異動" @cancel="answer(false)"><p>{{current?.name}}</p><p>{{mode==='members'?`將保留 ${members.length} 位成員，移除的人員會保留異動歷史。`:mode==='managers'?`將設定 ${managers.length} 位主管，原指派異動會保留歷史。`:'將停用此組織單位，既有成員及主管紀錄仍保留。'}}</p><div class="dialog-actions"><button @click="answer(false)">返回編輯</button><button class="primary" @click="answer(true)">確認儲存</button></div></Modal>
</template>
<style scoped>
.review{border-block:2px solid var(--primary);padding:16px 0;margin:24px 0}.difference{padding:16px 0;border-bottom:1px solid var(--line)}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}.comparison p{white-space:pre-wrap;overflow-wrap:anywhere}h3{font-size:16px}@media(max-width:650px){.comparison{grid-template-columns:1fr}}
fieldset{border:0;padding:0;min-width:0}.organization-form{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1000px}label{display:grid;gap:8px}.wide{grid-column:1/-1}input,select,textarea{width:100%;min-width:0}.check{display:flex;align-items:center}.check input{width:18px;height:18px;min-width:18px;min-height:18px}.people-list{max-height:420px;overflow:auto;border-block:1px solid var(--line)}.person{padding:12px;border-bottom:1px solid var(--line)}small{display:block;color:var(--muted)}.people-search{max-width:600px;margin-top:24px}.manager-row{display:grid;grid-template-columns:minmax(140px,1fr) 150px 130px auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}.selected-person{display:flex;justify-content:space-between;gap:12px;max-width:650px;padding:8px 0}h2{font-size:18px}@media(max-width:650px){.organization-form{grid-template-columns:1fr}.manager-row{grid-template-columns:1fr 1fr}}
</style>
