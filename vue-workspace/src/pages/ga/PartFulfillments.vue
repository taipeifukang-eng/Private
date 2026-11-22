<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { PO_STATUS_LABEL, money, num, storeText } from "../../lib/ga-requests";
import { EXCEPTION_TYPES, FULFILLMENT_STATUS_LABEL, fulfillmentLabel, remainingQuantity } from "../../../../lib/workspace/general-affairs/request-rules";
import type { WorkTab } from "../../stores";

// G17 料件處理中心：處理單的取得方式（出庫、調撥、採購）、待交付、送門市確認、異常時逐筆作廢舊單據後重選。
// 保留舊版 fulfillmentId 參數（開啟頁籤時 payload.fulfillmentId 會直接開啟該處理單）。沒有採購評估權限者看不到採購單金額與供應商。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);

type Doc = { id: string; document_type: string; document_id: string; document_no: string; quantity: number | null; status: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
type Ful = {
  id: string; fulfillment_no: string | null; request_id: string; status: string; requested_quantity: number | null; fulfilled_quantity: number; unit: string | null; current_step: string | null; notes: string | null;
  ready_to_deliver_at: string | null; created_at: string; updated_at: string; is_ready_to_deliver: boolean; status_label: string;
  request: { id: string; request_no: string; title: string; main_status: string; store: any; part: { name: string; part_code: string | null } | null } | null;
  documents: Doc[]; events: Array<{ id: string; title: string; description: string | null; created_at: string }>;
  abilities: { decide: boolean; deliver: boolean; reportException: boolean; voidDocuments: boolean; stockIssue: boolean; transfer: boolean; purchase: boolean };
};
const rows = ref<Ful[]>([]);
const total = ref(0);
const stats = ref<Record<string, number>>({});
const caps = ref({ manage: false, stockIssue: false, transfer: false, purchase: false, purchaseView: false });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const readyOnly = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || readyOnly.value));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (readyOnly.value) q.set("ready", "true");
    const res = await api<{ data: Ful[]; total: number; stats: Record<string, number>; capabilities: typeof caps.value }>("general-affairs/part-fulfillments?" + q);
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
watch([debounced, status, readyOnly], () => { page.value = 1; void load(); });
watch(page, load);
useRefreshOnActivate(props.tab, load);

function pickCard(kind: string) {
  const same = (kind === "ready" && readyOnly.value) || status.value === kind;
  status.value = "";
  readyOnly.value = false;
  if (same || kind === "all") return;
  if (kind === "ready") readyOnly.value = true;
  else status.value = kind;
}
const activeCard = computed(() => (readyOnly.value ? "ready" : status.value || "all"));
const cards = computed(() => [
  { id: "all", label: "全部", n: stats.value.all ?? 0 },
  { id: "PENDING_DECISION", label: "待決定", n: stats.value.PENDING_DECISION ?? 0 },
  { id: "ready", label: "待交付", n: stats.value.ready ?? 0 },
  { id: "PURCHASING", label: "採購中", n: stats.value.PURCHASING ?? 0 },
  { id: "WAITING_ARRIVAL", label: "等待到貨", n: stats.value.WAITING_ARRIVAL ?? 0 },
  { id: "EXCEPTION", label: "異常", n: stats.value.EXCEPTION ?? 0 },
  { id: "WAITING_STORE_CONFIRMATION", label: "待門市確認", n: stats.value.WAITING_STORE_CONFIRMATION ?? 0 },
  { id: "COMPLETED", label: "已完成", n: stats.value.COMPLETED ?? 0 },
]);

// ---- 詳情
const detailId = ref("");
const detail = ref<Ful | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const busy = ref(false);
const formError = ref("");
const stale = ref(false);
async function openDetail(id: string) {
  detailId.value = id;
  await loadDetail();
}
async function loadDetail() {
  detailLoading.value = true;
  detailError.value = "";
  try {
    const res = await api<{ data: Ful }>(`general-affairs/part-fulfillments/${detailId.value}`);
    detail.value = res.data;
    stale.value = false;
  } catch (e) {
    detailError.value = (e as Error).message;
  } finally {
    detailLoading.value = false;
  }
}
function closeDetail() { detailId.value = ""; detail.value = null; panel.value = ""; formError.value = ""; }
onMounted(async () => {
  await load();
  const id = String((props.tab.payload as { fulfillmentId?: string } | undefined)?.fulfillmentId || "");
  if (id && allowed.value) { props.tab.payload = {}; await openDetail(id); }
});
watch(() => (props.tab.payload as { fulfillmentId?: string } | undefined)?.fulfillmentId, (v) => { if (v) { props.tab.payload = {}; void openDetail(v); } });

