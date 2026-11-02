<script setup lang="ts">
import {computed,reactive,ref,watch,onBeforeUnmount} from 'vue';
import {useSession,type WorkTab} from '../stores';
import MovementDraft from './MovementDraft.vue';
import MovementHistory from './MovementHistory.vue';
import Transfers from './Transfers.vue';
const props=defineProps<{tab:WorkTab}>(),session=useSession();
type Section='batch'|'history'|'transfers';
const options=computed(()=>[
 {key:'batch' as Section,label:'批次輸入異動',allowed:session.data?.capabilities.movementDraft},
 {key:'history' as Section,label:'查看歷史紀錄',allowed:session.data?.capabilities.movementHistory},
 {key:'transfers' as Section,label:'調店登記確認',allowed:session.data?.capabilities.transfers},
].filter(x=>x.allowed));
const active=ref<Section>(options.value[0]?.key||'batch'),visited=reactive(new Set<Section>([active.value]));
const child=(kind:WorkTab['kind'],suffix:string):WorkTab=>({...props.tab,id:props.tab.id+'-'+suffix,kind,dirty:false,busy:false,save:undefined,discard:undefined,submitOnly:undefined});
const draft=reactive(child('movement-draft','batch')),history=reactive(child('movement-history','history')),transfers=reactive(child('transfers','transfers'));
watch(()=>[draft.dirty,transfers.dirty,draft.busy,transfers.busy],()=>{props.tab.dirty=draft.dirty||transfers.dirty;props.tab.busy=draft.busy||transfers.busy;props.tab.submitOnly=props.tab.dirty;},{flush:'sync'});
const historyView=ref<InstanceType<typeof MovementHistory>|null>(null);
function select(key:Section){if(props.tab.busy)return;active.value=key;visited.add(key);if(key==='history')void historyView.value?.refresh();}
watch(options,list=>{if(!list.some(x=>x.key===active.value)&&list.length)select(list[0].key);});
onBeforeUnmount(()=>{delete props.tab.submitOnly;});
</script>
<template>
 <header class="page-heading"><div><p class="eyebrow">組織與門市</p><h1>人員異動管理</h1></div></header>
 <nav class="movement-sections" aria-label="人員異動功能"><button v-for="o in options" :key="o.key" :aria-pressed="active===o.key" :disabled="tab.busy" @click="select(o.key)">{{o.label}}<span v-if="o.key==='batch'&&draft.dirty || o.key==='transfers'&&transfers.dirty"> · 未儲存</span></button></nav>
 <p v-if="!options.length" class="notice">目前沒有可操作的人員異動功能。</p>
 <section v-if="visited.has('batch')&&session.data?.capabilities.movementDraft" v-show="active==='batch'" aria-label="批次輸入異動"><MovementDraft :tab="draft" embedded /></section>
 <section v-if="visited.has('history')&&session.data?.capabilities.movementHistory" v-show="active==='history'" aria-label="查看歷史紀錄"><MovementHistory ref="historyView" :tab="history" embedded /></section>
 <section v-if="visited.has('transfers')&&session.data?.capabilities.transfers" v-show="active==='transfers'" aria-label="調店登記確認"><Transfers :tab="transfers" embedded /></section>
</template>
<style scoped>.movement-sections{display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:22px}.movement-sections button[aria-pressed=true]{background:var(--primary);color:var(--primary-text,#fff)}.movement-sections span{font-size:12px}@media(max-width:600px){.movement-sections{display:grid;grid-template-columns:1fr}.movement-sections button{text-align:left}}</style>
