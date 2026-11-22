<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import PoPicker from "../../components/ga/PoPicker.vue";
import ResourceAttachmentPanel from "../../components/ga/ResourceAttachmentPanel.vue";
import { openGaPage, useDebounced, useGaGuard } from "../../lib/ga";
import {
  INVOICE_TYPES, INVOICE_TYPE_LABELS, NO_TAX_TYPES, amountsOf, buyerMismatch, dateText, diffReasonRequired, emptyInvoiceForm, errorCodeOf, errorText, formFromInvoice,
  invoiceMissingImage, money, newKey, taipeiToday, timeText, type Invoice, type InvoiceForm, type PayAbilities, type PaySettings, type ReceiptOption,
} from "../../lib/ga-invoices";
import { useWorkspace, type WorkTab } from "../../stores";

// 第 4.5 批 進貨發票新增與編輯。類型決定欄位：三聯式、二聯式、電子發票填未稅金額（稅額依採購單稅率自動算，可手改尾差）；收據與免開發票只填含稅金額（稅額 0）。
// 因為附件要先有發票才能上傳，發票可以先存、再上傳圖片；缺圖的發票紅字標示、不能放進請款單。差異超過尾差、統編不符要填原因（仍可儲存）。
// 已被有效請款單引用的發票只能改備註與各項原因，金額、類型、號碼、連結的進貨單要先作廢或退回請款單。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const invoiceId = computed(() => props.tab.recordId || "");
const invoice = ref<Invoice | null>(null);
const abilities = ref<PayAbilities | null>(null);
const settings = ref<PaySettings>({ tolerance_amount: 5, buyer_title: null, buyer_tax_id: null, updated_at: null });
const form = reactive<InvoiceForm>(emptyInvoiceForm());
const links = ref<ReceiptOption[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const warnings = ref<string[]>([]);
const saved = ref(false);
const createKey = ref(newKey());
const forceTaxReason = ref(false);
const forceDiffReason = ref(false);
// 連結進貨單的搜尋與挑選
const rSearch = ref("");
const rDebounced = useDebounced(rSearch, 300);
const options = ref<ReceiptOption[]>([]);
const optionsError = ref("");
const optionsTotal = ref(0);
// 作廢
const voiding = ref(false);
const voidReason = ref("");
const voidError = ref("");
const voidKey = ref(newKey());
const voidBusy = ref(false);

const canManage = computed(() => !!abilities.value?.canManage);
const locked = computed(() => !!invoice.value && (invoice.value.status === "VOID" || invoice.value.referenced_by.length > 0));
const voided = computed(() => invoice.value?.status === "VOID");
const inUse = computed(() => !!invoice.value && invoice.value.status === "ACTIVE" && invoice.value.referenced_by.length > 0);
const noTax = computed(() => (NO_TAX_TYPES as readonly string[]).includes(form.invoice_type));
const rate = computed(() => (links.value.length ? Number(links.value[0].tax_rate) : 0.05));
const amounts = computed(() => amountsOf(form, rate.value));
const receiptsTotal = computed(() => links.value.reduce((s, r) => s + Number(r.receipt_total || 0), 0));
const tol = computed(() => Number(settings.value.tolerance_amount ?? 5));
/** 發票含稅額與連結進貨單含稅合計相差超過尾差。 */
const diffNeeded = computed(() => links.value.length > 0 && Number.isFinite(amounts.value.total) && diffReasonRequired(amounts.value.total, receiptsTotal.value, receiptsTotal.value, tol.value, links.value.length));
const taxMismatchNeeded = computed(() => buyerMismatch(form.invoice_type, form.buyer_tax_id, settings.value.buyer_tax_id) || forceTaxReason.value);
const showDiff = computed(() => diffNeeded.value || forceDiffReason.value || !!form.diff_reason);
const showTaxReason = computed(() => taxMismatchNeeded.value || !!form.tax_mismatch_reason);
const imageMissing = computed(() => !!invoice.value && invoiceMissingImage(form.invoice_type, form.no_image_reason, invoice.value.image_count));
const dateFuture = computed(() => !!form.invoice_date && form.invoice_date > taipeiToday());

function fillFrom(i: Invoice) {
  invoice.value = i;
  Object.assign(form, formFromInvoice(i));
  links.value = i.receipts.map((r) => ({
    receipt_id: r.receipt_id, receipt_no: r.receipt_no, received_date: r.received_date, delivery_note_no: null, voucher_status: "LINKED", po_id: r.po_id, po_no: r.po_no, vendor_id: i.vendor_id,
    vendor_name: i.vendor_name || "", tax_rate: Number(r.receipt_untaxed) > 0 ? Math.round((Number(r.receipt_total) / Number(r.receipt_untaxed) - 1) * 10000) / 10000 : 0.05,
    receipt_untaxed: r.receipt_untaxed, receipt_tax: Number(r.receipt_total) - Number(r.receipt_untaxed), receipt_total: r.receipt_total, invoices: [],
  }));
  props.tab.title = i.invoice_no ? `發票 ${i.invoice_no}` : "發票（免開發票）";
}
async function loadInvoice() {
  const res = await api<{ data: Invoice; permissions: PayAbilities }>(`general-affairs/purchase-invoices/${invoiceId.value}`);
  abilities.value = res.permissions;
  fillFrom(res.data);
}
onMounted(async () => {
  if (!allowed.value) { loading.value = false; return; }
  try {
    const meta = await api<{ permissions: PayAbilities; settings: PaySettings }>("general-affairs/purchase-invoices/meta");
    abilities.value = meta.permissions;
    settings.value = meta.settings;
    if (invoiceId.value) await loadInvoice();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
});

async function loadOptions() {
  if (!abilities.value?.canPickReceipts || locked.value) return;
  optionsError.value = "";
  try {
    const q = new URLSearchParams({ pageSize: "10" });
    if (rDebounced.value.trim()) q.set("q", rDebounced.value.trim());
    if (form.vendor_id) q.set("vendorId", form.vendor_id);
    else if (links.value.length) q.set("vendorId", links.value[0].vendor_id);
    const res = await api<{ data: ReceiptOption[]; total: number }>("general-affairs/purchase-invoices/receipt-options?" + q);
    options.value = res.data.filter((r) => !links.value.some((l) => l.receipt_id === r.receipt_id));
    optionsTotal.value = res.total;
  } catch (e) {
    optionsError.value = errorText(e);
    options.value = [];
  }
}
watch([rDebounced, () => form.vendor_id, () => links.value.length, abilities], () => { void loadOptions(); });
function addLink(r: ReceiptOption) {
  links.value.push(r);
  if (!form.vendor_id) { form.vendor_id = r.vendor_id; form.vendor_name = r.vendor_name; }
  props.tab.dirty = true;
}
function removeLink(id: string) {
  links.value = links.value.filter((l) => l.receipt_id !== id);
  props.tab.dirty = true;
}
const dirty = () => { props.tab.dirty = true; };
function pickVendor(v: any) { form.vendor_name = v?.name || ""; dirty(); }
function onType() {
  // 換類型：金額欄位依類型換一組，不沿用舊值以免誤算。
  form.amount_untaxed = ""; form.tax_amount = ""; form.tax_touched = false; form.amount_total = "";
  if (form.invoice_type === "NO_INVOICE") form.invoice_no = "";
  dirty();
}
function onUntaxed() { if (!form.tax_touched) form.tax_amount = ""; dirty(); }
function onTax() { form.tax_touched = String(form.tax_amount).trim() !== ""; dirty(); }

const opt = (v: string) => (v.trim() ? v.trim() : null);
function payload(): Record<string, unknown> {
  const a = amounts.value;
  const p: Record<string, unknown> = {
    invoice_type: form.invoice_type, invoice_no: noTax.value && form.invoice_type === "NO_INVOICE" ? null : opt(form.invoice_no), invoice_date: form.invoice_date || null,
    vendor_id: form.vendor_id || null, notes: opt(form.notes), diff_reason: opt(form.diff_reason), tax_mismatch_reason: opt(form.tax_mismatch_reason),
    no_image_reason: form.invoice_type === "RECEIPT" ? opt(form.no_image_reason) : null,
    receipts: links.value.map((l) => ({ receipt_id: l.receipt_id })),
  };
  if (abilities.value?.vendorVisible) p.seller_tax_id = opt(form.seller_tax_id);
  if (form.invoice_type === "TRIPLE") p.buyer_tax_id = opt(form.buyer_tax_id);
  if (a.noTax) p.amount_total = Number.isFinite(a.total) ? a.total : form.amount_total;
  else {
    p.amount_untaxed = Number.isFinite(a.untaxed) ? a.untaxed : form.amount_untaxed;
    if (form.tax_touched) p.tax_amount = Number.isFinite(a.tax) ? a.tax : form.tax_amount;
  }
  return p;
}
function problem() {
  if (!form.invoice_date && form.invoice_type !== "NO_INVOICE") return "請填寫發票日期";
  if (dateFuture.value) return `發票日期不能是未來的日期（今天是 ${taipeiToday()}）`;
  if (form.invoice_type !== "NO_INVOICE" && !noTax.value && !form.invoice_no.trim()) return "請填寫發票號碼";
  if (!form.vendor_id && !links.value.length) return "請選擇廠商，或連結進貨單（由進貨單帶出廠商）";
  if (!Number.isFinite(amounts.value.total)) return noTax.value ? "請輸入金額（含稅）" : "請輸入未稅金額";
  return "";
}
async function save() {
  if (saving.value || !allowed.value || !canManage.value) return;
  error.value = ""; warnings.value = []; saved.value = false;
  const p = problem();
  if (p) { error.value = p; return; }
  saving.value = true;
  try {
    if (!invoiceId.value) {
      const res = await api<{ data: Invoice; warnings: Array<{ message: string }> }>("general-affairs/purchase-invoices", { method: "POST", body: JSON.stringify({ ...payload(), idempotency_key: createKey.value }) });
      props.tab.recordId = res.data.id;
      fillFrom(res.data);
      warnings.value = res.warnings.map((w) => w.message);
    } else {
      const body: Record<string, unknown> = locked.value
        ? { notes: opt(form.notes), diff_reason: opt(form.diff_reason), tax_mismatch_reason: opt(form.tax_mismatch_reason) }
        : payload();
      const res = await api<{ data: Invoice; warnings: Array<{ message: string }> }>(`general-affairs/purchase-invoices/${invoiceId.value}`, { method: "PATCH", body: JSON.stringify({ ...body, expected_updated_at: invoice.value!.updated_at }) });
      fillFrom(res.data);
      warnings.value = res.warnings.map((w) => w.message);
    }
    saved.value = true;
    forceDiffReason.value = false; forceTaxReason.value = false;
    props.tab.dirty = false;
  } catch (e) {
    error.value = errorText(e);
    const code = errorCodeOf(e);
    // 伺服端判斷需要原因（例如賣方統編比對）：把原因欄位顯示出來讓使用者填。
    if (code === "TAX_MISMATCH_REASON_REQUIRED") forceTaxReason.value = true;
    if (code === "DIFF_REASON_REQUIRED") forceDiffReason.value = true;
    if (code === "STALE") error.value += "\n請按「重新載入」取得最新內容後再改。";
  } finally {
    saving.value = false;
  }
}
async function reload() {
  if (!invoiceId.value) return;
  try { await loadInvoice(); error.value = ""; props.tab.dirty = false; } catch (e) { error.value = errorText(e); }
}
async function onImages() {
  // 圖片增減會影響缺圖狀態：重新讀回發票（保留使用者尚未儲存的欄位，只更新圖片數與版本）。
  if (!invoiceId.value) return;
  try {
    const res = await api<{ data: Invoice }>(`general-affairs/purchase-invoices/${invoiceId.value}`);
    if (invoice.value) { invoice.value.image_count = res.data.image_count; invoice.value.missing_image = res.data.missing_image; invoice.value.updated_at = res.data.updated_at; }
  } catch { /* 圖片面板自己會顯示錯誤 */ }
}
function askVoid() { voiding.value = true; voidReason.value = ""; voidError.value = ""; voidKey.value = newKey(); }
async function confirmVoid() {
  if (!voidReason.value.trim()) { voidError.value = "請填寫作廢原因"; return; }
  voidBusy.value = true; voidError.value = "";
  try {
    const res = await api<{ data: Invoice }>(`general-affairs/purchase-invoices/${invoiceId.value}/actions`, {
      method: "POST", body: JSON.stringify({ action: "void", reason: voidReason.value.trim(), expected_updated_at: invoice.value!.updated_at, idempotency_key: voidKey.value }),
    });
    fillFrom(res.data);
    voiding.value = false;
  } catch (e) {
    voidError.value = errorText(e);
  } finally {
    voidBusy.value = false;
  }
}
function backToList() { openGaPage("ga-purchase-invoices"); work.remove([props.tab.id]); }
const typeHint = computed(() =>
  form.invoice_type === "RECEIPT" ? "收據沒有稅額，只填含稅金額。可以不上傳圖片，但要填「沒有圖片的原因」。"
  : form.invoice_type === "NO_INVOICE" ? "免開發票沒有稅額，只填含稅金額，不需要上傳圖片。"
  : "三聯式、二聯式、電子發票一定要上傳圖片，缺圖的發票不能放進請款單。");
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>{{ invoiceId ? "發票內容" : "新增發票" }}</h1>
      <p class="muted">{{ typeHint }}</p>
    </div>
    <button type="button" data-testid="inv-back" @click="backToList">回發票清單</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', invoiceId ? '發票內容' : '新增發票']">
    <p v-if="loading" role="status">載入中…</p>
    <p v-if="error" class="notice error pre" role="alert" data-testid="ie-error">{{ error }}<button v-if="invoiceId" type="button" data-testid="ie-reload" @click="reload">重新載入</button></p>
    <p v-if="saved" class="notice success" role="status" data-testid="ie-saved">已儲存。</p>
    <p v-for="(w, n) in warnings" :key="n" class="notice" role="status" data-testid="ie-warning">{{ w }}</p>
    <p v-if="voided" class="notice" role="status" data-testid="ie-voided">這張發票已作廢（{{ timeText(invoice?.voided_at) }}，{{ invoice?.voided_by_name || "—" }}）：{{ invoice?.void_reason }}</p>
    <p v-else-if="inUse" class="notice" role="status" data-testid="ie-inuse">這張發票已被請款單 {{ invoice?.referenced_by.map((r) => r.pr_no).join("、") }} 使用：類型、號碼、日期、金額與連結的進貨單不能改，只能改備註與各項原因；要作廢請先作廢或退回請款單。</p>
    <p v-if="invoice && imageMissing && !voided" class="notice error" role="status" data-testid="ie-missing">缺圖：這張發票還沒有上傳圖片，缺圖的發票不能放進請款單。</p>
    <p v-if="!loading && abilities && !canManage" class="notice" role="status" data-testid="ie-readonly">你只有查看權限，不能新增或修改發票。</p>

    <form v-if="!loading && (invoiceId ? invoice : true)" class="ie" data-testid="invoice-form" @submit.prevent="save">
      <section class="ie-box">
        <h2>發票資料</h2>
        <div class="ie-grid">
          <label>類型
            <select v-model="form.invoice_type" :disabled="locked || !canManage" data-testid="ie-type" @change="onType">
              <option v-for="t in INVOICE_TYPES" :key="t" :value="t">{{ INVOICE_TYPE_LABELS[t] }}</option>
            </select>
          </label>
          <label v-if="form.invoice_type !== 'NO_INVOICE'">{{ form.invoice_type === "RECEIPT" ? "收據號碼（選填）" : "發票號碼" }}<input v-model="form.invoice_no" maxlength="30" :disabled="locked || !canManage" data-testid="ie-no" @input="dirty" /></label>
          <label>{{ form.invoice_type === "NO_INVOICE" ? "日期（選填，預設今天）" : "發票日期" }}<input v-model="form.invoice_date" type="date" :max="taipeiToday()" :disabled="locked || !canManage" data-testid="ie-date" @input="dirty" /></label>
        </div>
        <p v-if="dateFuture" class="field-error" role="alert" data-testid="ie-date-future">發票日期不能是未來的日期（今天是 {{ taipeiToday() }}）。</p>
        <PoPicker v-if="abilities?.canPickReceipts && !links.length" v-model="form.vendor_id" kind="vendor" label="廠商（連結進貨單後會自動帶出）" testid="ie-vendor" :disabled="locked || !canManage" :initial="form.vendor_id ? { id: form.vendor_id, name: form.vendor_name } : null" @pick="pickVendor" />
        <p v-else class="muted" data-testid="ie-vendor-name">廠商：{{ form.vendor_name || links[0]?.vendor_name || "（連結進貨單後帶出）" }}</p>
        <div v-if="abilities?.vendorVisible" class="ie-grid">
          <label>賣方統編（不填就用採購單下訂時的廠商統編）<input v-model="form.seller_tax_id" inputmode="numeric" maxlength="8" :disabled="locked || !canManage" data-testid="ie-seller" @input="dirty" /></label>
          <label v-if="form.invoice_type === 'TRIPLE'">買受人統編（預設用設定的買受人）<input v-model="form.buyer_tax_id" inputmode="numeric" maxlength="8" :disabled="locked || !canManage" data-testid="ie-buyer" @input="dirty" /></label>
        </div>
        <label v-if="showTaxReason">統編不符的原因（統一編號與採購單或設定不符，要填原因，仍可儲存）<input v-model="form.tax_mismatch_reason" maxlength="200" :disabled="voided || !canManage" data-testid="ie-tax-reason" @input="dirty" /></label>
      </section>

      <section class="ie-box" data-testid="ie-amounts">
        <h2>金額</h2>
        <div v-if="noTax" class="ie-grid">
          <label>含稅金額（元）<input v-model="form.amount_total" inputmode="numeric" :disabled="locked || !canManage" data-testid="ie-total-input" @input="dirty" /></label>
        </div>
        <div v-else class="ie-grid">
          <label>未稅金額（元）<input v-model="form.amount_untaxed" inputmode="numeric" :disabled="locked || !canManage" data-testid="ie-untaxed" @input="onUntaxed" /></label>
          <label>稅額（依稅率 {{ Math.round(rate * 10000) / 100 }}% 自動算，可手改尾差）
            <input :value="form.tax_touched ? form.tax_amount : Number.isFinite(amounts.tax) ? String(amounts.tax) : ''" inputmode="numeric" :disabled="locked || !canManage" data-testid="ie-tax" @input="form.tax_amount = ($event.target as HTMLInputElement).value; onTax()" />
          </label>
        </div>
        <p data-testid="ie-total-line">含稅合計 <strong data-testid="ie-total">{{ Number.isFinite(amounts.total) ? money(amounts.total) : "—" }}</strong><span v-if="noTax" class="muted">（收據與免開發票沒有稅額）</span></p>
        <p v-if="links.length" class="muted" data-testid="ie-receipts-total">連結進貨單含稅合計 {{ money(receiptsTotal) }}（尾差容許 {{ money(tol) }}）</p>
        <label v-if="showDiff">差異原因（發票金額與進貨金額相差超過 {{ money(tol) }}，要填原因，仍可儲存）<input v-model="form.diff_reason" maxlength="200" :disabled="voided || !canManage" data-testid="ie-diff-reason" @input="dirty" /></label>
        <p v-else-if="links.length && Number.isFinite(amounts.total) && amounts.total !== receiptsTotal" class="muted" data-testid="ie-tail">相差 {{ money(Math.abs(amounts.total - receiptsTotal)) }}，在尾差容許內，不用填原因。</p>
      </section>

      <section class="ie-box" data-testid="ie-links">
        <h2>連結的進貨單</h2>
        <ul v-if="links.length" class="ie-links">
          <li v-for="l in links" :key="l.receipt_id" data-testid="ie-link">
            <span><strong>{{ l.receipt_no }}</strong>（採購單 {{ l.po_no }}，{{ dateText(l.received_date) }}）含稅 {{ money(l.receipt_total) }}</span>
            <button v-if="!locked && canManage" type="button" class="link" data-testid="ie-unlink" @click="removeLink(l.receipt_id)">移除</button>
          </li>
        </ul>
        <p v-else class="muted" data-testid="ie-no-links">還沒有連結進貨單。可以先存，之後再連結。</p>
        <template v-if="!locked && canManage && abilities?.canPickReceipts">
          <label>搜尋進貨單（採購單號、進貨單號、送貨單號）<input v-model="rSearch" type="search" data-testid="ie-receipt-search" /></label>
          <p v-if="optionsError" class="notice error" role="alert">{{ optionsError }}</p>
          <ul class="ie-links">
            <li v-for="o in options" :key="o.receipt_id" data-testid="ie-option">
              <span><strong>{{ o.receipt_no }}</strong>（{{ o.vendor_name }}，採購單 {{ o.po_no }}）含稅 {{ money(o.receipt_total) }}<template v-if="o.invoices.length"><span class="muted">；已連 {{ o.invoices.length }} 張發票</span></template></span>
              <button type="button" :data-testid="'ie-add-' + o.receipt_no" @click="addLink(o)">加入</button>
            </li>
          </ul>
          <p v-if="!options.length && !optionsError" class="muted">沒有可加入的進貨單。</p>
        </template>
        <p v-else-if="!locked && canManage" class="muted" data-testid="ie-no-pick">連結進貨單需要「採購評估檢視」權限，請洽有權限的同事。</p>
      </section>

      <section class="ie-box">
        <h2>備註</h2>
        <label v-if="form.invoice_type === 'RECEIPT'">沒有圖片的原因（收據可不傳圖，但要填原因）<input v-model="form.no_image_reason" maxlength="200" :disabled="locked || !canManage" data-testid="ie-noimg-reason" @input="dirty" /></label>
        <label>備註<textarea v-model="form.notes" rows="2" maxlength="500" :disabled="voided || !canManage" data-testid="ie-notes" @input="dirty" /></label>
      </section>

      <div class="dialog-actions">
        <button v-if="invoice && canManage && !voided" type="button" class="danger" :disabled="saving || inUse" data-testid="ie-void" @click="askVoid">作廢發票</button>
        <button type="button" :disabled="saving" @click="backToList">{{ invoiceId ? "返回" : "取消" }}</button>
        <button v-if="canManage && !voided" type="submit" class="primary" :disabled="saving" data-testid="ie-save">{{ saving ? "儲存中…" : "儲存發票" }}</button>
      </div>
    </form>

    <section v-if="invoice" class="ie-box" data-testid="ie-images">
      <ResourceAttachmentPanel resource-type="PURCHASE_INVOICE" :resource-id="invoice.id" purpose="INVOICE_IMAGE" title="發票圖片" :can-upload="canManage && !voided" :can-delete="canManage && !voided" @changed="onImages" />
      <p class="muted" data-testid="ie-image-count">目前 {{ invoice.image_count }} 張圖片。<template v-if="inUse">已被請款單使用，最後一張圖片不能刪除。</template></p>
    </section>

    <Modal v-if="voiding" title="作廢發票" :busy="voidBusy" @cancel="voiding = false">
      <p>作廢後這張發票不再計入，連結的進貨單會回到「尚未登錄憑證」。已被請款單使用的發票不能作廢。</p>
      <label>作廢原因<input v-model="voidReason" maxlength="200" aria-label="作廢原因" data-testid="void-reason" /></label>
      <p v-if="voidError" class="field-error" role="alert" data-testid="void-error">{{ voidError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="voidBusy" @click="voiding = false">取消</button>
        <button type="button" class="primary" :disabled="voidBusy" data-testid="void-confirm" @click="confirmVoid">{{ voidBusy ? "處理中…" : "確認作廢" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.ie { display: grid; gap: 14px; min-width: 0; }
.ie-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; margin-bottom: 14px; }
.ie-box h2 { margin: 0; font-size: 16px; }
.ie-box label { display: grid; gap: 4px; min-width: 0; }
.ie-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.ie-links { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ie-links li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
.pre { white-space: pre-wrap; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .dialog-actions button, .ie-links button { min-height: 44px; } }
</style>
