<script setup lang="ts">
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue';
import {api} from '../api';
import type {WorkTab} from '../stores';
import Modal from '../components/Modal.vue';
import {checkEmployeeId,isInternEmployeeId,employmentTypeForEmployeeId,normalizeEmployeeId,EMPLOYMENT_TYPE_BY_CODE_LABEL} from '../../../lib/workspace/employee-id-rule';
const props=defineProps<{tab:WorkTab}>();
const form=ref({employee_code:'',employee_name:'',current_position:'',start_date:'',birthday:'',});
const baseline=JSON.stringify(form.value),positions=ref<string[]>([]),loading=ref(true),allowed=ref(false),error=ref(''),done=ref(false),confirm=ref(false);
let requestId='',pendingKey='';
props.tab.submitOnly=true;
watch(form,()=>{if(!done.value)props.tab.dirty=JSON.stringify(form.value)!==baseline;},{deep:true,flush:'sync'});
async function load(){loading.value=true;error.value='';try{const d=await api('employees');positions.value=d.positions;allowed.value=d.capabilities.create;}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
const typeLabel=computed(()=>{const c=normalizeEmployeeId(form.value.employee_code);if(!c||isInternEmployeeId(c))return '';return employmentTypeForEmployeeId(c)==='part_time'?EMPLOYMENT_TYPE_BY_CODE_LABEL:'正職（依員編）';});
function review(){error.value='';const id=checkEmployeeId(form.value.employee_code);if(!id.ok){error.value=id.message;return;}if(!form.value.employee_name.trim()){error.value='請填寫姓名。';return;}confirm.value=true;}
async function save(){if(props.tab.busy||done.value||!allowed.value)return;confirm.value=false;props.tab.busy=true;error.value='';const data={...form.value,employee_code:form.value.employee_code.trim().toUpperCase(),employee_name:form.value.employee_name.trim()},key=JSON.stringify(data);if(key!==pendingKey){pendingKey=key;requestId=crypto.randomUUID();}try{await api('employees',{method:'POST',body:JSON.stringify({requestId,data})});form.value=data;done.value=true;props.tab.dirty=false;props.tab.title='員工已新增 · '+data.employee_name;}catch(e){error.value=(e as Error).message;}finally{props.tab.busy=false;}}
onMounted(load);onBeforeUnmount(()=>{delete props.tab.submitOnly;});
</script>
<template>
<header class="page-heading"><div><p class="eyebrow">組織與門市 / 員工管理</p><h1>新增員工</h1><p>建立員工基本資料。</p></div></header>
<p v-if="loading" role="status">正在載入…</p><p v-if="error" class="notice error" role="alert">{{error}}</p>
<button v-if="!loading&&!allowed" @click="load">重新載入權限</button><p v-if="!loading&&!allowed&&!error">目前沒有新增員工權限。</p>
<p v-if="done" class="notice" role="status">已新增 {{form.employee_code}} {{form.employee_name}}。可關閉此頁；新增其他員工請回到「員工管理」點選「新增員工」。</p>
<form v-if="allowed" @submit.prevent="review">
<fieldset :disabled="tab.busy||done||confirm"><div class="employee-fields">
<label>員編<input v-model="form.employee_code" required autocomplete="off" placeholder="FK1234／FKF12345／FKPT123"><small class="hint">格式：FK+4碼、FKF+5碼、FKPT+3碼數字</small><small v-if="typeLabel" class="hint" data-testid="employee-type">類型：{{typeLabel}}</small></label>
<label>姓名<input v-model="form.employee_name" required maxlength="100" autocomplete="off"></label>
<label :for="tab.id+'-position'">當前職位<select :id="tab.id+'-position'" aria-label="當前職位" v-model="form.current_position"><option value="">未指定</option><option v-for="p in positions" :key="p">{{p}}</option></select></label>
<label>到職日<input v-model="form.start_date" type="date" min="1900-01-01" max="9999-12-31"></label>
<label>生日<input v-model="form.birthday" type="date" min="1900-01-01"></label>
</div>
<div v-if="!done" class="dialog-actions"><button class="primary" type="submit">{{tab.busy?'正在新增…':'核對並新增'}}</button></div></fieldset></form>
<Modal v-if="confirm" title="確認新增員工" @cancel="confirm=false"><dl><dt>員編</dt><dd>{{form.employee_code.trim().toUpperCase()}}</dd><dt>類型</dt><dd>{{typeLabel}}</dd><dt>姓名</dt><dd>{{form.employee_name}}</dd><dt>當前職位</dt><dd>{{form.current_position||'未指定'}}</dd><dt>到職日</dt><dd>{{form.start_date||'未填寫'}}</dd><dt>生日</dt><dd>{{form.birthday||'未填寫'}}</dd></dl><div class="dialog-actions"><button @click="confirm=false">返回修改</button><button class="primary" @click="save">確認新增</button></div></Modal>
</template>
<style scoped>form{max-width:820px;margin-top:24px}fieldset{border:0;padding:0;margin:0;min-width:0}.employee-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}label{display:grid;gap:8px}input,select{width:100%;min-width:0}.hint{color:var(--muted)}dl{display:grid;grid-template-columns:100px 1fr;gap:12px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}@media(max-width:600px){.employee-fields{grid-template-columns:1fr}}</style>
