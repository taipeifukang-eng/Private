<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { BarChart3 } from "lucide-vue-next";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import UtilityBillDetail from "../../components/ga/UtilityBillDetail.vue";
import UtilityBillForm from "../../components/ga/UtilityBillForm.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import {
  BILL_STATUS_LABELS, EXPENSE_TYPES, EXPENSE_TYPE_LABELS, dateText, errorText, identifierLabel, money, monthText, siteOf, storeLabel,
  type Abilities, type Anomaly, type Bill, type FilterSummary, type GlobalStats, type StoreOption,
} from "../../lib/ga-utility-bills";
import type { WorkTab } from "../../stores";

// G23 水電電話網路費：帳單列表（伺服端分頁、精確筆數）、摘要卡、篩選（月份、類型、據點、狀態、搜尋）、新增與編輯、標記已繳、改回待繳、刪除、附件、「顯示已刪除」唯讀檢視。
// 待繳與逾期兩張卡不受月份、類型、據點篩選影響（全部月份、完整計算，與首頁、導覽徽章同一支函式）；「篩選結果合計」照目前篩選。沒填繳費期限的未繳帳單永不逾期，另列提示。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const payload = (props.tab.payload || {}) as { overdue?: boolean; status?: string; month?: string };
const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date());
const fromBadge = !!(payload.overdue || payload.status);
const rows = ref<Bill[]>([]);
const total = ref(0);
const summary = ref<FilterSummary>({ count: 0, total_amount: 0, paid_count: 0, paid_amount: 0, unpaid_count: 0, unpaid_amount: 0 });
const globalStats = ref<GlobalStats | null>(null);
const abilities = ref<Abilities | null>(null);
const stores = ref<StoreOption[]>([]);
const page = ref(1);
const pageSize = 20;
const month = ref(fromBadge ? "" : payload.month || currentMonth);
const type = ref("");
const storeId = ref("");
const status = ref(payload.overdue ? "overdue" : payload.status || "");
const search = ref("");
const debounced = useDebounced(search, 300);
const deletedView = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const latest = useLatest();
const detailId = ref("");
const editing = ref<Bill | null>(null);
const creating = ref(false);
const saved = ref<{ label: string; anomaly: Anomaly | null } | null>(null);
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canManage = computed(() => !!abilities.value?.canManage);
const hasFilter = computed(() => !!(month.value || type.value || storeId.value || status.value || debounced.value.trim()));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (month.value) q.set("month", month.value);
    if (type.value) q.set("type", type.value);
    if (storeId.value) q.set("storeId", storeId.value);
    if (status.value) q.set("status", status.value);
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (deletedView.value) q.set("deleted", "1");
    const res = await api<{ data: Bill[]; total: number; summary: FilterSummary; global: GlobalStats; permissions: Abilities }>("general-affairs/utility-bills?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    summary.value = res.summary;
    globalStats.value = res.global;
    abilities.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
async function loadStores() {
  if (!allowed.value) return;
  try {
    stores.value = (await api<{ stores: StoreOption[] }>("general-affairs/utility-bills/meta")).stores;
  } catch (e) {
    error.value = "門市清單載入失敗：" + errorText(e);
  }
}
watch([month, type, storeId, status, debounced, deletedView], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void load(); void loadStores(); });
useRefreshOnActivate(props.tab, () => { void load(); });

const g = computed(() => globalStats.value);
function pickOverdue() { month.value = ""; type.value = ""; storeId.value = ""; status.value = status.value === "overdue" ? "" : "overdue"; }
function pickPending() { month.value = ""; type.value = ""; storeId.value = ""; status.value = status.value === "unpaid" ? "" : "unpaid"; }
function showNoDue() { month.value = ""; type.value = ""; storeId.value = ""; status.value = "no_due"; }
function clearFilters() { month.value = ""; type.value = ""; storeId.value = ""; status.value = ""; search.value = ""; }

