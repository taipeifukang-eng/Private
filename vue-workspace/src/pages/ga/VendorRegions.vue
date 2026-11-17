<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import ServiceTreeAdmin from "../../components/ga/ServiceTreeAdmin.vue";
import { useGaGuard } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G20 服務區域：縣市與行政區固定資料由系統預先放入，總務可改名、排序、停用與新增；代碼建立後鎖定，不能刪除。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const canManage = ref(false);
onMounted(async () => {
  if (!allowed.value) return;
  try {
    canManage.value = !!(await api<{ permissions: { manage: boolean } }>("general-affairs/service-regions?pageSize=1")).permissions.manage;
  } catch {
    canManage.value = false;
  }
});
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 合作廠商</p>
      <h1>服務區域</h1>
      <p class="muted">廠商可服務的區域（大區、縣市、行政區）。代碼建立後不能修改；區域不能刪除，停用後既有廠商仍顯示名稱。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '合作廠商', '服務區域']">
    <ServiceTreeAdmin v-if="allowed" kind="region" :can-manage="canManage" />
  </GaShell>
</template>
