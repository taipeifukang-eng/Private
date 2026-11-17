<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import ServiceTreeAdmin from "../../components/ga/ServiceTreeAdmin.vue";
import { useGaGuard } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G20 服務分類：總務自行建立與維護（舊版預置分類不套）；代碼建立後鎖定，不能刪除，停用後仍顯示名稱。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const canManage = ref(false);
onMounted(async () => {
  if (!allowed.value) return;
  try {
    canManage.value = !!(await api<{ permissions: { manage: boolean } }>("general-affairs/service-categories?pageSize=1")).permissions.manage;
  } catch {
    canManage.value = false;
  }
});
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 合作廠商</p>
      <h1>服務分類</h1>
      <p class="muted">廠商可承作的服務項目分類。代碼建立後不能修改；分類不能刪除，不用的請改為停用（既有廠商仍會顯示名稱）。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '合作廠商', '服務分類']">
    <ServiceTreeAdmin v-if="allowed" kind="category" :can-manage="canManage" />
  </GaShell>
</template>
