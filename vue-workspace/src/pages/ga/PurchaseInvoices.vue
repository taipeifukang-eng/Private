<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { INVOICE_TYPES, INVOICE_TYPE_LABELS, dateText, errorText, money, type Invoice, type PayAbilities } from "../../lib/ga-invoices";
import type { WorkTab } from "../../stores";

// 第 4.5 批 進貨發票清單：伺服端分頁、精確筆數、篩選（狀態、類型、日期區間、缺圖、未被請款單引用、搜尋）。
// 發票金額與賣方統編只給有請款檢視／管理權限者（沒有廠商權限者賣方統編遮蔽）；新增只給請款管理權限者。缺圖的發票以紅字標示，不能放進請款單。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const rows = ref<Invoice[]>([]);
const total = ref(0);
const summary = ref({ count: 0, total_amount: 0 });
const abilities = ref<PayAbilities | null>(null);
const page = ref(1);
const pageSize = 20;
const status = ref("ACTIVE");
const type = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const missingImage = ref(false);
const unreferenced = ref(false);
const search = ref("");
const debounced = useDebounced(search, 300);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canManage = computed(() => !!abilities.value?.canManage);
const hasFilter = computed(() => !!(type.value || dateFrom.value || dateTo.value || missingImage.value || unreferenced.value || debounced.value.trim() || status.value !== "ACTIVE"));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (status.value) q.set("status", status.value);
    if (type.value) q.set("type", type.value);
    if (dateFrom.value) q.set("dateFrom", dateFrom.value);
    if (dateTo.value) q.set("dateTo", dateTo.value);
    if (missingImage.value) q.set("missingImage", "1");
    if (unreferenced.value) q.set("unreferenced", "1");
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: Invoice[]; total: number; summary: { count: number; total_amount: number }; permissions: PayAbilities }>("general-affairs/purchase-invoices?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    summary.value = res.summary;
    abilities.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([status, type, dateFrom, dateTo, missingImage, unreferenced, debounced], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void load(); });
useRefreshOnActivate(props.tab, () => { void load(); });
function clearFilters() { status.value = "ACTIVE"; type.value = ""; dateFrom.value = ""; dateTo.value = ""; missingImage.value = false; unreferenced.value = false; search.value = ""; }
const open = (id: string) => openGaPage("ga-purchase-invoice-edit", id);
const openNew = () => openGaPage("ga-purchase-invoice-edit");
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>進貨發票</h1>
      <p class="muted">登錄廠商開立的發票、收據，連結到進貨單並上傳圖片。三聯式、二聯式、電子發票一定要上傳圖片，缺圖的發票不能放進請款單。</p>
    </div>
    <div class="head-actions">
      <button v-if="canManage" type="button" class="primary" data-testid="new-invoice" @click="openNew">新增發票</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '進貨發票']">
    <div class="filter-bar">
      <label>狀態<select v-model="status" data-testid="inv-filter-status"><option value="ACTIVE">有效</option><option value="VOID">已作廢</option><option value="">全部</option></select></label>
      <label>類型<select v-model="type" data-testid="inv-filter-type"><option value="">全部類型</option><option v-for="t in INVOICE_TYPES" :key="t" :value="t">{{ INVOICE_TYPE_LABELS[t] }}</option></select></label>
      <label>發票日期（起）<input v-model="dateFrom" type="date" data-testid="inv-filter-from" /></label>
      <label>發票日期（迄）<input v-model="dateTo" type="date" data-testid="inv-filter-to" /></label>
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="發票號碼、廠商名稱、備註" data-testid="inv-search" /></label>
      <label class="check"><input v-model="missingImage" type="checkbox" data-testid="inv-filter-missing" /> 只看缺圖</label>
      <label class="check"><input v-model="unreferenced" type="checkbox" data-testid="inv-filter-unref" /> 只看還沒請款</label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="inv-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <div class="list-meta"><span data-testid="inv-total">共 {{ total }} 張</span><span data-testid="inv-sum">含稅合計 {{ money(summary.total_amount) }}</span><span v-if="loading" role="status">載入中…</span></div>

    <ul class="inv-list" aria-label="發票清單">
      <li v-for="i in rows" :key="i.id" class="inv-card" :class="{ gone: i.status === 'VOID', missing: i.missing_image && i.status === 'ACTIVE' }" data-testid="inv-card">
        <div class="card-head">
          <strong data-testid="inv-no">{{ i.invoice_no || "（免開發票）" }}</strong>
          <span class="chip" data-testid="inv-type">{{ INVOICE_TYPE_LABELS[i.invoice_type] }}</span>
          <span v-if="i.status === 'VOID'" class="st void" data-testid="inv-void">已作廢</span>
          <span v-else-if="i.missing_image" class="st missing" data-testid="inv-missing">缺圖</span>
        </div>
        <p class="card-line">{{ i.vendor_name || "（廠商）" }}　{{ dateText(i.invoice_date) }}</p>
        <p class="card-line"><strong data-testid="inv-amount">{{ money(i.amount_total) }}</strong><span class="muted">　未稅 {{ money(i.amount_untaxed) }}、稅額 {{ money(i.tax_amount) }}</span></p>
        <p class="card-line muted">連結進貨 {{ i.receipts.length }} 張<template v-if="i.receipts.length">：{{ i.receipts.map((r) => r.receipt_no).join("、") }}</template>　圖片 {{ i.image_count }} 張</p>
        <p v-if="i.referenced_by.length" class="card-line muted" data-testid="inv-refs">已被請款單使用：{{ i.referenced_by.map((r) => r.pr_no).join("、") }}</p>
        <button type="button" data-testid="open-invoice" @click="open(i.id)">查看與編輯</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的發票" : loaded ? "目前還沒有發票" : "" }}<button v-if="hasFilter" type="button" @click="clearFilters">清除篩選</button></li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.filter-bar .check { display: flex; align-items: center; gap: 6px; }
.filter-bar .check input { width: auto; min-height: 0; }
.inv-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.inv-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; align-content: start; }
.inv-card.missing { border-color: #d9a3a0; }
.inv-card.gone { opacity: 0.8; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.chip { display: inline-block; border-radius: 6px; padding: 0 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); white-space: nowrap; }
.st.missing { color: #b3261e; border-color: #d9a3a0; background: #fdecea; }
.st.void { color: var(--muted); }
@media (max-width: 700px) {
  .inv-card button, .head-actions button { min-height: 44px; }
  .inv-list { grid-template-columns: minmax(0, 1fr); }
}
</style>
