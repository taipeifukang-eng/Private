<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, ApiError } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import ImageLightbox from "../components/ImageLightbox.vue";
import { compressImage, imagesFromClipboard } from "../lib/clinic-images";
import { SCREENSHOT_MAX_COUNT, validateScreenshots } from "../../../lib/clinic-selfpay/screenshots";

// 診所自費藥毛利計算（M6 W30）。兩個分頁：毛利計算（匯入診所檔與截圖、批次清單與明細、刪批次）、DPOS 對應主檔（匯入月價格檔、關帳開帳、歷史價格）。
// 成本與毛利只在這個計算器畫面看得到；給診所的 PDF 不含成本與毛利（W31）。D2 找不到價格的藥品整批擋下並列出代碼與藥名；
// D3 檔案期間與選的年月不同要確認；D4 同門市同月同診所已有批次要確認（確認後仍新增）。
const props = defineProps<{ tab: WorkTab }>();
type Store = { id: string; store_code: string; store_name: string };
type Access = { canUseCalculator: boolean; canManageMapping: boolean; canDeleteBatch: boolean };
type Batch = {
  id: string; store_id: string; store_code: string; store_name: string; year_month: string; clinic_code: string | null; clinic_name: string | null;
  period_start: string | null; period_end: string | null; item_count: number; total_qty: number; total_billing_amount: number; total_gross_profit_amount: number; imported_at: string;
};
type Item = {
  id: string; line_no: number | null; health_insurance_code: string; drug_name: string | null; qty: number; matched_product_code: string | null;
  matched_member_price: number | null; matched_cost_price: number | null; billing_amount: number; gross_profit_amount: number; match_status: "matched" | "unmatched";
};
type Summary = { itemCount: number; matchedCount: number; unmatchedCount: number; totalQty: number; totalBilling: number; totalGrossProfit: number };
type Report = { batch: Batch & Record<string, any>; items: Item[]; summary: Summary; screenshotUrls: string[] };
type Mapping = { health_insurance_code: string; drug_name: string; product_code: string; product_name: string; latest_year_month: string };
type History = { year_month: string; product_code: string; product_name: string; member_price: number; cost_price: number };

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const money = (v: number) => Number(v || 0).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money1 = (v: number) => Math.round(Number(v || 0)).toLocaleString("zh-TW");

const loading = ref(true),
  error = ref(""),
  access = ref<Access>({ canUseCalculator: false, canManageMapping: false, canDeleteBatch: false }),
  stores = ref<Store[]>([]),
  storeId = ref(""),
  yearMonth = ref(thisMonth()),
  activeTab = ref<"calc" | "mapping">("calc"),
  root = ref<HTMLElement>();

// ---- 毛利計算
const claimInput = ref<HTMLInputElement>(),
  shotInput = ref<HTMLInputElement>(),
  claimFile = ref<File | null>(null),
  shots = ref<File[]>([]),
  shotUrls = ref<string[]>([]),
  batchMessage = ref(""),
  unmatched = ref<{ code: string; name: string }[]>([]),
  batches = ref<Batch[]>([]),
  loadingBatches = ref(false),
  report = ref<Report | null>(null),
  loadingReport = ref(false);
const confirm = ref<null | { code: "PERIOD_MISMATCH" | "DUPLICATE_BATCH"; message: string; existing?: any[] }>(null);
const lightboxOpen = ref(false),
  pdfBusy = ref(false);
const deleteTarget = ref<Batch | null>(null),
  deleteError = ref("");
let compressed: File[] | null = null;
let confirmed: { confirm_period?: boolean; confirm_duplicate?: boolean } = {};

// ---- DPOS 對應主檔
const priceInput = ref<HTMLInputElement>(),
  priceMessage = ref(""),
  mappings = ref<Mapping[]>([]),
  loadingMappings = ref(false),
  isClosed = ref(false),
  closeAsk = ref(false),
  mappingMessage = ref(""),
  historyTarget = ref<Mapping | null>(null),
  historyRows = ref<History[]>([]),
  loadingHistory = ref(false);

