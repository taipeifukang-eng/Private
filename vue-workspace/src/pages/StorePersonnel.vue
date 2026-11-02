<script setup lang="ts">
import {ref,computed,onMounted} from 'vue';
import {api} from '../api';
import {useWorkspace,type WorkTab} from '../stores';
const props=defineProps<{tab:WorkTab}>(),work=useWorkspace(),data=ref<any>(null),query=ref(''),error=ref(''),loading=ref(false);
const historyMode=computed(()=>props.tab.kind==='store-personnel-history');
const rows=computed(()=>(data.value?.employees||[]).filter((r:any)=>[r.employee_code,r.employee_name,r.current_position||r.position].join(' ').toLowerCase().includes(query.value.trim().toLowerCase())));
async function load(){loading.value=true;error.value='';data.value=null;try{data.value=await api('store-personnel?'+new URLSearchParams({store:props.tab.store,...(historyMode.value?{employee:props.tab.recordId!}:{})}));props.tab.title=historyMode.value?'員工歷程 · '+data.value.employee.employee_name:'門市員工主檔 · '+data.value.store.store_name;}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
function history(employee:any){work.open('store-personnel-history',props.tab.store,employee.id);}
onMounted(load);
</script>
<template>
<header class="page-heading"><div><p class="eyebrow">組織與門市 / 門市員工主檔</p><h1>{{historyMode?'員工升遷／異動歷程':'門市員工主檔'}}</h1><p v-if="data" class="muted">{{data.store.store_code}} {{data.store.store_name}}</p></div><button @click="load" :disabled="loading">重新整理</button></header>
<p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="loading" role="status">載入員工資料…</p>
<template v-else-if="data">
<template v-if="historyMode"><h2>{{data.employee.employee_code}} · {{data.employee.employee_name}}</h2><p>目前職位：{{data.employee.current_position||data.employee.position||'未提供'}}</p><p v-if="!data.history.length" class="notice">此門市尚無可查看的員工異動紀錄。</p><ol v-else class="movement-history"><li v-for="record in data.history" :key="record.id"><time>{{record.movement_date||'未提供日期'}}</time><p><span v-if="record.old_value">{{record.old_label}} → </span><strong>{{record.new_label}}</strong></p><p v-if="record.display_notes" class="movement-notes">{{record.display_notes}}</p></li></ol></template>
<template v-else><label class="personnel-search">搜尋員工<input v-model="query" placeholder="員編、姓名或職位"></label><p class="muted">{{rows.length}} 人；員工主檔包含離職人員，與每月人員名單分開查閱。</p><div class="module-table"><table><thead><tr><th>員編</th><th>姓名</th><th>目前職位</th><th>到職日期</th><th>最後升遷日期</th><th>操作</th></tr></thead><tbody><tr v-for="r in rows" :key="r.id"><td>{{r.employee_code||'—'}}</td><td>{{r.employee_name||'—'}}</td><td>{{r.current_position||r.position||'—'}}</td><td>{{r.start_date||'—'}}</td><td>{{r.last_promotion_date||'—'}}</td><td><button @click="history(r)">升遷／異動歷程</button></td></tr><tr v-if="!rows.length"><td colspan="6">{{query?'沒有符合搜尋條件的員工':'此門市尚無可查看的員工主檔'}}</td></tr></tbody></table></div></template>
</template>
</template>
<style scoped>.personnel-search{display:grid;gap:8px;max-width:360px}.movement-history{list-style:none;padding:0;max-width:900px}.movement-history li{padding:20px 0;border-top:1px solid var(--line)}time{color:var(--muted);font-size:13px}.movement-notes{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.module-table td{white-space:normal;overflow-wrap:anywhere}@media(max-width:650px){.module-table table{min-width:640px}.movement-history{margin-top:24px}}</style>
