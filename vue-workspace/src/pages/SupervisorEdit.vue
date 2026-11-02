<script setup lang="ts">
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue';
import {api,ApiError} from '../api';import type {WorkTab} from '../stores';import Modal from '../components/Modal.vue';
const props=defineProps<{tab:WorkTab;embedded?:boolean}>();
const emit=defineEmits<{saved:[];close:[]}>();
const role=props.tab.payload?.roleType==='store_manager'?'store_manager':'supervisor';
const data=ref<any>(null),selected=ref<string[]>([]),baseline=ref<string[]>([]),expected=ref<string[]>([]),choices=ref<Record<string,string>>({}),query=ref(''),error=ref(''),message=ref(''),loading=ref(false),conflict=ref(false),confirm=ref<string[]|null>(null);
const pending=ref<{id:string;action:'add'|'remove'|'change'}|null>(null),picked=ref('');
let resolveConfirm:((ok:boolean)=>void)|null=null;
const user=computed(()=>data.value?.users.find((u:any)=>u.id===props.tab.recordId)||data.value?.assignments.find((a:any)=>a.user_id===props.tab.recordId)?.user);
const isSupervisor=computed(()=>role==='supervisor'&&user.value?.job_title?.includes('督導'));
const title=computed(()=>role==='store_manager'?'兼任店長門市':isSupervisor.value?'督導管理門市':'經理／管理職門市');
const eligible=computed(()=>data.value?.users.some((u:any)=>u.id===props.tab.recordId));
const canEdit=computed(()=>role==='supervisor'?data.value?.canSupervisor:data.value?.canManager);
const locked=computed(()=>!canEdit.value||props.tab.busy||loading.value||conflict.value||!!confirm.value||!!pending.value);
const stores=computed(()=>(data.value?.stores||[]).filter((s:any)=>s.eligible||baseline.value.includes(s.id)).filter((s:any)=>(s.store_code+' '+s.store_name).toLowerCase().includes(query.value.trim().toLowerCase())).sort((a:any,b:any)=>a.store_code.localeCompare(b.store_code,'zh-Hant',{numeric:true})));
const label=(id:string)=>{const s=data.value?.stores.find((s:any)=>s.id===id);return s?s.store_code+' '+s.store_name:id;};
const supervisors=(id:string)=>(data.value?.assignments||[]).filter((a:any)=>a.store_id===id&&a.role_type==='supervisor'&&a.user?.job_title?.includes('督導'));
const others=(id:string)=>supervisors(id).filter((a:any)=>a.user_id!==props.tab.recordId);
const originalPrimary=(id:string)=>supervisors(id).find((a:any)=>a.is_primary)?.user_id;
const name=(id:string)=>data.value?.users.find((u:any)=>u.id===id)?.full_name||data.value?.assignments.find((a:any)=>a.user_id===id)?.user?.full_name||'未命名';
const primary=(id:string)=>choices.value[id]||originalPrimary(id)||(selected.value.includes(id)&&!baseline.value.includes(id)&&!others(id).length?props.tab.recordId:'');
const roleLabel=(id:string)=>role==='store_manager'?'兼任店長':!isSupervisor.value?'管理門市':!primary(id)?'督導（尚未指定主責）':primary(id)===props.tab.recordId?'主責督導':'代理督導';
const needsChoice=computed(()=>!isSupervisor.value?[]:[...new Set([...selected.value,...baseline.value])].filter(id=>{
 const remaining=[...others(id).map((a:any)=>a.user_id),...(selected.value.includes(id)?[props.tab.recordId]:[])];
 if(!remaining.length)return false;
 if(choices.value[id])return !remaining.includes(choices.value[id]);
 return (!baseline.value.includes(id)&&selected.value.includes(id)&&others(id).length>0)||(originalPrimary(id)===props.tab.recordId&&!selected.value.includes(id))||(!originalPrimary(id)&&(remaining.length>1||baseline.value.includes(id)&&selected.value.includes(id)));
}));
const candidates=computed(()=>!pending.value?[]:[...others(pending.value.id).map((a:any)=>a.user),...(pending.value.action==='add'||(pending.value.action==='change'&&selected.value.includes(pending.value.id))?[user.value]:[])]);
const key=(ids:string[])=>[...ids].sort().join(',');
function dirty(){props.tab.dirty=key(selected.value)!==key(baseline.value)||Object.keys(choices.value).some(id=>choices.value[id]!==originalPrimary(id));}
watch([selected,choices],()=>{dirty();message.value='';},{deep:true,flush:'sync'});
async function load(preserve=false){loading.value=true;error.value='';try{
 data.value=await api('supervisors');const rows=data.value.assignments.filter((a:any)=>a.user_id===props.tab.recordId&&a.role_type===role);
 baseline.value=rows.map((a:any)=>a.store_id);expected.value=data.value.assignments.map((a:any)=>[a.id,a.user_id,a.store_id,a.role_type,String(a.is_primary)].join(':')).sort();
 if(!preserve){selected.value=[...baseline.value];choices.value={};}else{const touched=new Set([...baseline.value,...selected.value]);choices.value=Object.fromEntries(Object.entries(choices.value).filter(([id])=>touched.has(id)));}
 dirty();conflict.value=false;
}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
function choose(id:string,action:'add'|'remove'|'change'){pending.value={id,action};picked.value='';}
function remove(id:string){if(isSupervisor.value&&primary(id)===props.tab.recordId&&others(id).length){choose(id,'remove');return;}selected.value=selected.value.filter(s=>s!==id);delete choices.value[id];}
function toggle(id:string,event:Event){if(!(event.target as HTMLInputElement).checked)remove(id);else if(isSupervisor.value&&others(id).length)choose(id,'add');else selected.value=[...new Set([...selected.value,id])];(event.target as HTMLInputElement).checked=selected.value.includes(id);}
function acceptChoice(){if(!pending.value||!candidates.value.some((u:any)=>u.id===picked.value))return;const {id,action}=pending.value;
 if(action==='add')selected.value=[...new Set([...selected.value,id])];if(action==='remove')selected.value=selected.value.filter(s=>s!==id);
 choices.value={...choices.value,[id]:picked.value};pending.value=null;
}
function answer(ok:boolean){confirm.value=null;resolveConfirm?.(ok);resolveConfirm=null;}
async function save(){if(locked.value||!data.value)return false;if(!props.tab.dirty)return true;
 if(needsChoice.value.length){error.value='請先指定待確認門市的主責督導。';return false;}
 const removed=baseline.value.filter(id=>!selected.value.includes(id));if(removed.length){const ok=await new Promise<boolean>(resolve=>{resolveConfirm=resolve;confirm.value=removed;});if(!ok)return false;}
 props.tab.busy=true;error.value='';try{
 await api('supervisors',{method:'PUT',body:JSON.stringify({userId:props.tab.recordId,roleType:role,storeIds:selected.value,primaryAssignments:Object.entries(choices.value).map(([storeId,userId])=>({storeId,userId})),expected:expected.value})});
 baseline.value=[...selected.value];choices.value={};props.tab.dirty=false;await load();
 if(error.value){message.value='指派已儲存，但最新資料讀取失敗，請重新載入。';conflict.value=true;}else message.value='管理門市指派已儲存';emit('saved');return true;
 }catch(e){error.value=(e as Error).message;conflict.value=e instanceof ApiError&&e.status===409;return false;}finally{props.tab.busy=false;}
}
props.tab.save=save;onBeforeUnmount(()=>{answer(false);delete props.tab.save;});onMounted(()=>load());
</script>
<template>
<header class="page-heading"><div><h1 v-if="!embedded">{{user?.full_name||'人員'}} · {{title}}</h1><p class="muted">{{user?.employee_code}} · {{user?.job_title}} · {{title}}</p></div><button :disabled="tab.busy||loading||!!confirm||!!pending" @click="load(tab.dirty)">{{tab.dirty?'重新載入（保留選擇）':'重新載入'}}</button></header>
<p v-if="error" role="alert" class="notice error">{{error}}</p><p v-if="message" role="status" class="notice">{{message}}</p><p v-if="conflict" class="notice">目前選擇已保留。請重新載入後核對各店的主責與代理，再儲存。</p><p v-if="loading" role="status">載入管理門市…</p>
<template v-else-if="data">
<p v-if="!canEdit" role="alert" class="notice error">沒有此角色的指派權限。</p><p v-if="!eligible" class="notice">此人員目前僅可解除既有指派。</p>
<p>已選 {{selected.length}} 間門市</p><label class="store-search">搜尋門市<input v-model="query" placeholder="門市代號或名稱"></label>
<fieldset :disabled="locked"><legend>{{title}}（可複選）</legend>
<div v-for="s in stores" :key="s.id" class="store-choice"><label><input type="checkbox" :checked="selected.includes(s.id)" @change="toggle(s.id,$event)" :disabled="(!eligible||!s.eligible)&&!baseline.includes(s.id)"><span>{{s.store_code}} {{s.store_name}}<small v-if="!s.eligible">停用／總部，僅可保留或解除既有指派</small><small v-if="supervisors(s.id).length">目前主責：{{originalPrimary(s.id)?name(originalPrimary(s.id)):'尚未指定'}}</small><strong v-if="selected.includes(s.id)">{{roleLabel(s.id)}}</strong></span></label>
<button v-if="isSupervisor&&selected.includes(s.id)&&others(s.id).length" @click="choose(s.id,'change')">變更主責</button></div>
<p v-if="!stores.length" class="muted">沒有符合條件的門市</p></fieldset>
<section v-if="needsChoice.length" class="notice"><h2>尚待指定主責</h2><div v-for="id in needsChoice" :key="id">{{label(id)}} <button :disabled="locked" @click="choose(id,'change')">指定主責督導</button></div></section>
<section v-if="Object.keys(choices).length" class="changes"><h2>儲存後的主責督導</h2><p v-for="(uid,id) in choices" :key="id">{{label(String(id))}}：{{name(uid)}}<small>其餘已選督導為代理；經理的管理門市不變。</small></p></section>
<button :disabled="locked||!selected.length" @click="selected=[];choices={}">解除全部指派</button>
</template>
<div class="dialog-actions"><button v-if="embedded" :disabled="tab.busy||!!confirm||!!pending" @click="emit('close')">關閉</button><button class="primary" :disabled="locked||!data||!tab.dirty||!!needsChoice.length" @click="save">{{tab.busy?'儲存中…':'儲存指派'}}</button></div>
<Modal v-if="pending" :title="pending.action==='remove'?'指定接任主責督導':'誰是主責督導？'" @cancel="pending=null"><p>{{label(pending.id)}}</p><p>請選擇一位主責，其餘督導為代理。儲存指派後才會生效。</p><fieldset class="primary-options"><legend>主責督導</legend><label v-for="u in candidates" :key="u.id"><input type="radio" v-model="picked" :value="u.id" name="primary-supervisor">{{u.full_name||u.employee_code||'未命名'}} · {{u.employee_code}}<small v-if="originalPrimary(pending.id)===u.id">目前主責</small></label></fieldset><div class="dialog-actions"><button @click="pending=null">取消</button><button class="primary" :disabled="!picked" @click="acceptChoice">確認主責</button></div></Modal>
<Modal v-if="confirm" title="確認解除管理門市" @cancel="answer(false)"><p>將解除 {{user?.full_name||'此人員'}} 的以下指派：</p><ul><li v-for="id in confirm" :key="id">{{label(id)}}<small v-if="isSupervisor">{{others(id).length?'儲存後主責：'+name(primary(id)||others(id)[0].user_id):'解除後此店沒有督導指派'}}</small></li></ul><div class="dialog-actions"><button @click="answer(false)">返回編輯</button><button class="danger" @click="answer(true)">確認儲存指派</button></div></Modal>
</template>
<style scoped>
.page-heading{gap:12px;margin-bottom:12px}.store-search{display:grid;gap:8px}fieldset{margin:20px 0;padding:12px;border:1px solid var(--line);max-height:38dvh;overflow:auto}.store-choice{padding:12px 0;border-bottom:1px solid var(--line)}.store-choice label,.primary-options label{display:flex;align-items:center;gap:12px}.store-choice input,.primary-options input{width:18px;height:18px;min-width:18px;min-height:18px}.store-choice button{margin:8px 0 0 30px}.store-choice strong,small{display:block;margin-top:4px}.store-choice strong{color:var(--primary)}small{color:var(--muted);line-height:1.6}.primary-options label{padding:12px 0;flex-wrap:wrap}h2{font-size:16px}.changes p{padding-bottom:8px;border-bottom:1px solid var(--line)}.dialog-actions{position:sticky;bottom:-1px;background:var(--surface);padding:12px 0}
</style>
