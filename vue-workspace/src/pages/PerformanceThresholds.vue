<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import {api} from '../api';import {notifyThresholdsSaved} from '../performance-sync';import type {WorkTab} from '../stores';
const props=defineProps<{tab:WorkTab}>();
const form=ref(JSON.parse(JSON.stringify(props.tab.payload))),error=ref(''),message=ref('');let baseline=JSON.stringify(form.value);
watch(form,()=>{props.tab.dirty=JSON.stringify(form.value)!==baseline;message.value='';},{deep:true,flush:'sync'});
async function save(){props.tab.busy=true;error.value='';try{await api('performance-tools/thresholds',{method:'POST',body:JSON.stringify({store_id:props.tab.store,...Object.fromEntries(['monthly','quarterly'].map(p=>[p,form.value[p].map((r:any,i:number)=>({level:i+1,base_amount:r.baseAmount}))]))})});baseline=JSON.stringify(form.value);props.tab.dirty=false;message.value='獎金閾值已儲存，已開啟的年度頁會自動重新載入。';notifyThresholdsSaved(props.tab.store);return true;}catch(e){error.value=(e as Error).message;return false;}finally{props.tab.busy=false;}}
props.tab.save=save;onBeforeUnmount(()=>delete props.tab.save);
</script>
<template><header class="page-heading"><div><p class="eyebrow">業績 / 獎金閾值</p><h1>設定每人獎金閾值</h1><p>{{tab.title}}</p></div></header><p v-if="error" role="alert" class="notice error">{{error}}</p><p v-if="message" role="status" class="notice">{{message}}</p><form @submit.prevent="save"><fieldset :disabled="tab.busy"><div class="module-form-grid"><section v-for="p in (['monthly','quarterly'] as const)"><h2>{{p==='monthly'?'月':'季'}}獎金金額</h2><label v-for="(row,i) in form[p]">{{p==='monthly'?'月':'季'}}第 {{Number(i)+1}} 檻（元／人）<input type="number" min="0" max="2147483647" step="1" required v-model.number="row.baseAmount"></label></section></div></fieldset><button class="primary" :disabled="tab.busy||!tab.dirty">儲存閾值</button></form></template>
