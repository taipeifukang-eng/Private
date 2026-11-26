<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PoDetailDialog from "../../components/ga/PoDetailDialog.vue";
import PoSettingsDialog from "../../components/ga/PoSettingsDialog.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { PO_STATUS_LABEL, dateText, money, num, type PoListRow } from "../../lib/ga-purchase";
import type { WorkTab } from "../../stores";

// G25 採購單：清單與統計卡（伺服端精確統計）、篩選（狀態、搜尋、我開的、逾期未到貨）、詳情（品項、時間軸、進貨與配發紀錄、核准與下訂與到貨與配發）。
// 供應商只能選已建好的；舊版沒有這個頁面。核准人才看得到「核准設定」。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Stats = Record<string, number>;
type Caps = { write: boolean; approve: boolean; vendorBilling: boolean; problem: string };
const rows = ref<PoListRow[]>([]);
const total = ref(0);
const stats = ref<Stats>({});
const caps = ref<Caps>({ write: false, approve: false, vendorBilling: false, problem: "" });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const mine = ref(false);
const overdue = ref(!!(props.tab.payload as { overdue?: unknown } | undefined)?.overdue);
// 從首頁或導覽徽章點進來：待核准（有核准權限才算）與逾期未到貨的聯集（與徽章同一組條件，V9）
const attention = ref(!!(props.tab.payload as { attention?: unknown } | undefined)?.attention);
// 第 4.5 批：從首頁「待請款採購單」點進來（驗入含稅額減有效請款累計大於尾差，與首頁數字同一個述詞）。
const payUnclaimed = ref(!!(props.tab.payload as { payUnclaimed?: unknown } | undefined)?.payUnclaimed);
// ga-improve-b1 G1：已預付（預付餘額大於 0，有請款檢視權限者才有結果）。
const prepaid = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const latest = useLatest();
const detailId = ref("");
const showSettings = ref(false);
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || mine.value || overdue.value || attention.value || payUnclaimed.value || prepaid.value));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (mine.value) q.set("mine", "true");
    if (overdue.value) q.set("overdue", "true");
    if (attention.value) q.set("attention", "1");
    if (payUnclaimed.value) q.set("payUnclaimed", "1");
    if (prepaid.value) q.set("prepaid", "1");
    const res = await api<{ data: PoListRow[]; total: number; stats: Stats; capabilities: Caps }>("general-affairs/purchase-orders?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    caps.value = res.capabilities;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, status, mine, overdue, attention, payUnclaimed, prepaid],() => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
useRefreshOnActivate(props.tab, load);

const cardDefs = [
  { id: "all", label: "全部" }, { id: "DRAFT", label: "草稿" }, { id: "PENDING_APPROVAL", label: "待核准" }, { id: "APPROVED", label: "已核准待下訂" }, { id: "ORDERED", label: "已下訂" },
  { id: "PARTIALLY_RECEIVED", label: "部分到貨" }, { id: "RECEIVED", label: "全部到貨" }, { id: "CLOSED", label: "已結案" }, { id: "CANCELED", label: "已取消" }, { id: "overdue", label: "逾期未到貨" }, { id: "mine", label: "我開的" },
];
const countOf = (id: string) => (id === "all" ? stats.value.total ?? 0 : stats.value[id] ?? 0);
const activeCard = computed(() => (overdue.value ? "overdue" : mine.value ? "mine" : status.value || "all"));
function pickCard(id: string) {
  const same = activeCard.value === id;
  status.value = "";
  overdue.value = false;
  mine.value = false;
  if (same || id === "all") return;
  if (id === "overdue") overdue.value = true;
  else if (id === "mine") mine.value = true;
  else status.value = id;
}
const newPo = () => openGaPage("ga-purchase-order-edit");
function closeDetail() { detailId.value = ""; }
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>採購單</h1>
      <p class="muted">一張採購單對一個供應商、可有多個品項。含稅總額超過核准門檻要先經採購核准人核准才能下訂；到貨登錄的同時驗入庫存；可再配發為門市設備。</p>
    </div>
    <div class="head-actions">
      <button v-if="caps.approve" type="button" data-testid="open-settings" @click="showSettings = true">核准設定</button>
      <button v-if="caps.write" type="button" class="primary" data-testid="new-po" @click="newPo">新增採購單</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '採購單']">
    <p v-if="loaded && caps.problem && !caps.write" class="notice" role="status" data-testid="po-problem">{{ caps.problem }}（您仍可查看採購單）</p>
    <ul class="stat-cards" aria-label="採購單統計">
      <li v-for="c in cardDefs" :key="c.id" :class="{ on: activeCard === c.id, alert: c.id === 'overdue' && countOf(c.id) > 0 }">
        <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ countOf(c.id) }}</strong></button>
      </li>
    </ul>
    <p v-if="attention" class="notice" role="status" data-testid="attention-chip">只顯示「待我處理」的項目，筆數與導覽數字一致。<button type="button" data-testid="attention-clear" @click="attention = false">看全部</button></p>
    <p v-if="payUnclaimed" class="notice" role="status" data-testid="pay-unclaimed-chip">只顯示「待請款」的採購單（已驗入、尚未請款的金額超過尾差），筆數與首頁數字一致。<button type="button" data-testid="pay-unclaimed-clear" @click="payUnclaimed = false">看全部</button></p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="單號、供應商、品名" data-testid="po-search" /></label>
      <label class="po-check"><input v-model="prepaid" type="checkbox" data-testid="po-filter-prepaid" />只看已預付（預付款還沒核銷完）</label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="po-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="po-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="po-list" aria-label="採購單清單">
      <li v-for="r in rows" :key="r.id" class="po-card" :class="{ late: r.overdue }" data-testid="po-card">
        <div class="card-head"><strong data-testid="po-no">{{ r.po_no }}</strong><span class="st" :data-status="r.status" data-testid="po-status">{{ PO_STATUS_LABEL[r.status] || r.status_label }}</span></div>
        <p class="card-line">{{ r.vendor_name || "（尚未選供應商）" }}　{{ r.first_item_name }}<template v-if="r.item_count > 1">等 {{ r.item_count }} 項</template></p>
        <p class="card-line muted">含稅 {{ money(r.total_amount) }}　已驗入 {{ num(r.received_qty) }} / {{ num(r.ordered_qty_base) }}</p>
        <p class="card-line muted">開單 {{ r.created_by_name }} {{ fmtTime(r.created_at) }}<template v-if="r.expected_delivery_date">　預計到貨 {{ dateText(r.expected_delivery_date) }}</template></p>
        <p v-if="r.overdue" class="late-tag" data-testid="po-late">逾期未到貨</p>
        <p v-if="Number(r.prepay_balance) > 0" class="prepay-tag" :class="{ bad: r.overdue }" data-testid="po-prepaid">已預付 {{ money(r.prepay_balance) }}<template v-if="r.overdue">（逾期未到貨）</template></p>
        <button type="button" data-testid="open-detail" @click="detailId = r.id">查看與處理</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的採購單" : loaded ? "目前沒有採購單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <PoDetailDialog v-if="detailId" :id="detailId" @close="closeDetail" @changed="load" />
    <PoSettingsDialog v-if="showSettings" @close="showSettings = false" />
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 12px; min-height: 60px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.po-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.po-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.po-card.late { border-color: #d9a3a0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.late-tag { margin: 0; color: #b3261e; font-weight: 600; font-size: 13px; }
.prepay-tag { margin: 0; color: #8a5a00; font-weight: 600; font-size: 13px; }
.prepay-tag.bad { color: #b3261e; }
.po-check { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; min-height: 36px; }
.po-check input { width: auto; min-height: 0; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
@media (max-width: 700px) {
  .po-card button, .head-actions button { min-height: 44px; }
  .po-list { grid-template-columns: minmax(0, 1fr); }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
