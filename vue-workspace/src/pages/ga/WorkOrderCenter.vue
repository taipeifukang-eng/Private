<script setup lang="ts">
import GaShell from "../../components/ga/GaShell.vue";
import WorkOrderBoard from "../../components/ga/WorkOrderBoard.vue";
import { useGaGuard } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G18 工單中心：維修工單列表、六張焦點卡、詳情與動作（更新進度、送門市確認、補資料、領用料件、強制結案、刪除、改分類、列印）。
// 狀態流轉與權限由資料庫函式強制，不合法回 409 與白話原因；內部內容與處理人只給總務端看。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>工單中心</h1>
      <p class="muted">門市的維修需求受理後會轉成工單，在這裡安排廠商、更新進度、領用料件，處理完成後送門市確認。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '工單中心']">
    <WorkOrderBoard v-if="allowed" :tab="tab" variant="center" />
  </GaShell>
</template>
