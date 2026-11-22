<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import InventoryBalances from "../../components/ga/InventoryBalances.vue";
import InventoryHolding from "../../components/ga/InventoryHolding.vue";
import InventoryPostDialog from "../../components/ga/InventoryPostDialog.vue";
import InventoryTransactions from "../../components/ga/InventoryTransactions.vue";
import { useGaGuard, useRefreshOnActivate } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G12 庫存餘額、流水、過帳、持有狀態（Q12 至 Q14、C4 至 C7、C12）。庫存總覽與庫存流水是同一頁，用 payload.view 區分（balances／transactions／holding）。
// 過帳一律走伺服端同一套邏輯（固定識別防重複、負庫存檢查）；C6 風險確認在過帳視窗內。門市名單身分（店長、督導、區經理）唯讀，只看自己門市。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type View = "balances" | "transactions" | "holding";
type Access = { balances: boolean; transactions: boolean; holding: boolean; canPost: boolean; internal: boolean; postProblem: string };

const access = ref<Access | null>(null);
const accessError = ref("");
const posting = ref(false);
const refreshKey = ref(0);

const requested = computed<View>(() => {
  const v = (props.tab.payload as { view?: string } | undefined)?.view;
  return v === "transactions" || v === "holding" ? v : "balances";
});
const tabs = computed(() => {
  const a = access.value;
  if (!a) return [] as { id: View; label: string }[];
  return [
    ...(a.balances ? [{ id: "balances" as View, label: "餘額" }] : []),
    ...(a.transactions ? [{ id: "transactions" as View, label: "流水" }] : []),
    ...(a.holding ? [{ id: "holding" as View, label: "持有狀態" }] : []),
  ];
});
const view = computed<View>(() => (tabs.value.some((t) => t.id === requested.value) ? requested.value : tabs.value[0]?.id || "balances"));
function go(v: View) {
  props.tab.payload = { ...(props.tab.payload as object), view: v };
}

async function loadAccess() {
  if (!allowed.value) return;
  try {
    access.value = await api<Access>("general-affairs/inventory/access");
    accessError.value = "";
  } catch (e) {
    access.value = null;
    accessError.value = (e as Error).message;
  }
}
onMounted(loadAccess);
useRefreshOnActivate(props.tab, () => { void loadAccess(); refreshKey.value += 1; });

function onPosted() {
  refreshKey.value += 1;
}
const heading = computed(() => (view.value === "transactions" ? "庫存流水" : view.value === "holding" ? "庫存持有狀態" : "庫存餘額"));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 庫存管理</p>
      <h1>{{ heading }}</h1>
      <p class="muted">查看各位置每個料件的庫存、每一筆庫存異動，並進行入庫、出庫、調增、調減。這裡是「料件庫存」，不是門市盤點。</p>
    </div>
    <button v-if="access?.canPost" class="primary" type="button" data-testid="open-post" @click="posting = true">庫存過帳</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '庫存管理', heading]">
    <p v-if="accessError" class="notice error" role="alert" data-testid="access-error">{{ accessError }}</p>
    <template v-else-if="access">
      <p v-if="!access.canPost && !access.internal" class="notice" role="status" data-testid="readonly-note">您目前是唯讀檢視：只會看到自己門市的庫存，交易原因、備註與持有狀態的調整原因不顯示，也不能過帳。</p>
      <p v-else-if="!access.canPost" class="notice" role="status" data-testid="readonly-note">您目前只有查看權限，不能過帳。{{ access.postProblem }}</p>
      <nav class="sub-tabs" role="tablist" aria-label="庫存檢視">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="view === t.id" :class="{ on: view === t.id }" :data-testid="'tab-' + t.id" @click="go(t.id)">{{ t.label }}</button>
      </nav>
      <InventoryBalances v-if="view === 'balances'" :key="'b' + refreshKey" />
      <InventoryTransactions v-else-if="view === 'transactions'" :key="'t' + refreshKey" />
      <InventoryHolding v-else :key="'h' + refreshKey" />
    </template>
    <p v-else class="muted" role="status">載入中…</p>
    <InventoryPostDialog v-if="posting && access" :problem="access.postProblem" @close="posting = false" @posted="onPosted" />
  </GaShell>
</template>

<style scoped>
.sub-tabs { display: flex; gap: 8px; margin: 0 0 14px; flex-wrap: wrap; }
.sub-tabs button { min-height: 40px; padding: 6px 18px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); }
.sub-tabs button.on { border-color: var(--primary); background: var(--soft); font-weight: 700; color: var(--primary); }
</style>
