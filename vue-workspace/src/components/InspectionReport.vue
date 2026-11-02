<script setup lang="ts">
import InspectionContent from './InspectionContent.vue';
defineProps<{data:any}>();
</script>
<template><article class="inspection-report"><h1>門市巡店檢核報告</h1><InspectionContent :data="data" print-mode /><footer>富康菁英業務管理 · 門市巡店檢核報告 · {{data.record.inspection_no}}</footer></article></template>
