<script setup lang="ts">
import WorkOrderBoard from "../components/ga/WorkOrderBoard.vue";
import { useGaGuard } from "../lib/ga";
import type { WorkTab } from "../stores";

// G19 跨部門「總務組」維修頁（最小移植，Q19、W6）：用和工單中心同一套工單元件；新增舊式回報（標題、說明、最多 5 張照片）、
// 展開看進度與更新、刪除、改分類、維修分類管理，回報人在「待門市確認」時可按「確認完成」或「仍有問題」。不增欄位、不加新功能。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">跨部門管理</p>
      <h1>總務組維修</h1>
      <p class="muted">回報維修問題給總務組，並追蹤處理進度。處理完成後請在這裡確認問題是否解決。</p>
    </div>
  </header>
  <WorkOrderBoard v-if="allowed" :tab="tab" variant="cross" />
</template>