type Panel = "" | "exception" | "void" | "document";
const panel = ref<Panel>("");
const ex = reactive({ type: "少收" as string, note: "" });
const voidTarget = ref<Doc | null>(null);
const voidReason = ref("");
const docView = ref<any | null>(null);

async function post(path: string, body: Record<string, unknown>, done: string) {
  if (busy.value || !detail.value) return false;
  busy.value = true;
  formError.value = "";
  try {
    await api(`general-affairs/part-fulfillments/${detail.value.id}/${path}`, { method: "POST", body: JSON.stringify({ ...body, expected_updated_at: detail.value.updated_at }) });
    notice.value = done;
    panel.value = "";
    await Promise.all([loadDetail(), load()]);
    return true;
  } catch (e) {
    formError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") stale.value = true;
    return false;
  } finally {
    busy.value = false;
  }
}
const decide = (d: "STOCK_ISSUE" | "TRANSFER" | "PURCHASE") => post("decision", { decision: d }, "處理方式已儲存。");
const deliver = () => post("deliver", {}, "已送門市確認，需求單與處理單一起進入「待門市確認」。");
async function submitException() {
  if (!ex.note.trim()) { formError.value = "請說明實際狀況"; return; }
  if (await post("exception", { type: ex.type, note: ex.note.trim() }, "異常已登記，可逐筆作廢舊單據後重新選擇處理方式。")) ex.note = "";
}
function startVoid(d: Doc) { voidTarget.value = d; voidReason.value = ""; formError.value = ""; panel.value = "void"; }
async function submitVoid() {
  if (busy.value || !voidTarget.value || !detail.value) return;
  if (!voidReason.value.trim()) { formError.value = "作廢單據必須填寫原因"; return; }
  busy.value = true;
  formError.value = "";
  try {
    await api(`general-affairs/part-fulfillments/${detail.value.id}/documents/${voidTarget.value.id}/void`, { method: "POST", body: JSON.stringify({ reason: voidReason.value.trim() }) });
    notice.value = `單據 ${voidTarget.value.document_no} 已作廢，已承諾量已釋放（庫存不會自動沖回，要沖回請到庫存做調整）。`;
    panel.value = "";
    await Promise.all([loadDetail(), load()]);
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function viewDoc(d: Doc) {
  formError.value = "";
  try {
    const res = await api<{ data: any }>(`general-affairs/part-fulfillments/documents/${d.document_type}/${d.document_id}`);
    docView.value = { ...res.data, _type: d.document_type };
    panel.value = "document";
  } catch (e) {
    formError.value = (e as Error).message;
  }
}
const DOC_LABEL: Record<string, string> = { STOCK_ISSUE: "出庫單", TRANSFER: "調撥單", PURCHASE: "採購單" };
const activeDocs = computed(() => (detail.value?.documents || []).filter((d) => !d.voided_at));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>料件處理中心</h1>
      <p class="muted">料件需求的取得方式與進度。收貨或出庫達到需求量後會顯示「待交付」，由總務按「送門市確認」，需求單與處理單才一起往下。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '料件處理中心']">
    <p v-if="notice" class="notice success" role="status" data-testid="fl-notice">{{ notice }}</p>
    <ul class="stat-cards" aria-label="處理單統計">
      <li v-for="c in cards" :key="c.id" :class="{ on: activeCard === c.id, alert: c.id === 'EXCEPTION' && c.n > 0 }">
        <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ c.n }}</strong></button>
      </li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="需求單號、標題" /></label>
      <label>狀態<select v-model="status" aria-label="狀態" @change="readyOnly = false"><option value="">全部狀態</option><option v-for="(l, k) in FULFILLMENT_STATUS_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="fl-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="fl-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="fl-list" aria-label="處理單清單">
      <li v-for="r in rows" :key="r.id" class="fl-card" :class="{ ready: r.is_ready_to_deliver }" data-testid="fl-card">
        <div class="card-head"><strong>{{ r.request?.request_no }}</strong><span class="st" :data-status="r.status" data-testid="fl-status">{{ fulfillmentLabel(r) }}</span></div>
        <p class="card-line">{{ r.request?.title }}</p>
        <p class="card-line muted">{{ storeText(r.request?.store) }}　{{ r.request?.part?.name }}　已處理 {{ num(r.fulfilled_quantity) }} / {{ num(r.requested_quantity) }} {{ r.unit }}</p>
        <p v-if="r.current_step" class="card-line">{{ r.current_step }}</p>
        <p class="card-line muted">更新 {{ fmtTime(r.updated_at) }}</p>
        <button type="button" data-testid="open-detail" @click="openDetail(r.id)">查看與處理</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的處理單" : loaded ? "目前沒有處理單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="detailId" :title="detail ? `處理單 ${detail.request?.request_no}` : '處理單'" :busy="busy" wide @cancel="closeDetail">
      <div class="fd" data-testid="fulfillment-detail">
        <p v-if="detailLoading && !detail" role="status">載入中…</p>
        <p v-if="detailError" class="notice error" role="alert" data-testid="fd-error">{{ detailError }}</p>
        <template v-if="detail">
          <p><span class="st" :data-status="detail.status" data-testid="fd-status">{{ fulfillmentLabel(detail) }}</span>　{{ detail.request?.title }}　{{ storeText(detail.request?.store) }}</p>
          <p class="muted">需求 {{ detail.request?.part?.name }} × {{ num(detail.requested_quantity) }} {{ detail.unit }}；已處理 <strong data-testid="fd-fulfilled">{{ num(detail.fulfilled_quantity) }}</strong>，還差 {{ num(remainingQuantity(detail)) }}。{{ detail.current_step }}</p>
          <p v-if="detail.is_ready_to_deliver" class="notice" role="status" data-testid="fd-ready">已達需求量，等待交付。請確認料件已交到門市後，按「送門市確認」。</p>
          <div class="fd-actions">
            <template v-if="detail.abilities.decide">
              <button type="button" data-testid="decide-stock" :disabled="busy" @click="decide('STOCK_ISSUE')">改用庫存出庫</button>
              <button type="button" data-testid="decide-transfer" :disabled="busy" @click="decide('TRANSFER')">改用調撥</button>
              <button type="button" data-testid="decide-purchase" :disabled="busy" @click="decide('PURCHASE')">改用採購</button>
            </template>
            <button v-if="detail.abilities.deliver" type="button" class="primary" data-testid="deliver" :disabled="busy" @click="deliver">送門市確認</button>
            <button v-if="detail.abilities.reportException" type="button" data-testid="open-exception" @click="panel = 'exception'; formError = ''">登記異常</button>
            <button type="button" data-testid="open-request" @click="openGaPage('ga-requests')">開啟需求單工作台</button>
          </div>
          <p v-if="detail.abilities.stockIssue || detail.abilities.transfer || detail.abilities.purchase" class="muted">取得方式的實際單據：出庫請到需求單工作台按「庫存出庫」；調撥請到「調撥與收貨」建單（帶入需求單）；採購請在需求單工作台做採購評估，系統會自動產生草稿採購單。</p>
          <p v-if="formError && !panel" class="field-error" role="alert" data-testid="fd-form-error">{{ formError }}</p>
          <p v-if="stale" class="notice" role="alert"><button type="button" data-testid="reload-stale" @click="loadDetail">重新載入最新內容</button></p>

          <section v-if="panel === 'exception'" class="fd-form" data-testid="exception-form">
            <h4>登記異常</h4>
            <label>異常類型<select v-model="ex.type" data-testid="ex-type"><option v-for="t in EXCEPTION_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
            <label>實際狀況（必填）<textarea v-model="ex.note" rows="3" maxlength="500" data-testid="ex-note" /></label>
            <p v-if="formError" class="field-error" role="alert" data-testid="ex-error">{{ formError }}</p>
            <div class="dialog-actions"><button type="button" :disabled="busy" @click="panel = ''">取消</button><button type="button" class="primary" :disabled="busy" data-testid="ex-submit" @click="submitException">登記異常</button></div>
          </section>
          <section v-if="panel === 'void' && voidTarget" class="fd-form" data-testid="void-form">
            <h4>作廢單據 {{ voidTarget.document_no }}</h4>
            <p class="muted">作廢只會釋放已承諾量並取消連結（採購單會一併取消，已到貨的不能取消）；已出庫的庫存不會自動沖回，要沖回請到庫存做調整。</p>
            <label>作廢原因（必填）<input v-model="voidReason" maxlength="500" data-testid="void-reason" /></label>
            <p v-if="formError" class="field-error" role="alert" data-testid="void-error">{{ formError }}</p>
            <div class="dialog-actions"><button type="button" :disabled="busy" @click="panel = ''">取消</button><button type="button" class="primary" :disabled="busy" data-testid="void-submit" @click="submitVoid">確定作廢</button></div>
          </section>
          <section v-if="panel === 'document' && docView" class="fd-form" data-testid="document-view">
            <h4>{{ DOC_LABEL[docView._type] }}　{{ docView.transaction_no || docView.transfer_no || docView.po_no || docView.purchase_no }}</h4>
            <p v-if="docView.status">狀態：{{ PO_STATUS_LABEL[docView.status] || docView.status }}</p>
            <p v-if="docView.vendor_name" data-testid="doc-vendor">供應商：{{ docView.vendor_name }}</p>
            <p v-if="docView.total_amount !== undefined" data-testid="doc-amount">含稅金額：{{ money(docView.total_amount) }}</p>
            <p v-if="docView.kind === 'PURCHASE_ORDER' && docView.vendor_name === undefined" class="muted" data-testid="doc-masked">您沒有採購評估權限，不顯示金額與供應商。</p>
            <ul v-if="docView.items" class="fd-items"><li v-for="(i, ix) in docView.items" :key="ix">{{ i.item_name }} × {{ num(i.quantity) }} {{ i.unit }}（已驗入 {{ num(i.received_qty) }}）</li></ul>
            <div class="dialog-actions"><button type="button" @click="panel = ''">關閉</button></div>
          </section>

          <h3>單據</h3>
          <div class="table-scroll"><table>
            <thead><tr><th>類型</th><th>單號</th><th>數量</th><th>狀態</th><th></th></tr></thead>
            <tbody>
              <tr v-for="d in detail.documents" :key="d.id" data-testid="fd-doc" :class="{ voided: d.voided_at }">
                <td>{{ DOC_LABEL[d.document_type] }}</td><td>{{ d.document_no }}</td><td>{{ num(d.quantity) }}</td>
                <td>{{ d.voided_at ? "已作廢" : d.document_type === "PURCHASE" ? PO_STATUS_LABEL[d.status || ""] || d.status : d.status }}<span v-if="d.void_reason" class="muted">（{{ d.void_reason }}）</span></td>
                <td><button type="button" data-testid="doc-view" @click="viewDoc(d)">查看</button> <button v-if="detail.abilities.voidDocuments && !d.voided_at" type="button" data-testid="doc-void" @click="startVoid(d)">作廢</button></td>
              </tr>
              <tr v-if="!detail.documents.length"><td colspan="5" class="empty">還沒有單據</td></tr>
            </tbody>
          </table></div>
          <p v-if="detail.status === 'EXCEPTION'" class="muted" data-testid="exception-hint">異常中：請逐筆作廢有問題的舊單據（{{ activeDocs.length }} 筆有效），再重新選擇處理方式。</p>
          <h3>處理紀錄</h3>
          <ol class="fd-events" data-testid="fd-events"><li v-for="e in detail.events" :key="e.id"><strong>{{ e.title }}</strong><span class="muted">　{{ fmtTime(e.created_at) }}</span><p v-if="e.description">{{ e.description }}</p></li></ol>
        </template>
        <div class="dialog-actions"><button type="button" data-testid="fd-close" @click="closeDetail">關閉</button></div>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 12px; min-height: 60px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.fl-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.fl-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.fl-card.ready { border-color: var(--primary); }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.fd { display: grid; gap: 10px; min-width: 0; }
.fd h3 { margin: 6px 0 0; font-size: 15px; }
.fd-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.fd-form { display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.fd-form h4 { margin: 0; }
.fd-form label { display: grid; gap: 4px; }
.fd-items { margin: 0; padding-left: 18px; }
.fd-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.fd-events li { border-left: 3px solid var(--line); padding-left: 10px; }
.fd-events p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
tr.voided td { opacity: 0.6; text-decoration: line-through; }
@media (max-width: 700px) {
  .fl-card button, .fd-actions button { min-height: 44px; }
  .fl-list { grid-template-columns: minmax(0, 1fr); }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
