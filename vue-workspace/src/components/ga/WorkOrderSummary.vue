<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import { openGaPage } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { useSession } from "../../stores";
import type { WoDetail } from "../../lib/ga-work-orders";

// G18 需求單詳情與「我的追蹤」的工單摘要：階段名、最新公開進度、結案方式、前往工單。
// 店長端看不到處理人與內部內容（伺服端已遮蔽）；沒有工單查看權限（例如只有需求單權限的人）時整塊不顯示，不影響需求單本身。
const props = defineProps<{ workOrderId: string }>();
const emit = defineEmits<{ goto: [] }>();
const session = useSession();
const data = ref<WoDetail | null>(null);
const canOpen = computed(() => !!session.data?.capabilities?.gaWorkOrders);
const lastPublic = computed(() => [...(data.value?.timeline || [])].reverse().find((t) => t.visibility === "PUBLIC" && t.text));

onMounted(async () => {
  try { data.value = (await api<{ data: WoDetail }>(`general-affairs/work-orders/${props.workOrderId}`)).data; } catch { data.value = null; }
});
function go() { openGaPage("ga-work-orders", undefined, { workOrderId: props.workOrderId }); emit("goto"); }
</script>

<template>
  <section v-if="data" class="wos" data-testid="wo-summary">
    <h3>維修工單</h3>
    <p class="wos-line">
      <strong data-testid="wos-no">{{ data.work_order.wo_no }}</strong>
      <span class="wos-st" data-testid="wos-stage">{{ data.work_order.stage_label || data.work_order.status_label }}</span>
      <span v-if="data.work_order.completion_method_label" class="wos-st done" data-testid="wos-completion">結案方式：{{ data.work_order.completion_method_label }}</span>
    </p>
    <p v-if="lastPublic" class="wos-progress" data-testid="wos-progress">{{ lastPublic.text }}<span class="muted">　{{ fmtTime(lastPublic.at) }}</span></p>
    <p v-else class="muted">工單還沒有公開進度。</p>
    <button v-if="canOpen" type="button" data-testid="wos-goto" @click="go">前往工單</button>
  </section>
</template>

<style scoped>
.wos { display: grid; gap: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.wos h3 { margin: 0; font-size: 15px; }
.wos-line { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wos-st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); }
.wos-st.done { background: #e4f4e6; color: #1f5f2b; border-color: #a9d3af; }
:root[data-theme="dark"] .wos-st.done { background: #1c3a22; color: #b6e3be; border-color: #2f5a39; }
.wos-progress { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.wos button { justify-self: start; }
</style>