async function onSaved(b: Bill, anomaly: Anomaly | null) {
  creating.value = false;
  editing.value = null;
  saved.value = { label: `${siteOf(b)}（${EXPENSE_TYPE_LABELS[b.expense_type]} ${monthText(b.billing_month)}）`, anomaly };
  await load();
  detailId.value = b.id;
}
function openNew() { saved.value = null; creating.value = true; }
function openExisting(id: string) { creating.value = false; editing.value = null; detailId.value = id; }
function startEdit(b: Bill) { saved.value = null; detailId.value = ""; editing.value = b; }
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 費用管理</p>
      <h1>水電電話網路費</h1>
      <p class="muted">登錄水費、電費、電話費與網路費帳單，追蹤繳費期限。店長看不到這一頁。</p>
    </div>
    <div class="head-actions">
      <button type="button" data-testid="open-report" @click="openGaPage('ga-utility-bills-report')"><BarChart3 :size="14" /> 費用報表</button>
      <button v-if="canManage" type="button" class="primary" data-testid="new-bill" @click="openNew">新增費用</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '費用管理', '水電電話網路費']">
    <p v-if="saved" class="notice success" role="status" data-testid="bill-saved">已儲存 {{ saved.label }}。</p>
    <p v-if="saved?.anomaly" class="notice" role="status" data-testid="bill-saved-anomaly">{{ saved.anomaly.message }}</p>
    <ul class="stat-cards" aria-label="帳單摘要">
      <li :class="{ on: status === 'unpaid' && !month }">
        <button type="button" data-testid="card-pending" :aria-pressed="status === 'unpaid' && !month" @click="pickPending"><span>待繳（全部月份）</span><strong data-testid="stat-pending">{{ money(g?.pending_amount) }}</strong><small data-testid="stat-pending-count">{{ g?.pending_count ?? 0 }} 筆</small></button>
      </li>
      <li :class="{ on: status === 'overdue' && !month, alert: (g?.overdue_count ?? 0) > 0 }">
        <button type="button" data-testid="card-overdue" :aria-pressed="status === 'overdue' && !month" @click="pickOverdue"><span>已逾期（全部月份）</span><strong data-testid="stat-overdue">{{ g?.overdue_count ?? 0 }} 筆</strong><small data-testid="stat-overdue-amount">{{ money(g?.overdue_amount) }}</small></button>
      </li>
      <li>
        <div class="card-static"><span>篩選結果合計</span><strong data-testid="stat-filtered">{{ money(summary.total_amount) }}</strong><small v-if="deletedView" data-testid="stat-filtered-count">已刪除的帳單不列入合計（目前列出 {{ total }} 筆已刪除）</small><small v-else data-testid="stat-filtered-count">{{ summary.count }} 筆（已繳 {{ summary.paid_count }}、待繳 {{ summary.unpaid_count }}）</small></div>
      </li>
    </ul>
    <p v-if="(g?.no_due_count ?? 0) > 0 && !deletedView" class="notice" role="status" data-testid="no-due-hint">有 {{ g?.no_due_count }} 筆未繳帳單沒有填繳費期限（不會被算成逾期）。<button type="button" data-testid="show-no-due" @click="showNoDue">查看這些帳單</button></p>

    <div class="filter-bar">
      <label>帳單月份<input v-model="month" type="month" data-testid="filter-month" /></label>
      <label>據點<select v-model="storeId" data-testid="filter-store"><option value="">全部據點</option><option v-for="s in stores" :key="s.id" :value="s.id">{{ storeLabel(s) }}</option></select></label>
      <label>費用類型<select v-model="type" data-testid="filter-type"><option value="">全部費用</option><option v-for="t in EXPENSE_TYPES" :key="t" :value="t">{{ EXPENSE_TYPE_LABELS[t] }}</option></select></label>
      <label>狀態<select v-model="status" data-testid="filter-status"><option value="">全部</option><option value="unpaid">待繳費（含逾期）</option><option value="overdue">已逾期</option><option value="paid">已繳費</option><option value="no_due">未填繳費期限</option></select></label>
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="據點、供應商、識別號碼、帳號、銷帳編號" data-testid="bill-search" /></label>
      <label class="check"><input v-model="deletedView" type="checkbox" data-testid="show-deleted" /> 顯示已刪除（唯讀）</label>
    </div>
    <p v-if="deletedView" class="notice" role="status" data-testid="deleted-view-note">目前顯示已刪除的帳單（唯讀，看得到誰、何時、為何刪除；不能還原）。</p>
    <p v-if="error" class="notice error" role="alert" data-testid="bill-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <div class="list-meta"><span data-testid="bill-total">共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <ul class="bill-list" aria-label="帳單清單">
      <li v-for="b in rows" :key="b.id" class="bill-card" :class="{ overdue: b.status === 'overdue', gone: !!b.deleted_at }" data-testid="bill-card">
        <div class="card-head"><strong data-testid="bill-site">{{ siteOf(b) }}</strong><span class="st" :data-status="b.status" data-testid="bill-status">{{ BILL_STATUS_LABELS[b.status] }}</span></div>
        <p class="card-line"><span class="chip">{{ EXPENSE_TYPE_LABELS[b.expense_type] }}</span>　{{ monthText(b.billing_month) }}　<strong data-testid="bill-amount">{{ money(b.amount) }}</strong></p>
        <p class="card-line muted">{{ b.provider_name || "（未填供應商）" }}｜{{ identifierLabel(b.expense_type) }}：{{ b.service_identifier || b.equipment_serial || "—" }}</p>
        <p class="card-line muted">繳費期限 {{ dateText(b.due_date) || "未填" }}<template v-if="b.paid_at">　已繳 {{ dateText(b.paid_at) }}</template></p>
        <p v-if="b.deleted_at" class="card-line muted" data-testid="bill-deleted-line">{{ b.deleted_by_name || "—" }} 刪除：{{ b.deletion_reason }}</p>
        <button type="button" data-testid="open-bill" @click="detailId = b.id">查看詳情</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的帳單" : loaded ? (deletedView ? "沒有已刪除的帳單" : "目前還沒有費用紀錄") : "" }}<button v-if="hasFilter" type="button" @click="clearFilters">清除篩選</button></li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <UtilityBillDetail v-if="detailId" :id="detailId" :can-manage="canManage" @close="detailId = ''" @edit="startEdit" @changed="load" />
    <UtilityBillForm v-if="creating" :bill="null" :stores="stores" @close="creating = false" @saved="onSaved" @open-existing="openExisting" />
    <UtilityBillForm v-if="editing" :key="editing.id + editing.updated_at" :bill="editing" :stores="stores" @close="editing = null" @saved="onSaved" @open-existing="openExisting" />
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards button, .card-static { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 12px; min-height: 72px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.stat-cards small { color: var(--muted); }
.filter-bar .check { display: flex; align-items: center; gap: 6px; }
.filter-bar .check input { width: auto; min-height: 0; }
.bill-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.bill-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; align-content: start; }
.bill-card.overdue { border-color: #d9a3a0; }
.bill-card.gone { opacity: 0.85; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.chip { display: inline-block; border-radius: 6px; padding: 0 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.st[data-status="overdue"] { color: #b3261e; border-color: #d9a3a0; }
.st[data-status="paid"] { color: #1b6e3a; }
@media (max-width: 700px) {
  .bill-card button, .head-actions button { min-height: 44px; }
  .bill-list { grid-template-columns: minmax(0, 1fr); }
  .stat-cards { grid-template-columns: minmax(0, 1fr); }
}
</style>
