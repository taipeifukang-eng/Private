<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PoDetailDialog from "../../components/ga/PoDetailDialog.vue";
import { useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { dateText, money, type PoListRow } from "../../lib/ga-purchase";
import type { WorkTab } from "../../stores";

// G25 待簽核採購單（只有持「採購核准」權限的人看得到）：列出待核准的採購單，核准或駁回（駁回須填原因，退回草稿修改後可再送）。
// 核准人不可核准自己開的單，也不可核准自己最後送簽的單（詳情會說明）；管理員身分不會繞過。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const rows = ref<PoListRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const latest = useLatest();
const detailId = ref("");
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: PoListRow[]; total: number }>("general-affairs/purchase-orders/approvals?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch(debounced, () => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
useRefreshOnActivate(props.tab, load);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>待簽核採購單</h1>
      <p class="muted">含稅總額超過核准門檻的採購單，送核准後會出現在這裡。核准後開單人才能下訂；駁回要填原因，採購單會退回草稿。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '待簽核採購單']">
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="單號、供應商、品名" data-testid="ap-search" /></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="ap-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="ap-total">待簽核 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="ap-list" aria-label="待簽核清單">
      <li v-for="r in rows" :key="r.id" class="ap-card" data-testid="ap-card">
        <div class="card-head"><strong data-testid="ap-no">{{ r.po_no }}</strong><span class="amount" data-testid="ap-amount">{{ money(r.total_amount) }}</span></div>
        <p class="card-line">{{ r.vendor_name || "（尚未選供應商）" }}　{{ r.first_item_name }}<template v-if="r.item_count > 1">等 {{ r.item_count }} 項</template></p>
        <p class="card-line muted">開單 {{ r.created_by_name }} {{ fmtTime(r.created_at) }}<template v-if="r.expected_delivery_date">　預計到貨 {{ dateText(r.expected_delivery_date) }}</template></p>
        <button type="button" class="primary" data-testid="open-approve" @click="detailId = r.id">查看並簽核</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty" data-testid="ap-empty">{{ error ? "資料載入失敗" : loaded ? "目前沒有待簽核的採購單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <PoDetailDialog v-if="detailId" :id="detailId" @close="detailId = ''" @changed="load" />
  </GaShell>
</template>

<style scoped>
.ap-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.ap-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.amount { font-weight: 700; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
@media (max-width: 700px) {
  .ap-card button { min-height: 44px; }
  .ap-list { grid-template-columns: minmax(0, 1fr); }
}
</style>
