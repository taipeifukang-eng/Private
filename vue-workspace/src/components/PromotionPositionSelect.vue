<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {splitPromotionPositions,isHeadquartersPosition} from '../../../lib/workspace/position-rank';
// H.6：升職職位下拉。預設只列門市職等與兼職職位；總部職位收在「顯示總部職位」之後（仍可選）。已選的是總部職位時自動展開。
const props=defineProps<{modelValue:string;positions:readonly string[];title:string;placeholder?:string}>(),emit=defineEmits<{'update:modelValue':[value:string];change:[value:string]}>();
const showHq=ref(isHeadquartersPosition(props.modelValue));
watch(()=>props.modelValue,v=>{if(isHeadquartersPosition(v))showHq.value=true;});
const groups=computed(()=>splitPromotionPositions(props.positions||[]));
function pick(event:Event){const value=(event.target as HTMLSelectElement).value;emit('update:modelValue',value);emit('change',value);}
</script>
<template><div class="position-field"><label>{{title}}<select :aria-label="title" :value="modelValue" @change="pick"><option v-if="placeholder!==undefined" value="">{{placeholder}}</option><option v-for="p in groups.store" :key="p" :value="p">{{p}}</option><optgroup v-if="showHq&&groups.headquarters.length" label="總部職位"><option v-for="p in groups.headquarters" :key="p" :value="p">{{p}}</option></optgroup></select></label><label class="hq-toggle"><input type="checkbox" v-model="showHq" :disabled="isHeadquartersPosition(modelValue)" aria-label="顯示總部職位"> 顯示總部職位</label></div></template>
<style scoped>.position-field{display:grid;gap:6px}.position-field label{display:grid;gap:8px}.hq-toggle{display:flex!important;grid-auto-flow:column;align-items:center;justify-content:start;gap:6px!important;font-size:13px;color:var(--muted)}.hq-toggle input{width:auto}</style>
