<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PoPicker from "../../components/ga/PoPicker.vue";
import PaymentSettingsDialog from "../../components/ga/PaymentSettingsDialog.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { PAYEE_TYPE_LABELS, PR_KIND_LABELS, PR_SOURCE_NAMES, PR_STATUS_CLASS, PR_STATUS_LABELS, dateText, downloadCsv, errorText, isUtilityRequest, money, payeeName, type PaymentRequest, type UtilityAbilities } from "../../lib/ga-payments";
import { UTILITY_BILL_MANAGE_LABEL } from "../../../../lib/workspace/general-affairs/utility-bill-rules";
import type { WorkTab } from "../../stores";

// 第 4.5 批 請款單清單：伺服端分頁、篩選（狀態、廠商、月份、搜尋）、「待付款」頁籤（已送出）、匯出依廠商與月份的對帳 CSV。
// 沒有核准關卡：總務建立並送出，會計標已付款；有管理權限者可建立與處理。廠商統編與銀行帳號沒有廠商權限者看不到。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const rows = ref<PaymentRequest[]>([]);
const total = ref(0);
const summary = ref<Record<string, number>>({});
const globalSum = ref<Record<string, number>>({});
const abilities = ref<UtilityAbilities | null>(null);
const page = ref(1);
const pageSize = 20;
// 從首頁「待付款請款單」或導覽徽章點進來時（payload.status = SUBMITTED）直接看待付款頁籤。
const view = ref<"ALL" | "SUBMITTED">((props.tab.payload as { status?: unknown } | undefined)?.status === "SUBMITTED" ? "SUBMITTED" : "ALL");
// 從首頁「逾 14 天未送出的請款草稿」點進來時（payload.stale_draft）只列這些草稿；清除篩選即回全部。
const staleDraft = ref(["1", "true"].includes(String((props.tab.payload as { stale_draft?: unknown } | undefined)?.stale_draft ?? "")));
// 匯出對帳 CSV 預設只含已送出與已付款；勾選才加入草稿、已作廢（F2）。
const includeDraft = ref(false);
const includeVoid = ref(false);
const status = ref("");
// G46 來源：全部、採購、水電話費（列表篩選）；匯出的來源預設採購（兩種欄位不同，分開匯出）。
const source = ref("");
// ga-improve-b1：類型（一般請款／預付款）、付款對象（廠商／同仁代墊）、預付逾期未到貨（G1，從總務待辦點進來也會帶）。
const payKind = ref("");
const payeeType = ref("");
const prepayOverdue = ref(["1", "true"].includes(String((props.tab.payload as { prepay_overdue?: unknown } | undefined)?.prepay_overdue ?? "")));
const exportSource = ref<"PURCHASE" | "UTILITY">("PURCHASE");
const vendorId = ref("");
const month = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const exportMsg = ref("");
const showSettings = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canManage = computed(() => !!abilities.value?.canManage);
const effStatus = computed(() => (view.value === "SUBMITTED" ? "SUBMITTED" : status.value));
const hasFilter = computed(() => !!(staleDraft.value || prepayOverdue.value || payKind.value || payeeType.value || source.value || status.value || vendorId.value || month.value || debounced.value.trim() || view.value !== "ALL"));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (effStatus.value) q.set("status", effStatus.value);
    if (staleDraft.value) q.set("stale_draft", "true");
    if (source.value) q.set("source", source.value);
    if (payKind.value) q.set("payKind", payKind.value);
    if (payeeType.value) q.set("payeeType", payeeType.value);
    if (prepayOverdue.value) q.set("prepayOverdue", "1");
    if (vendorId.value) q.set("vendorId", vendorId.value);
    if (month.value) q.set("month", month.value);
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: PaymentRequest[]; total: number; summary: Record<string, number>; global: Record<string, number>; permissions: UtilityAbilities }>("general-affairs/payment-requests?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    summary.value = res.summary || {};
    globalSum.value = res.global || {};
    abilities.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([view, status, source, payKind, payeeType, prepayOverdue, vendorId, month, debounced, staleDraft], () => { page.value = 1; void load(); });
watch(source, (v) => { if (v === "UTILITY" || v === "PURCHASE") exportSource.value = v; });
watch(page, load);
onMounted(() => { void load(); });
useRefreshOnActivate(props.tab, () => { void load(); });
function clearFilters() { prepayOverdue.value = false; payKind.value = ""; payeeType.value = ""; staleDraft.value = false; view.value = "ALL"; status.value = ""; source.value = ""; vendorId.value = ""; month.value = ""; search.value = ""; }
const open = (id: string) => openGaPage("ga-payment-request-edit", id);
// 採購請款單的新增流程不變；水電話費請款單另有自己的入口（需要請款管理＋水電話網費管理）。
const openNew = () => openGaPage("ga-payment-request-edit", undefined, { source: "PURCHASE" });
const openNewUtility = () => { if (abilities.value?.canCreateUtility) openGaPage("ga-payment-request-edit", undefined, { source: "UTILITY" }); };
const utilityNeed = computed(() => (abilities.value?.canCreateUtility ? "" : `建立水電話費請款單需要「${(abilities.value?.missingForCreate || ["請款管理", UTILITY_BILL_MANAGE_LABEL]).join("」與「")}」權限`));
async function exportCsv() {
  exportMsg.value = "";
  if (!month.value) { exportMsg.value = "請先選擇要匯出的月份（以請款單建立日的月份為準）。"; return; }
  const q = new URLSearchParams({ month: month.value });
  if (exportSource.value === "UTILITY") q.set("source", "UTILITY");
  q.set("extended", "1"); // 對帳 CSV 追加類型、付款對象、抬頭、信用卡末四碼、平台欄位（原欄位與順序不動）
  if (vendorId.value) q.set("vendorId", vendorId.value);
  if (effStatus.value) q.set("status", effStatus.value);
  else {
    if (includeDraft.value) q.set("includeDraft", "1");
    if (includeVoid.value) q.set("includeVoid", "1");
  }
  exportMsg.value = (await downloadCsv("general-affairs/payment-requests/export", q)) || "已匯出對帳 CSV。";
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>請款單</h1>
      <p class="muted">總務把已驗收進貨的發票彙整成請款單，送出後由會計付款並標記已付款。請款不需要核准；已付款的請款單鎖定，只能備註或作廢。</p>
    </div>
    <div class="head-actions">
      <button type="button" data-testid="pr-settings" @click="showSettings = true">請款設定</button>
      <button v-if="canManage" type="button" class="primary" data-testid="new-pr" @click="openNew">建立請款單</button>
      <button v-if="canManage" type="button" :disabled="!abilities?.canCreateUtility" :title="utilityNeed" data-testid="new-pr-utility" @click="openNewUtility">建立水電話費請款單</button>
      <span v-if="canManage && utilityNeed" class="muted" data-testid="new-pr-utility-need">{{ utilityNeed }}</span>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '請款單']">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="view === 'ALL'" :class="{ on: view === 'ALL' }" data-testid="pr-tab-all" @click="view = 'ALL'">全部</button>
      <button type="button" role="tab" :aria-selected="view === 'SUBMITTED'" :class="{ on: view === 'SUBMITTED' }" data-testid="pr-tab-pay" @click="view = 'SUBMITTED'">待付款<span v-if="globalSum.submitted_count" class="count" data-testid="pr-pay-count">{{ globalSum.submitted_count }}</span></button>
    </div>
    <div class="filter-bar">
      <label v-if="view === 'ALL'">狀態<select v-model="status" data-testid="pr-filter-status"><option value="">全部狀態</option><option v-for="(l, k) in PR_STATUS_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
      <label>來源<select v-model="source" data-testid="pr-filter-source"><option value="">全部來源</option><option v-for="(l, k) in PR_SOURCE_NAMES" :key="k" :value="k">{{ l }}</option></select></label>
      <label>類型<select v-model="payKind" data-testid="pr-filter-kind"><option value="">全部類型</option><option v-for="(l, k) in PR_KIND_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
      <label>付款對象<select v-model="payeeType" data-testid="pr-filter-payee"><option value="">全部</option><option v-for="(l, k) in PAYEE_TYPE_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
      <label>月份（請款單建立月）<input v-model="month" type="month" data-testid="pr-filter-month" /></label>
      <PoPicker v-if="abilities?.vendorVisible" v-model="vendorId" kind="vendor" label="廠商" testid="pr-filter-vendor" clearable />
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="請款單號、廠商名稱" data-testid="pr-search" /></label>
      <button type="button" data-testid="pr-export" @click="exportCsv">匯出對帳 CSV</button>
    </div>
    <div class="export-opts" role="group" aria-label="匯出對帳 CSV 的狀態" data-testid="pr-export-opts">
      <strong>匯出來源</strong>
      <label><input v-model="exportSource" type="radio" value="PURCHASE" name="pr-export-source" data-testid="pr-export-src-purchase" />採購（預設）</label>
      <label><input v-model="exportSource" type="radio" value="UTILITY" name="pr-export-source" data-testid="pr-export-src-utility" />水電話費</label>
      <strong>匯出對帳 CSV 的狀態</strong>
      <span class="muted" data-testid="pr-export-default">預設只含已送出與已付款</span>
      <label><input v-model="includeDraft" type="checkbox" data-testid="pr-export-draft" :disabled="!!effStatus" />加入草稿</label>
      <label><input v-model="includeVoid" type="checkbox" data-testid="pr-export-void" :disabled="!!effStatus" />加入已作廢</label>
    </div>
    <p v-if="prepayOverdue" class="notice" role="status" data-testid="pr-prepay-overdue-chip">只顯示「逾期未到貨的預付款」（採購單已下訂、超過預計到貨日、預付餘額還沒核銷），請向廠商催貨或登記退款。<button type="button" data-testid="pr-prepay-overdue-clear" @click="prepayOverdue = false">看全部</button></p>
    <p class="muted prepay-toggle"><label><input v-model="prepayOverdue" type="checkbox" data-testid="pr-prepay-overdue-toggle" />只看逾期未到貨的預付款</label></p>
    <p v-if="staleDraft" class="notice" role="status" data-testid="pr-stale-chip">只顯示「逾 14 天未送出」的請款草稿。<button type="button" data-testid="pr-stale-clear" @click="staleDraft = false">清除篩選</button></p>
    <p v-if="exportMsg" class="notice" role="status" data-testid="pr-export-msg">{{ exportMsg }}</p>
    <p v-if="error" class="notice error" role="alert" data-testid="pr-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <div class="list-meta">
      <span data-testid="pr-total">共 {{ total }} 張</span><span data-testid="pr-sum">合計 {{ money(summary.total_amount || 0) }}</span>
      <span data-testid="pr-pending">待付款 {{ globalSum.submitted_count || 0 }} 張 {{ money(globalSum.submitted_amount || 0) }}</span><span v-if="loading" role="status">載入中…</span>
    </div>

    <ul class="pr-list" aria-label="請款單清單">
      <li v-for="r in rows" :key="r.id" class="pr-card" :class="{ gone: r.status === 'VOID' }" data-testid="pr-card">
        <div class="card-head">
          <strong data-testid="pr-no">{{ r.pr_no }}</strong>
          <span class="src" :class="{ util: isUtilityRequest(r) }" data-testid="pr-source">{{ isUtilityRequest(r) ? PR_SOURCE_NAMES.UTILITY : PR_SOURCE_NAMES.PURCHASE }}</span>
          <span v-if="r.pay_kind === 'PREPAY'" class="src prepay" data-testid="pr-kind">預付款</span>
          <span v-if="r.payee_type === 'EMPLOYEE'" class="src emp" data-testid="pr-payee-kind">同仁代墊</span>
          <span class="st" :class="PR_STATUS_CLASS[r.status]" data-testid="pr-status">{{ PR_STATUS_LABELS[r.status] }}</span>
        </div>
        <p class="card-line">{{ r.vendor_name_snapshot || "（廠商）" }}　建立 {{ dateText(r.created_at) }}</p>
        <p v-if="r.payee_type === 'EMPLOYEE'" class="card-line" data-testid="pr-payee">付款對象：同仁 {{ payeeName(r) }}</p>
        <p v-if="r.pay_kind === 'PREPAY'" class="card-line" :class="{ overdue: r.prepay_overdue }" data-testid="pr-prepay-info">採購單 {{ r.prepay_po_no || (r.po_nos || [])[0] || "—" }}　預付餘額 {{ money(r.prepay_balance || 0) }}<template v-if="r.prepay_overdue">（逾期未到貨 {{ r.prepay_overdue_days }} 天）</template></p>
        <p v-if="isUtilityRequest(r)" class="card-line"><strong data-testid="pr-amount">{{ money(r.amount_total) }}</strong><span class="muted" data-testid="pr-bill-info">　帳單月份 {{ String(r.bill_month || "").slice(0, 7) }}，{{ r.bill_count ?? 0 }} 張帳單</span></p>
        <p v-else class="card-line"><strong data-testid="pr-amount">{{ money(r.amount_total) }}</strong><span class="muted">　<template v-if="r.pay_kind === 'PREPAY'">預付款，採購單 {{ (r.po_nos || []).join("、") }}</template><template v-else>{{ r.line_count }} 筆進貨<template v-if="r.po_nos?.length">，採購單 {{ r.po_nos.join("、") }}</template></template></span></p>
        <p v-if="r.expected_pay_date" class="card-line muted">預計付款日 {{ dateText(r.expected_pay_date) }}</p>
        <p v-if="r.status === 'PAID'" class="card-line muted">{{ dateText(r.paid_date) }} 付款<template v-if="r.paid_ref">（{{ r.paid_ref }}）</template></p>
        <button type="button" data-testid="open-pr" @click="open(r.id)">查看</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的請款單" : loaded ? "目前還沒有請款單" : "" }}<button v-if="hasFilter" type="button" @click="clearFilters">清除篩選</button></li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <PaymentSettingsDialog v-if="showSettings" @close="showSettings = false" />
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tabs button { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 6px 14px; min-height: 36px; }
.tabs button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.count { margin-left: 6px; border-radius: 10px; background: #b3261e; color: #fff; font-size: 12px; padding: 0 7px; }
.pr-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.pr-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; align-content: start; }
.pr-card.gone { opacity: 0.8; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); white-space: nowrap; }
.st.submitted { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
.st.paid { color: #1b6e3a; border-color: #9fd2b0; background: #e8f6ec; }
.st.void { color: var(--muted); }
.src { display: inline-block; border-radius: 6px; padding: 0 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); white-space: nowrap; }
.src.util { color: #0b5cab; border-color: #9cc3ea; background: #eaf3fc; }
.src.prepay { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
.src.emp { color: #7a3d00; border-color: #e0b48a; background: #fdf0e3; }
.card-line.overdue { color: #b3261e; font-weight: 600; }
.prepay-toggle { margin: 0 0 8px; }
.prepay-toggle label { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; min-height: 32px; }
.prepay-toggle input { width: auto; min-height: 0; }
.export-opts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 0 10px; font-size: 13px; }
.export-opts label { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; }
@media (max-width: 700px) {
  .filter-bar .grow { flex: 1 1 100%; min-width: 0; }
  .filter-bar .grow input { width: 100%; }
  .pr-card button, .head-actions button, .tabs button { min-height: 44px; }
  .pr-list { grid-template-columns: minmax(0, 1fr); }
}
</style>
