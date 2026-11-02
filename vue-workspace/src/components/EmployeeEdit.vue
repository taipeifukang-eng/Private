<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api';
import type { WorkTab } from '../stores';
const props=defineProps<{employee:any;tab:WorkTab}>(),emit=defineEmits<{close:[];saved:[]}>();
const loading=ref(true),error=ref(''),discard=ref(false),ready=ref(false),detail=ref<any>(null);
const form=ref({employee_code:props.employee.employee_code,employee_name:'',current_position:'',start_date:'',birthday:''});
let baseline='',alive=true,requestId='',requestKey='';
const dirty=computed(()=>ready.value&&JSON.stringify(form.value)!==baseline);
const positions=computed(()=>Array.from(new Set<string>([...(detail.value?.positions||[]),detail.value?.employee.current_position].filter(Boolean))));
watch(dirty,value=>props.tab.dirty=value,{flush:'sync'});
async function load(){loading.value=true;error.value='';try{const d=await api('employees/edit?employee='+encodeURIComponent(props.employee.employee_code));if(!alive)return;detail.value=d;form.value={employee_code:d.employee.employee_code,employee_name:d.employee.employee_name,current_position:d.employee.current_position||'',start_date:d.employee.start_date||'',birthday:d.employee.birthday||''};baseline=JSON.stringify(form.value);ready.value=true;}catch(e){if(alive)error.value=(e as Error).message;}finally{if(alive)loading.value=false;}}
function close(){if(props.tab.busy)return;if(dirty.value){discard.value=true;return;}emit('close');}
async function save():Promise<boolean>{if(!ready.value||props.tab.busy)return false;if(!dirty.value){emit('close');return true;}error.value='';if(!form.value.employee_name.trim()){error.value='請填寫姓名';return false;}props.tab.busy=true;const key=JSON.stringify(form.value);if(requestKey!==key){requestKey=key;requestId=crypto.randomUUID();}try{await api('employees/edit',{method:'PUT',body:JSON.stringify({data:form.value,expected:detail.value.expected,requestId})});baseline=JSON.stringify(form.value);props.tab.dirty=false;emit('saved');return true;}catch(e){error.value=(e as Error).message;return false;}finally{props.tab.busy=false;}}
props.tab.save=save;props.tab.discard=async()=>{emit('close');};
onMounted(load);onBeforeUnmount(()=>{alive=false;props.tab.dirty=false;delete props.tab.save;delete props.tab.discard;});
</script>
<template>
 <Modal title="編輯員工" :busy="tab.busy" @cancel="close">
  <p>{{employee.employee_code}} · {{employee.employee_name}}</p>
  <p v-if="loading" role="status">載入員工資料…</p><p v-if="error" class="notice error" role="alert">{{error}}</p>
  <button v-if="!loading&&!ready" @click="load">重新載入</button>
  <form v-if="ready" @submit.prevent="save">
   <fieldset :disabled="tab.busy"><div class="fields">
    <label>員編<input :value="form.employee_code" readonly /></label>
    <label>姓名<input v-model="form.employee_name" required maxlength="100" /></label>
    <label>當前職位<select v-model="form.current_position"><option value="">未指定</option><option v-for="p in positions" :key="p">{{p}}</option></select></label>
    <label>到職日<input type="date" v-model="form.start_date" min="1900-01-01" max="9999-12-31" /></label>
    <label>生日<input type="date" v-model="form.birthday" min="1900-01-01" /></label>
   </div></fieldset>
   <p class="notice">姓名與有填寫的職位將同步更新此員工歷年月資料（{{detail.monthlyCount}} 筆，包含已送審／已確認資料）。到職日與生日更新員工主檔；員編不可修改。</p>
   <div class="dialog-actions"><button type="button" :disabled="tab.busy" @click="close">取消</button><button class="primary" :disabled="tab.busy||!dirty">{{tab.busy?'儲存中…':'儲存變更'}}</button></div>
  </form>
  <div v-else class="dialog-actions"><button @click="close">關閉</button></div>
 </Modal>
 <Modal v-if="discard" title="放棄尚未儲存的員工資料？" @cancel="discard=false"><p>關閉將放棄本次修改。</p><div class="dialog-actions"><button @click="discard=false">繼續編輯</button><button @click="emit('close')">放棄並關閉</button></div></Modal>
</template>
<style scoped>fieldset{border:0;padding:0;margin:20px 0;min-width:0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.fields label{display:grid;gap:8px}.fields input,.fields select{width:100%;min-width:0}.notice{line-height:1.8}@media(max-width:600px){.fields{grid-template-columns:1fr}}</style>