const store = computed(() => stores.value.find((s) => s.id === storeId.value) || null);
watch([claimFile, shots], () => (props.tab.dirty = !!claimFile.value || shots.value.length > 0), { flush: "sync" });
watch(shots, (list) => {
  shotUrls.value.forEach((u) => URL.revokeObjectURL(u));
  shotUrls.value = list.map((f) => URL.createObjectURL(f));
});
onBeforeUnmount(() => {
  shotUrls.value.forEach((u) => URL.revokeObjectURL(u));
  window.removeEventListener("paste", onPaste);
});

async function init() {
  loading.value = true;
  error.value = "";
  try {
    access.value = (await api<{ access: Access }>("clinic-selfpay/permissions")).access;
    stores.value = (await api<{ stores: Store[] }>("clinic-selfpay/stores")).stores;
    if (!storeId.value && stores.value.length) storeId.value = stores.value[0].id;
    if (!access.value.canUseCalculator) activeTab.value = "mapping";
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
let seqBatches = 0;
async function loadBatches() {
  if (!storeId.value || !access.value.canUseCalculator) return;
  const mine = ++seqBatches;
  loadingBatches.value = true;
  try {
    const d = await api<{ batches: Batch[] }>("clinic-selfpay/batches?store_id=" + encodeURIComponent(storeId.value));
    if (mine === seqBatches) batches.value = d.batches;
  } catch (e: any) {
    if (mine === seqBatches) batchMessage.value = `載入歷史匯入紀錄失敗：${e.message}`;
  } finally {
    if (mine === seqBatches) loadingBatches.value = false;
  }
}
let seqMap = 0;
async function loadMappings() {
  if (!storeId.value || !access.value.canManageMapping || !/^\d{4}-\d{2}$/.test(yearMonth.value)) return;
  const mine = ++seqMap;
  loadingMappings.value = true;
  try {
    const d = await api<{ items: Mapping[]; meta: { isClosed: boolean } }>(`clinic-selfpay/mappings?store_id=${encodeURIComponent(storeId.value)}&year_month=${encodeURIComponent(yearMonth.value)}`);
    if (mine !== seqMap) return;
    mappings.value = d.items;
    isClosed.value = !!d.meta?.isClosed;
  } catch (e: any) {
    if (mine === seqMap) mappingMessage.value = `載入對應主檔失敗：${e.message}`;
  } finally {
    if (mine === seqMap) loadingMappings.value = false;
  }
}
watch(storeId, () => {
  report.value = null;
  void loadBatches();
  void loadMappings();
});
watch(yearMonth, () => void loadMappings());
watch(() => access.value.canManageMapping, () => void loadMappings());
watch(() => access.value.canUseCalculator, () => void loadBatches());

function pickShots(event: Event) {
  const el = event.target as HTMLInputElement;
  addShots(Array.from(el.files || []));
  el.value = "";
}
function addShots(files: File[]) {
  if (!files.length) return;
  const room = SCREENSHOT_MAX_COUNT - shots.value.length;
  if (files.length > room) batchMessage.value = `單次最多上傳 ${SCREENSHOT_MAX_COUNT} 張截圖，多的已略過`;
  shots.value = [...shots.value, ...files.slice(0, Math.max(0, room))];
  compressed = null;
}
function onPaste(event: ClipboardEvent) {
  // 只在這個頁面看得到時接收貼上（工作台可能同時開著多個頁籤）
  if (!root.value || root.value.offsetParent === null || activeTab.value !== "calc" || !access.value.canUseCalculator) return;
  const images = imagesFromClipboard(event);
  if (!images.length) return;
  event.preventDefault();
  addShots(images);
}
function removeShot(i: number) {
  shots.value = shots.value.filter((_, idx) => idx !== i);
  compressed = null;
}
function clearShots() {
  shots.value = [];
  compressed = null;
}
function chooseClaim(event: Event) {
  claimFile.value = (event.target as HTMLInputElement).files?.[0] || null;
}

async function submitImport() {
  if (props.tab.busy) return;
  if (!claimFile.value) return void (batchMessage.value = "請先選擇診所自費藥檔案");
  if (!shots.value.length) return void (batchMessage.value = "請至少上傳 1 張健保系統截圖（可多檔或 Ctrl+V 貼上）");
  props.tab.busy = true;
  unmatched.value = [];
  batchMessage.value = "壓縮截圖中…";
  try {
    if (!compressed) compressed = await Promise.all(shots.value.map(compressImage));
    const tooBig = validateScreenshots(compressed);
    if (tooBig) return void (batchMessage.value = `❌ ${tooBig}`);
    batchMessage.value = "計算中…";
    const form = new FormData();
    form.append("file", claimFile.value);
    form.append("store_id", storeId.value);
    form.append("year_month", yearMonth.value);
    compressed.forEach((f) => form.append("screenshots", f));
    if (confirmed.confirm_period) form.append("confirm_period", "1");
    if (confirmed.confirm_duplicate) form.append("confirm_duplicate", "1");
    const d = await api<any>("clinic-selfpay/batches/import", { method: "POST", body: form });
    const s = d.summary as Summary;
    batchMessage.value = `✅ 匯入成功：共 ${s.itemCount} 筆，匹配 ${s.matchedCount} 筆，未匹配 ${s.unmatchedCount} 筆（${d.yearMonth}）`;
    confirmed = {};
    confirm.value = null;
    claimFile.value = null;
    shots.value = [];
    compressed = null;
    if (claimInput.value) claimInput.value.value = "";
    await loadBatches();
    await openReport(d.batchId);
  } catch (e: any) {
    const data = e instanceof ApiError ? e.data : null;
    if (e instanceof ApiError && e.status === 409 && (data?.code === "PERIOD_MISMATCH" || data?.code === "DUPLICATE_BATCH")) {
      batchMessage.value = "";
      confirm.value = { code: data.code, message: data.error, existing: data.existing };
    } else if (data?.code === "UNMATCHED") {
      unmatched.value = data.unmatched || [];
      batchMessage.value = `❌ 匯入失敗：${e.message}`;
    } else {
      batchMessage.value = `❌ 匯入失敗：${e.message}`;
    }
  } finally {
    props.tab.busy = false;
  }
}
function answerConfirm(yes: boolean) {
  if (!confirm.value || props.tab.busy) return;
  if (!yes) {
    confirm.value = null;
    confirmed = {};
    batchMessage.value = "已取消匯入，沒有寫入任何資料";
    return;
  }
  if (confirm.value.code === "PERIOD_MISMATCH") confirmed.confirm_period = true;
  else confirmed.confirm_duplicate = true;
  confirm.value = null;
  void submitImport();
}

async function openReport(id: string) {
  loadingReport.value = true;
  try {
    report.value = await api<Report>("clinic-selfpay/batches/" + id);
  } catch (e: any) {
    batchMessage.value = `載入明細失敗：${e.message}`;
  } finally {
    loadingReport.value = false;
  }
}
async function exportPdf() {
  const r = report.value;
  if (!r || pdfBusy.value) return;
  pdfBusy.value = true;
  try {
    const { exportClaimPdf } = await import("../lib/clinic-pdf");
    const out = await exportClaimPdf({
      storeName: store.value?.store_name || r.batch.store_name || "",
      batch: r.batch,
      items: r.items,
      totalBilling: r.summary.totalBilling,
      fallbackYearMonth: yearMonth.value,
    });
    batchMessage.value = `✅ 已匯出 ${out.filename}（${out.pages} 頁，不含成本與毛利）`;
  } catch (e) {
    console.warn("[clinic-selfpay] 診所請款明細PDF匯出失敗", e);
    batchMessage.value = "❌ 診所請款明細PDF匯出失敗，請稍後再試";
  } finally {
    pdfBusy.value = false;
  }
}
async function removeBatch() {
  const target = deleteTarget.value;
  if (!target || props.tab.busy) return;
  props.tab.busy = true;
  deleteError.value = "";
  try {
    const d = await api<{ removedScreenshots: number }>("clinic-selfpay/batches/" + target.id, { method: "DELETE" });
    batchMessage.value = `✅ 匯入批次已刪除（同時刪除 ${d.removedScreenshots} 張截圖）`;
    if (report.value?.batch.id === target.id) report.value = null;
    deleteTarget.value = null;
    await loadBatches();
  } catch (e: any) {
    deleteError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}

async function importPrices(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  if (!file || props.tab.busy) return;
  props.tab.busy = true;
  priceMessage.value = "";
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("store_id", storeId.value);
    form.append("year_month", yearMonth.value);
    const d = await api<any>("clinic-selfpay/prices/import", { method: "POST", body: form });
    const months = (d.importedMonths || []).join("、") || yearMonth.value;
    const skipped = d.skippedClosedMonths?.length ? `；已略過關帳月份：${d.skippedClosedMonths.join("、")}` : "";
    priceMessage.value = `✅ 月價匯入成功：${d.imported} 筆，匯入月份：${months}${skipped}${d.warning ? `；${d.warning}` : ""}`;
    await loadMappings();
  } catch (e: any) {
    priceMessage.value = `❌ 月價匯入失敗：${e.message}`;
  } finally {
    props.tab.busy = false;
    el.value = "";
  }
}
async function toggleClose() {
  if (props.tab.busy) return;
  props.tab.busy = true;
  mappingMessage.value = "";
  try {
    const d = await api<{ action: string }>("clinic-selfpay/mappings/close", { method: "POST", body: JSON.stringify({ store_id: storeId.value, year_month: yearMonth.value }) });
    mappingMessage.value = d.action === "reopened" ? `✅ ${yearMonth.value} 主檔已開帳` : `✅ ${yearMonth.value} 主檔已關帳`;
    closeAsk.value = false;
    await loadMappings();
  } catch (e: any) {
    closeAsk.value = false;
    mappingMessage.value = `❌ 主檔狀態更新失敗：${e.message}`;
  } finally {
    props.tab.busy = false;
  }
}
async function openHistory(row: Mapping) {
  historyTarget.value = row;
  historyRows.value = [];
  loadingHistory.value = true;
  try {
    const d = await api<{ items: History[] }>(`clinic-selfpay/mappings/history?store_id=${encodeURIComponent(storeId.value)}&health_insurance_code=${encodeURIComponent(row.health_insurance_code)}`);
    historyRows.value = d.items;
  } catch (e: any) {
    mappingMessage.value = `載入歷史價格失敗：${e.message}`;
    historyTarget.value = null;
  } finally {
    loadingHistory.value = false;
  }
}
function refresh() {
  void init().then(() => {
    void loadBatches();
    void loadMappings();
  });
}
onMounted(() => {
  window.addEventListener("paste", onPaste);
  void init().then(() => {
    void loadBatches();
    void loadMappings();
  });
});
</script>

<template>
  <section ref="root" class="clinic-page" data-testid="clinic-selfpay">
    <header class="page-heading">
      <div>
        <small>組織與門市 / 診所自費藥</small>
        <h1>診所自費藥毛利計算</h1>
        <p>匯入診所自費藥檔與健保系統截圖，依當月 DPOS 會員價與成本計算藥費與毛利；月價格檔在「DPOS 對應主檔」分頁匯入。</p>
      </div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="loading" role="status">載入中…</p>

    <template v-else>
      <section class="filters" aria-label="門市與年月">
        <label
          >門市
          <select v-model="storeId" data-testid="store-select" :disabled="tab.busy || stores.length <= 1">
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.store_code }} {{ s.store_name }}</option>
          </select>
        </label>
        <label
          >年月
          <input v-model="yearMonth" type="month" data-testid="month-input" :disabled="tab.busy" />
        </label>
        <button type="button" :disabled="tab.busy" data-testid="refresh" @click="refresh">重新整理</button>
      </section>
      <p v-if="!stores.length" class="notice" data-testid="no-store">目前帳號沒有可操作的門市。管理者需先在「店長指派」把你指派到門市；非管理員帳號只能看自己被指派的門市。</p>

      <div class="tabs" role="tablist">
        <button v-if="access.canUseCalculator" role="tab" :aria-selected="activeTab === 'calc'" :class="{ on: activeTab === 'calc' }" data-testid="tab-calc" @click="activeTab = 'calc'">毛利計算</button>
        <button v-if="access.canManageMapping" role="tab" :aria-selected="activeTab === 'mapping'" :class="{ on: activeTab === 'mapping' }" data-testid="tab-mapping" @click="activeTab = 'mapping'">DPOS 對應主檔</button>
      </div>

      <!-- ===== 毛利計算 ===== -->
      <template v-if="activeTab === 'calc' && access.canUseCalculator">
        <section class="box" aria-label="匯入診所自費藥檔">
          <h2>步驟 1：匯入診所自費藥檔</h2>
          <p class="hint">支援健保系統 .xls／.xlsx 匯出。系統讀取 A 欄藥品資訊，優先使用 M 欄總量（舊格式可回退 L、K、J、N 欄）。檔案內的結算期間會決定歸屬年月。</p>
          <div class="field">
            <span class="label">診所自費藥檔</span>
            <label class="file-label"
              ><span data-testid="claim-name">{{ claimFile ? claimFile.name : "選擇診所檔案" }}</span
              ><input ref="claimInput" type="file" accept=".xlsx,.xls" data-testid="claim-file" :disabled="tab.busy" @change="chooseClaim"
            /></label>
          </div>
          <div class="field">
            <span class="label">健保系統截圖（必填，最多 {{ SCREENSHOT_MAX_COUNT }} 張）</span>
            <label class="file-label"
              ><span>{{ shots.length ? `已選擇 ${shots.length} 張截圖，再加` : "上傳截圖" }}</span
              ><input ref="shotInput" type="file" accept="image/png,image/jpeg,image/webp" multiple data-testid="shot-input" :disabled="tab.busy" @change="pickShots"
            /></label>
            <small>可一次選多張，或先用螢幕截圖後直接按 Ctrl+V 貼上。只收 png、jpeg、webp，上傳前會自動縮小。</small>
            <div v-if="shots.length" class="thumbs" data-testid="shot-list">
              <figure v-for="(f, i) in shots" :key="f.name + i" data-testid="shot-thumb">
                <img :src="shotUrls[i]" :alt="`截圖預覽 ${i + 1}`" />
                <button type="button" :disabled="tab.busy" :aria-label="`刪除截圖 ${i + 1}`" @click="removeShot(i)">✕</button>
                <figcaption>{{ i + 1 }}. {{ f.name }}</figcaption>
              </figure>
              <button type="button" :disabled="tab.busy" @click="clearShots">清空截圖</button>
            </div>
          </div>
          <button class="primary" data-testid="import-btn" :disabled="tab.busy || !claimFile || !storeId || !shots.length" @click="submitImport">{{ tab.busy ? "處理中…" : "匯入並計算毛利" }}</button>
          <p v-if="batchMessage" class="notice pre" data-testid="batch-message" role="status">{{ batchMessage }}</p>
          <div v-if="unmatched.length" class="module-table" data-testid="unmatched-list">
            <table>
              <caption>價格主檔找不到的藥品（整批未匯入，請把這份清單給營業部匯入 DPOS 商品主檔）</caption>
              <thead><tr><th>健保代碼</th><th>藥品名稱</th></tr></thead>
              <tbody>
                <tr v-for="u in unmatched" :key="u.code + u.name" data-testid="unmatched-row"><td>{{ u.code }}</td><td>{{ u.name }}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="grid2">
          <section class="box" aria-label="歷史匯入紀錄">
            <h2>歷史匯入紀錄（依門市）</h2>
            <p v-if="loadingBatches" role="status">載入中…</p>
            <p v-else-if="!batches.length" data-testid="no-batches">目前門市尚無匯入紀錄</p>
            <div v-else class="module-table">
              <table data-testid="batch-table">
                <thead>
                  <tr><th>診所機構代碼</th><th>月份</th><th class="num">自費藥總額</th><th class="num">毛利總額</th><th v-if="access.canDeleteBatch">操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="b in batches" :key="b.id" class="click" data-testid="batch-row" :data-batch="b.id" tabindex="0" @click="openReport(b.id)" @keydown.enter="openReport(b.id)">
                    <td>{{ b.clinic_code || "-" }}</td>
                    <td>{{ b.year_month }}</td>
                    <td class="num">{{ money1(b.total_billing_amount) }}</td>
                    <td class="num">{{ money1(b.total_gross_profit_amount) }}</td>
                    <td v-if="access.canDeleteBatch"><button class="danger" type="button" :disabled="tab.busy" data-testid="delete-batch" @click.stop="deleteTarget = b; deleteError = ''">刪除</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="box" aria-label="計算結果">
            <h2>計算結果</h2>
            <p v-if="loadingReport" role="status">載入中…</p>
            <p v-if="!report" class="empty">匯入完成後，會在這裡顯示會員價總額、毛利總額與未匹配清單。</p>
            <template v-else>
              <div class="cards" data-testid="report-summary">
                <div><small>品項數</small><strong data-testid="sum-items">{{ report.summary.itemCount }}</strong></div>
                <div><small>匹配成功</small><strong data-testid="sum-matched">{{ report.summary.matchedCount }}</strong></div>
                <div><small>未匹配</small><strong data-testid="sum-unmatched">{{ report.summary.unmatchedCount }}</strong></div>
                <div><small>總毛利</small><strong data-testid="sum-profit">{{ money1(report.summary.totalGrossProfit) }}</strong></div>
              </div>
              <div class="info" data-testid="report-info">
                <div>診所：{{ report.batch.clinic_name || "-" }}（{{ report.batch.clinic_code || "-" }}）</div>
                <div>期間：{{ report.batch.period_start || "-" }} ~ {{ report.batch.period_end || "-" }}</div>
                <div>會員價總額：<span data-testid="sum-billing">{{ money1(report.summary.totalBilling) }}</span>　/　總數量：{{ money(report.summary.totalQty) }}</div>
                <div>截圖：{{ report.screenshotUrls.length }} 張</div>
              </div>
              <div class="actions report-actions">
                <button type="button" data-testid="open-lightbox" :disabled="!report.screenshotUrls.length" @click="lightboxOpen = true">回看截圖{{ report.screenshotUrls.length ? `（${report.screenshotUrls.length}）` : "" }}</button>
                <button type="button" data-testid="export-pdf" :disabled="pdfBusy || tab.busy" @click="exportPdf">{{ pdfBusy ? "匯出中…" : "診所請款明細PDF" }}</button>
              </div>
              <div class="module-table">
                <table data-testid="report-table">
                  <thead>
                    <tr><th>健保代碼</th><th>藥品名稱</th><th class="num">數量</th><th>品號</th><th class="num">會員價</th><th class="num">成本</th><th class="num">總額</th><th class="num">毛利</th><th>狀態</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="it in report.items" :key="it.id" :class="{ bad: it.match_status === 'unmatched' }" data-testid="report-row">
                      <td>{{ it.health_insurance_code }}</td>
                      <td>{{ it.drug_name || "-" }}</td>
                      <td class="num">{{ money(it.qty) }}</td>
                      <td>{{ it.matched_product_code || "-" }}</td>
                      <td class="num">{{ it.matched_member_price == null ? "-" : money(it.matched_member_price) }}</td>
                      <td class="num" data-testid="cell-cost">{{ it.matched_cost_price == null ? "-" : money(it.matched_cost_price) }}</td>
                      <td class="num">{{ money(it.billing_amount) }}</td>
                      <td class="num" data-testid="cell-profit">{{ money(it.gross_profit_amount) }}</td>
                      <td>{{ it.match_status === "matched" ? "匹配" : "未匹配" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </section>
        </div>
      </template>
      <p v-else-if="activeTab === 'calc'" class="notice error">目前帳號無毛利計算操作權限，請聯繫管理者開通。</p>

      <!-- ===== DPOS 對應主檔 ===== -->
      <section v-if="activeTab === 'mapping' && access.canManageMapping" class="box" aria-label="DPOS 對應主檔">
        <h2>診所自費藥與 DPOS 商品對應主檔</h2>
        <div class="import-box">
          <h3>匯入月價格檔（DPOS）</h3>
          <p class="hint">
            欄位：健保碼｜自費藥名稱｜品號｜品名｜會員價｜成本。系統讀取工作表名稱 YYYY-MM 作為匯入月份（沒有月份工作表就用上面選的年月）；同月同健保碼保留檔案中最後一筆；已關帳的月份會略過。
          </p>
          <label class="file-label"
            ><span>{{ tab.busy ? "匯入中…" : "選擇月價格 Excel" }}</span
            ><input ref="priceInput" type="file" accept=".xlsx,.xls" data-testid="price-file" :disabled="tab.busy || !storeId || !yearMonth" @change="importPrices"
          /></label>
          <span class="hint">目前檢視月份：{{ yearMonth }}</span>
          <p v-if="priceMessage" class="notice pre" data-testid="price-message" role="status">{{ priceMessage }}</p>
        </div>
        <div class="close-bar">
          <span class="badge" :class="isClosed ? 'ok' : 'warn'" data-testid="closed-badge">{{ isClosed ? `${yearMonth} 已關帳` : `${yearMonth} 未關帳` }}</span>
          <button type="button" data-testid="close-btn" :disabled="tab.busy || !storeId || !yearMonth || !mappings.length" @click="closeAsk = true">{{ isClosed ? "開帳主檔" : "關帳主檔" }}</button>
        </div>
        <p v-if="mappingMessage" class="notice pre" data-testid="mapping-message" role="status">{{ mappingMessage }}</p>
        <p v-if="loadingMappings" role="status">載入中…</p>
        <p v-else-if="!mappings.length" data-testid="no-mappings">目前門市尚無這個月的對應主檔資料，請先匯入月價格檔。</p>
        <div v-else class="module-table">
          <table data-testid="mapping-table">
            <thead><tr><th>DPOS 品號</th><th>DPOS 品名</th><th>診所藥品健保碼</th><th>診所開立藥品名稱</th><th>主檔月份</th></tr></thead>
            <tbody>
              <tr v-for="m in mappings" :key="m.health_insurance_code + m.product_code" class="click" data-testid="mapping-row" tabindex="0" @click="openHistory(m)" @keydown.enter="openHistory(m)">
                <td>{{ m.product_code || "-" }}</td><td>{{ m.product_name || "-" }}</td><td>{{ m.health_insurance_code }}</td><td>{{ m.drug_name || "-" }}</td><td>{{ m.latest_year_month || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">點一列可看歷史會員價與成本。</p>
      </section>
    </template>
  </section>

  <ImageLightbox v-if="lightboxOpen && report?.screenshotUrls.length" :urls="report.screenshotUrls" @close="lightboxOpen = false" />
  <Modal v-if="confirm" :title="confirm.code === 'PERIOD_MISMATCH' ? '檔案期間與選的年月不同' : '已有相同的匯入批次'" :busy="tab.busy" @cancel="answerConfirm(false)">
    <div data-testid="confirm-dialog" :data-code="confirm.code">
      <p class="pre" data-testid="confirm-message">{{ confirm.message }}</p>
      <ul v-if="confirm.existing?.length" class="plain">
        <li v-for="e in confirm.existing" :key="e.id">{{ e.imported_at?.slice(0, 16).replace("T", " ") }}　{{ e.source_file_name || "" }}　{{ e.item_count }} 筆</li>
      </ul>
    </div>
    <footer class="actions end">
      <button type="button" data-testid="confirm-cancel" :disabled="tab.busy" @click="answerConfirm(false)">取消</button>
      <button type="button" class="primary" data-testid="confirm-ok" :disabled="tab.busy" @click="answerConfirm(true)">確定匯入</button>
    </footer>
  </Modal>
  <Modal v-if="deleteTarget" title="刪除匯入批次" :busy="tab.busy" @cancel="deleteTarget = null">
    <p v-if="deleteError" role="alert" class="notice error" data-testid="delete-error">{{ deleteError }}</p>
    <p>確認刪除這個批次（{{ deleteTarget.clinic_code || "-" }}／{{ deleteTarget.year_month }}）？明細與截圖會一併刪除，不可復原，店長需重新上傳。</p>
    <footer class="actions end">
      <button type="button" :disabled="tab.busy" @click="deleteTarget = null">取消</button>
      <button type="button" class="danger" data-testid="delete-confirm" :disabled="tab.busy" @click="removeBatch">{{ tab.busy ? "處理中…" : "確認刪除" }}</button>
    </footer>
  </Modal>
  <Modal v-if="closeAsk" :title="isClosed ? '開帳主檔' : '關帳主檔'" :busy="tab.busy" @cancel="closeAsk = false">
    <p>{{ isClosed ? `確認將 ${yearMonth} 的 DPOS 對應主檔開帳？開帳後可再次匯入同年月分頁覆蓋資料。` : `確認將 ${yearMonth} 的 DPOS 對應主檔關帳？關帳後再次匯入同年月分頁將不會覆蓋。` }}</p>
    <footer class="actions end">
      <button type="button" :disabled="tab.busy" @click="closeAsk = false">取消</button>
      <button type="button" class="primary" data-testid="close-confirm" :disabled="tab.busy" @click="toggleClose">{{ tab.busy ? "處理中…" : "確認" }}</button>
    </footer>
  </Modal>
  <Modal v-if="historyTarget" title="歷史會員價與成本" :busy="false" wide @cancel="historyTarget = null">
    <p>診所藥品健保碼：{{ historyTarget.health_insurance_code }}｜診所開立藥品名稱：{{ historyTarget.drug_name || "-" }}</p>
    <p v-if="loadingHistory" role="status">載入中…</p>
    <p v-else-if="!historyRows.length">尚無歷史資料。</p>
    <div v-else class="module-table">
      <table data-testid="history-table">
        <thead><tr><th>月份</th><th>DPOS 品號</th><th>DPOS 品名</th><th class="num">會員價</th><th class="num">成本</th></tr></thead>
        <tbody>
          <tr v-for="(h, i) in historyRows" :key="h.year_month + i" data-testid="history-row">
            <td>{{ h.year_month }}</td><td>{{ h.product_code || "-" }}</td><td>{{ h.product_name || "-" }}</td><td class="num">{{ money(h.member_price) }}</td><td class="num">{{ money(h.cost_price) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer class="actions end"><button type="button" @click="historyTarget = null">關閉</button></footer>
  </Modal>
</template>

<style scoped>
.page-heading { margin-bottom: 18px; }
.page-heading p, small, .hint, .empty { color: var(--muted); }
h1 { margin: 10px 0; }
h2 { margin: 0 0 8px; font-size: 1.1rem; }
h3 { margin: 0 0 6px; font-size: 1rem; }
.filters { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; margin-bottom: 14px; }
label { display: flex; flex-direction: column; gap: 6px; }
select, input[type="month"] { padding: 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); color: var(--ink); min-width: 180px; }
.tabs { display: flex; gap: 8px; margin: 10px 0 16px; flex-wrap: wrap; }
.tabs .on { background: var(--primary); color: #fff; }
.box { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 18px; background: var(--surface); }
.field { display: grid; gap: 6px; margin-bottom: 14px; }
.label { font-weight: 600; font-size: 0.9rem; }
.file-label { display: inline-flex; flex-direction: row; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 9px 14px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; position: relative; overflow: hidden; }
.file-label input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.thumbs { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; padding: 8px; background: var(--soft); border-radius: 6px; }
.thumbs figure { margin: 0; position: relative; width: 96px; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; background: var(--surface); }
.thumbs img { display: block; width: 100%; height: 64px; object-fit: cover; }
.thumbs figure button { position: absolute; top: 2px; right: 2px; padding: 0 6px; min-height: 0; line-height: 1.4; }
.thumbs figcaption { font-size: 0.7rem; padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grid2 { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
@media (min-width: 1100px) { .grid2 { grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); } }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 12px; }
.cards div { background: var(--soft); border-radius: 6px; padding: 10px; display: grid; gap: 2px; }
.cards strong { font-size: 1.25rem; }
.info { border: 1px solid var(--line); background: var(--soft); border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 0.9rem; line-height: 1.7; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--soft); white-space: nowrap; }
.num { text-align: right; }
caption { text-align: left; font-weight: 600; padding: 8px 0; }
tr.click { cursor: pointer; }
tr.click:hover, tr.click:focus-visible { background: var(--soft); }
tr.bad td { color: #a32a23; }
.module-table { overflow-x: auto; max-height: 560px; }
.import-box { border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 14px; background: var(--soft); display: grid; gap: 8px; }
.close-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.badge { padding: 3px 10px; border-radius: 999px; font-size: 0.85rem; }
.badge.ok { background: #dff3e4; color: #1d6b34; }
.badge.warn { background: #fdf0d2; color: #8a5a00; }
.notice { padding: 12px; border: 1px solid var(--primary); border-radius: 6px; background: var(--soft); }
.notice.pre, .pre { white-space: pre-line; }
.error, .danger { color: #a32a23; }
.actions { display: flex; gap: 9px; flex-wrap: wrap; }
.actions.end { justify-content: flex-end; margin-top: 16px; }
.report-actions { margin-bottom: 12px; }
.plain { padding-left: 18px; color: var(--muted); font-size: 0.9rem; }
</style>
