<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import {
  EVENT_LABELS, PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_CLASS, PR_STATUS_LABELS, availableActions, bankText, checkClaimLimit, dateText, errorCodeOf, errorText,
  holdsQuota, isEditable, lineDiffReasonRequired, money, newKey, timeText, voidReasonRequired, type Candidate, type PayAbilities, type PaymentRequest, type PrAction,
} from "../../lib/ga-payments";
import { INVOICE_TYPE_LABELS, calcTax, taipeiToday } from "../../lib/ga-invoices";
import { useWorkspace, type WorkTab } from "../../stores";

// 第 4.5 批 請款單建立、編輯與檢視。只能選「可請款進貨」（有驗收、未作廢、尚有請款額度）；採購單、進貨單、發票逐品項並排。
// 累計請款超過累計驗入含稅額加尾差會被直接擋下（不能填原因過關）；與發票分攤額相差超過尾差要填差異原因（仍可送出）。
// 按鈕依狀態與權限：草稿可儲存、送出、重抓廠商帳號、作廢；已送出可退回草稿、標已付款、作廢；已付款鎖定，只剩備註與作廢；已作廢唯讀。
// 沒有核准關卡；申請人可自己標已付款，每個動作都寫入不可修改的操作紀錄。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const prId = computed(() => props.tab.recordId || "");
const pr = ref<PaymentRequest | null>(null);
const abilities = ref<PayAbilities | null>(null);
const tolerance = ref(5);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref("");
const createKey = ref(newKey());

type FormLine = {
  receipt_id: string; receipt_no: string; po_id: string; po_no: string; tax_rate: number; received_date: string; receipt_total: number; receipt_untaxed: number;
  po_received_total: number; po_claimed_total: number; known: boolean; invoices: Candidate["invoices"]; invoice_id: string; claim_untaxed: string; claim_tax: string; tax_touched: boolean; diff_reason: string;
};
const lines = ref<FormLine[]>([]);
const vendorId = ref("");
const vendorName = ref("");
const expectedPayDate = ref("");
const notes = ref("");
const candidates = ref<Candidate[]>([]);
const candError = ref("");
const search = ref("");

const canManage = computed(() => !!abilities.value?.canManage);
const status = computed(() => pr.value?.status ?? "DRAFT");
const creating = computed(() => !prId.value);
const editing = computed(() => canManage.value && (creating.value || isEditable(status.value)));
const actions = computed(() => (pr.value ? availableActions(status.value, canManage.value) : []));
const intOf = (s: string) => (String(s ?? "").trim() === "" ? NaN : Number(String(s).replace(/,/g, "")));
const lineUntaxed = (l: FormLine) => (String(l.claim_untaxed).trim() === "" ? l.receipt_untaxed : intOf(l.claim_untaxed));
const lineTax = (l: FormLine) => (l.tax_touched && String(l.claim_tax).trim() !== "" ? intOf(l.claim_tax) : calcTax(lineUntaxed(l), l.tax_rate));
const lineTotal = (l: FormLine) => lineUntaxed(l) + lineTax(l);
const invoiceOf = (l: FormLine) => l.invoices.find((i) => i.id === l.invoice_id) || null;
const reference = (l: FormLine) => { const i = invoiceOf(l); return i ? i.allocated_total : null; };
const diffNeeded = (l: FormLine) => { const ref = reference(l); return ref !== null && Number.isFinite(lineTotal(l)) && lineDiffReasonRequired(lineTotal(l), ref, tolerance.value); };
const grandTotal = computed(() => lines.value.reduce((s, l) => s + (Number.isFinite(lineTotal(l)) ? lineTotal(l) : 0), 0));
/** 同一張採購單這張請款單合計要請的金額，對照累計驗入含稅額加尾差。 */
const overLimits = computed(() => {
  const out: string[] = [];
  const byPo = new Map<string, FormLine[]>();
  for (const l of lines.value) byPo.set(l.po_id, [...(byPo.get(l.po_id) || []), l]);
  for (const [, ls] of byPo) {
    if (!ls[0].known) continue; // 草稿原有明細沒有帶累計資料，交給伺服端把關
    const sum = ls.reduce((s, l) => s + (Number.isFinite(lineTotal(l)) ? lineTotal(l) : 0), 0);
    const res = checkClaimLimit(ls[0].po_received_total, ls[0].po_claimed_total, sum, tolerance.value);
    if (!res.ok) out.push(`採購單 ${ls[0].po_no}：累計請款會超過累計驗入含稅額 ${money(ls[0].po_received_total)}（可再請最多 ${money(res.remaining)}，含尾差 ${money(tolerance.value)}），超過 ${money(res.overBy)}，無法送出。`);
  }
  return out;
});
const missingDiff = computed(() => lines.value.some((l) => diffNeeded(l) && !l.diff_reason.trim()));

function toFormLine(c: Candidate): FormLine {
  const remainingForReceipt = Math.max(Number(c.receipt_total) - Number(c.receipt_claimed || 0), 0);
  const untaxed = remainingForReceipt === Number(c.receipt_total) ? Number(c.receipt_untaxed) : Math.max(Math.round(remainingForReceipt / (1 + Number(c.tax_rate))), 0);
  const okInv = c.invoices.filter((i) => !i.missing_image);
  return {
    receipt_id: c.receipt_id, receipt_no: c.receipt_no, po_id: c.po_id, po_no: c.po_no, tax_rate: Number(c.tax_rate), received_date: c.received_date, receipt_total: Number(c.receipt_total),
    receipt_untaxed: untaxed, po_received_total: Number(c.po_received_total), po_claimed_total: Number(c.po_claimed_total), known: true, invoices: c.invoices,
    invoice_id: okInv.length === 1 ? okInv[0].id : "", claim_untaxed: String(untaxed), claim_tax: "", tax_touched: false, diff_reason: "",
  };
}
function fillFrom(r: PaymentRequest) {
  pr.value = r;
  vendorId.value = r.vendor_id;
  vendorName.value = r.vendor_name_snapshot || "";
  expectedPayDate.value = r.expected_pay_date ? dateText(r.expected_pay_date) : "";
  notes.value = r.notes || "";
  lines.value = (r.lines || []).map((l) => ({
    receipt_id: l.receipt_id, receipt_no: l.receipt_no, po_id: l.po_id, po_no: l.po_no, tax_rate: Number(l.tax_rate), received_date: l.received_date, receipt_total: Number(l.receipt_total),
    receipt_untaxed: Number(l.receipt_untaxed), po_received_total: 0, po_claimed_total: 0, known: false,
    invoices: l.invoice_id ? [{ id: l.invoice_id, invoice_no: l.invoice_no, invoice_type: l.invoice_type || "", amount_total: Number(l.invoice_total || 0), allocated_total: Number(l.claim_total), missing_image: l.invoice_missing_image }] : [],
    invoice_id: l.invoice_id || "", claim_untaxed: String(l.claim_untaxed), claim_tax: String(l.claim_tax), tax_touched: true, diff_reason: l.diff_reason || "",
  }));
  props.tab.title = r.pr_no;
}
async function loadRequest() {
  const res = await api<{ data: PaymentRequest; permissions: PayAbilities }>(`general-affairs/payment-requests/${prId.value}`);
  abilities.value = res.permissions;
  fillFrom(res.data);
}
async function loadCandidates() {
  if (!editing.value) return;
  candError.value = "";
  try {
    const q = new URLSearchParams({ pageSize: "20" });
    if (search.value.trim()) q.set("q", search.value.trim());
    if (vendorId.value) q.set("vendorId", vendorId.value);
    const res = await api<{ data: Candidate[] }>("general-affairs/payment-requests/candidates?" + q);
    candidates.value = res.data.filter((c) => !lines.value.some((l) => l.receipt_id === c.receipt_id));
  } catch (e) {
    candError.value = errorText(e);
    candidates.value = [];
  }
}
onMounted(async () => {
  if (!allowed.value) { loading.value = false; return; }
  try {
    const st = await api<{ data: { tolerance_amount: number }; permissions: PayAbilities }>("general-affairs/payment-settings");
    tolerance.value = Number(st.data.tolerance_amount ?? 5);
    abilities.value = st.permissions;
    if (prId.value) await loadRequest();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
  void loadCandidates();
});
watch([search, vendorId, () => lines.value.length], () => { void loadCandidates(); });
const dirty = () => { props.tab.dirty = true; };
function addLine(c: Candidate) {
  if (!vendorId.value) { vendorId.value = c.vendor_id; vendorName.value = c.vendor_name; }
  lines.value.push(toFormLine(c));
  dirty();
}
function removeLine(id: string) {
  lines.value = lines.value.filter((l) => l.receipt_id !== id);
  if (!lines.value.length && creating.value) { vendorId.value = ""; vendorName.value = ""; }
  dirty();
}
const opt = (v: string) => (v.trim() ? v.trim() : null);
function linesPayload() {
  return lines.value.map((l) => ({
    receipt_id: l.receipt_id, invoice_id: l.invoice_id || null, claim_untaxed: lineUntaxed(l), claim_tax: lineTax(l), diff_reason: opt(l.diff_reason),
  }));
}
async function save() {
  if (saving.value || !editing.value) return;
  error.value = ""; saved.value = "";
  if (!lines.value.length) { error.value = "請至少選擇一筆進貨來請款。"; return; }
  if (overLimits.value.length) { error.value = overLimits.value.join("\n"); return; }
  if (missingDiff.value) { error.value = "有明細的請款額與發票分攤額相差超過尾差，請填寫差異原因（仍可儲存與送出）。"; return; }
  saving.value = true;
  try {
    if (creating.value) {
      const res = await api<{ data: PaymentRequest }>("general-affairs/payment-requests", {
        method: "POST",
        body: JSON.stringify({ vendor_id: vendorId.value, expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), lines: linesPayload(), idempotency_key: createKey.value }),
      });
      props.tab.dirty = false;
      saved.value = "已建立請款單草稿。";
      const go = openGaPage("ga-payment-request-edit", res.data.id);
      work.remove([props.tab.id]);
      void go;
    } else if (pr.value) {
      const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), lines: linesPayload(), expected_updated_at: pr.value.updated_at }),
      });
      props.tab.dirty = false;
      saved.value = "已儲存。";
      fillFrom(res.data);
    }
  } catch (e) {
    error.value = errorText(e);
    if (errorCodeOf(e) === "STALE" && pr.value) await loadRequest().catch(() => {});
  } finally {
    saving.value = false;
  }
}

// ---- 動作（送出、退回、標已付款、作廢、備註、重抓帳號）
const acting = ref<PrAction | null>(null);
const actReason = ref("");
const actMethod = ref("TRANSFER");
const actDate = ref(taipeiToday());
const actRef = ref("");
const actError = ref("");
const actBusy = ref(false);
const actKey = ref(newKey());
const reasonNeeded = computed(() => acting.value === "return" || acting.value === "note" || (acting.value === "void" && voidReasonRequired(status.value)));
function ask(a: PrAction) {
  acting.value = a; actReason.value = ""; actRef.value = ""; actError.value = ""; actDate.value = taipeiToday(); actMethod.value = "TRANSFER"; actKey.value = newKey();
}
async function confirmAct() {
  if (!acting.value || !pr.value || actBusy.value) return;
  actError.value = "";
  const a = acting.value;
  const body: Record<string, unknown> = { action: a, expected_updated_at: pr.value.updated_at, idempotency_key: actKey.value };
  if (a === "return" || a === "void") body.reason = actReason.value.trim() || null;
  if (a === "note") body.note = actReason.value.trim() || null;
  if (a === "mark_paid") { body.pay_method = actMethod.value; body.paid_date = actDate.value || null; body.paid_ref = actRef.value.trim() || null; }
  if (reasonNeeded.value && !actReason.value.trim()) { actError.value = a === "note" ? "請填寫備註內容。" : a === "return" ? "請填寫退回原因。" : "已送出或已付款的請款單作廢必須填寫原因。"; return; }
  actBusy.value = true;
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}/actions`, { method: "POST", body: JSON.stringify(body) });
    fillFrom(res.data);
    acting.value = null;
    saved.value = `已${PR_ACTION_LABELS[a]}。`;
  } catch (e) {
    actError.value = errorText(e);
    if (errorCodeOf(e) === "STALE") await loadRequest().catch(() => {});
  } finally {
    actBusy.value = false;
  }
}
async function quick(a: PrAction) {
  if (!pr.value || actBusy.value) return;
  actBusy.value = true; error.value = ""; saved.value = "";
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}/actions`, {
      method: "POST", body: JSON.stringify({ action: a, expected_updated_at: pr.value.updated_at, idempotency_key: newKey() }),
    });
    fillFrom(res.data);
    saved.value = `已${PR_ACTION_LABELS[a]}。`;
  } catch (e) {
    error.value = errorText(e);
    if (errorCodeOf(e) === "STALE") await loadRequest().catch(() => {});
  } finally {
    actBusy.value = false;
  }
}
const printPage = () => pr.value && openGaPage("ga-payment-request-print", pr.value.id);
function backToList() { openGaPage("ga-payment-requests"); work.remove([props.tab.id]); }
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>{{ creating ? "建立請款單" : pr ? `請款單 ${pr.pr_no}` : "請款單" }}<span v-if="pr" class="st" :class="PR_STATUS_CLASS[pr.status]" data-testid="pe-status">{{ PR_STATUS_LABELS[pr.status] }}</span></h1>
      <p class="muted">只能選已驗收進貨的項目；累計請款不能超過累計驗收含稅金額（含 {{ money(tolerance) }} 尾差）。請款不需要核准。</p>
    </div>
    <div class="head-actions">
      <button v-if="pr" type="button" data-testid="pe-print" @click="printPage">列印請款單</button>
      <button type="button" data-testid="pe-back" @click="backToList">回請款單清單</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '請款單']">
    <p v-if="loading" role="status">載入中…</p>
    <p v-if="error" class="notice error pre" role="alert" data-testid="pe-error">{{ error }}</p>
    <p v-if="saved" class="notice success" role="status" data-testid="pe-saved">{{ saved }}</p>
    <p v-if="!loading && abilities && !canManage" class="notice" role="status" data-testid="pe-readonly">你只有查看權限，不能建立或處理請款單。</p>
    <p v-if="pr?.status === 'PAID'" class="notice" role="status" data-testid="pe-locked">已付款，內容鎖定，只能加備註或作廢。</p>
    <p v-if="pr?.status === 'VOID'" class="notice" role="status" data-testid="pe-void">已作廢（{{ timeText(pr.voided_at) }}，{{ pr.voided_by_name || "—" }}）：{{ pr.void_reason || "未填原因" }}。請款額度已釋放。</p>
    <p v-if="pr?.status === 'DRAFT' && pr.last_return_reason" class="notice" role="status" data-testid="pe-returned">上次退回原因：{{ pr.last_return_reason }}</p>

    <section v-if="!loading" class="pe-box" data-testid="pe-info">
      <h2>基本資料</h2>
      <p>廠商：<strong data-testid="pe-vendor">{{ vendorName || "（選擇進貨後帶出）" }}</strong></p>
      <template v-if="pr">
        <p v-if="pr.vendor_masked" class="muted" data-testid="pe-masked">廠商統編與銀行帳號屬帳務機密，你沒有廠商查看權限，不顯示。</p>
        <template v-else>
          <p data-testid="pe-tax">統一編號：{{ pr.vendor_tax_id_snapshot || "—" }}</p>
          <p data-testid="pe-bank">收款帳號（建立時快照）：{{ bankText(pr.bank_snapshot) || "廠商未填寫銀行資料" }}</p>
        </template>
        <p class="muted">建立 {{ pr.created_by_name || "—" }} {{ timeText(pr.created_at) }}<template v-if="pr.submitted_at">；送出 {{ pr.submitted_by_name || "—" }} {{ timeText(pr.submitted_at) }}</template><template v-if="pr.paid_at">；付款 {{ pr.paid_by_name || "—" }} {{ timeText(pr.paid_at) }}</template></p>
        <p v-if="pr.status === 'PAID'" data-testid="pe-paid-info">付款方式 {{ PAY_METHOD_LABELS[pr.pay_method as keyof typeof PAY_METHOD_LABELS] || pr.pay_method }}，付款日 {{ dateText(pr.paid_date) }}<template v-if="pr.paid_ref">，參考號 {{ pr.paid_ref }}</template></p>
      </template>
      <div class="pe-grid">
        <label>預計付款日<input v-model="expectedPayDate" type="date" :disabled="!editing" data-testid="pe-pay-date" @input="dirty" /></label>
        <label>備註<input v-model="notes" maxlength="500" :disabled="!editing" data-testid="pe-notes" @input="dirty" /></label>
      </div>
    </section>

    <section v-if="!loading" class="pe-box" data-testid="pe-lines">
      <h2>請款明細（採購單／進貨單／發票）</h2>
      <p v-if="!lines.length" class="muted" data-testid="pe-empty">還沒有選擇進貨。從下方「可請款的進貨」加入。</p>
      <ul class="pe-list">
        <li v-for="(l, i) in lines" :key="l.receipt_id" class="pe-line" data-testid="pe-line">
          <div class="pe-line-head">
            <span><strong>{{ l.po_no }}</strong> / <strong data-testid="pe-line-receipt">{{ l.receipt_no }}</strong>（{{ dateText(l.received_date) }}）進貨含稅 {{ money(l.receipt_total) }}</span>
            <button v-if="editing" type="button" class="link" data-testid="pe-remove" @click="removeLine(l.receipt_id)">移除</button>
          </div>
          <div v-if="editing" class="pe-grid">
            <label>發票
              <select v-model="l.invoice_id" data-testid="pe-invoice" @change="dirty">
                <option value="">（不指定發票）</option>
                <option v-for="inv in l.invoices" :key="inv.id" :value="inv.id" :disabled="inv.missing_image">{{ INVOICE_TYPE_LABELS[inv.invoice_type as keyof typeof INVOICE_TYPE_LABELS] || inv.invoice_type }} {{ inv.invoice_no || "" }} {{ money(inv.allocated_total) }}{{ inv.missing_image ? "（缺圖，不能請款）" : "" }}</option>
              </select>
            </label>
            <label>請款未稅金額<input v-model="l.claim_untaxed" inputmode="numeric" data-testid="pe-untaxed" @input="l.tax_touched ? null : (l.claim_tax = ''); dirty()" /></label>
            <label>稅額（依 {{ Math.round(l.tax_rate * 10000) / 100 }}% 自動算，可手改）<input :value="l.tax_touched ? l.claim_tax : String(lineTax(l))" inputmode="numeric" data-testid="pe-tax-input" @input="l.claim_tax = ($event.target as HTMLInputElement).value; l.tax_touched = true; dirty()" /></label>
          </div>
          <p class="muted" data-testid="pe-line-claim">請款 {{ money(Number.isFinite(lineTotal(l)) ? lineTotal(l) : 0) }}<template v-if="!editing && pr?.lines?.[i]"><span v-if="pr.lines[i].invoice_no">　發票 {{ pr.lines[i].invoice_no }}（{{ money(pr.lines[i].invoice_total) }}）</span></template><span v-if="reference(l) !== null && editing">　發票分攤 {{ money(reference(l)) }}</span></p>
          <label v-if="diffNeeded(l) || l.diff_reason">差異原因（與發票分攤額相差超過 {{ money(tolerance) }}，要填原因，仍可送出）<input v-model="l.diff_reason" maxlength="200" :disabled="!editing" data-testid="pe-diff-reason" @input="dirty" /></label>
          <p v-else-if="reference(l) !== null && editing && reference(l) !== lineTotal(l)" class="muted" data-testid="pe-tail">相差 {{ money(Math.abs(lineTotal(l) - (reference(l) as number))) }}，在尾差內，不用填原因。</p>
          <table v-if="!editing && pr?.lines?.[i]?.items?.length" class="pe-items" data-testid="pe-items">
            <thead><tr><th>品項</th><th>訂購</th><th>驗入</th><th>拒收</th><th>單價</th><th>未稅</th></tr></thead>
            <tbody><tr v-for="(it, n) in pr!.lines![i].items" :key="n"><td>{{ it.item_name }}</td><td>{{ it.ordered_qty }}</td><td>{{ it.accepted_qty }}</td><td>{{ it.rejected_qty }}</td><td>{{ money(it.unit_price) }}</td><td>{{ money(it.amount_untaxed) }}</td></tr></tbody>
          </table>
        </li>
      </ul>
      <p class="pe-total">合計 <strong data-testid="pe-grand">{{ money(editing ? grandTotal : pr?.amount_total) }}</strong><span v-if="pr && !editing" class="muted">（未稅 {{ money(pr.amount_untaxed) }}、稅額 {{ money(pr.tax_amount) }}）</span></p>
      <p v-for="(m, n) in overLimits" :key="n" class="field-error" role="alert" data-testid="pe-over">{{ m }}</p>
    </section>

    <section v-if="!loading && editing" class="pe-box" data-testid="pe-candidates">
      <h2>可請款的進貨</h2>
      <label>搜尋（採購單號、進貨單號、送貨單號）<input v-model="search" type="search" data-testid="pe-search" /></label>
      <p v-if="candError" class="notice error" role="alert" data-testid="pe-cand-error">{{ candError }}</p>
      <ul class="pe-list">
        <li v-for="c in candidates" :key="c.receipt_id" class="pe-line" data-testid="pe-cand">
          <span><strong>{{ c.po_no }}</strong> / {{ c.receipt_no }}　{{ c.vendor_name }}　進貨含稅 {{ money(c.receipt_total) }}；此採購單尚可請款 {{ money(c.po_remaining) }}<span v-if="c.invoices.length" class="muted">，已連 {{ c.invoices.length }} 張發票</span></span>
          <button type="button" :data-testid="'pe-add-' + c.receipt_no" :disabled="!!vendorId && vendorId !== c.vendor_id" @click="addLine(c)">加入</button>
        </li>
      </ul>
      <p v-if="!candidates.length && !candError" class="muted" data-testid="pe-cand-empty">沒有可請款的進貨（尚未驗收、全部拒收、已請完或已作廢的進貨不會出現）。</p>
    </section>

    <section v-if="pr?.events?.length" class="pe-box" data-testid="pe-events">
      <h2>操作紀錄</h2>
      <ol class="pe-timeline">
        <li v-for="e in pr.events" :key="e.id" data-testid="pe-event"><strong>{{ EVENT_LABELS[e.event_type] || e.event_type }}</strong>　{{ e.actor_name || "—" }}　{{ timeText(e.created_at) }}<template v-if="e.reason">：{{ e.reason }}</template></li>
      </ol>
      <p class="muted">操作紀錄不可修改或刪除。</p>
    </section>

    <div v-if="!loading" class="dialog-actions pe-actions">
      <template v-if="editing">
        <button v-if="pr && actions.includes('refresh_bank')" type="button" :disabled="actBusy || saving" data-testid="pe-refresh-bank" @click="quick('refresh_bank')">重抓廠商帳號</button>
        <button type="button" class="primary" :disabled="saving" data-testid="pe-save" @click="save">{{ saving ? "儲存中…" : creating ? "建立草稿" : "儲存草稿" }}</button>
      </template>
      <button v-if="actions.includes('submit')" type="button" class="primary" :disabled="actBusy || saving" data-testid="pe-submit" @click="ask('submit')">送出請款</button>
      <button v-if="actions.includes('return')" type="button" :disabled="actBusy" data-testid="pe-return" @click="ask('return')">退回草稿</button>
      <button v-if="actions.includes('mark_paid')" type="button" class="primary" :disabled="actBusy" data-testid="pe-paid" @click="ask('mark_paid')">標記已付款</button>
      <button v-if="actions.includes('note')" type="button" :disabled="actBusy" data-testid="pe-note" @click="ask('note')">加備註</button>
      <button v-if="actions.includes('void')" type="button" class="danger" :disabled="actBusy" data-testid="pe-void-btn" @click="ask('void')">作廢</button>
    </div>

    <Modal v-if="acting" :title="PR_ACTION_LABELS[acting]" :busy="actBusy" @cancel="acting = null">
      <p v-if="acting === 'submit'">送出後內容不能直接修改（要改請先退回草稿），由會計付款。確定送出請款單 {{ pr?.pr_no }}（{{ money(pr?.amount_total) }}）？</p>
      <p v-else-if="acting === 'return'">退回後變回草稿，總務可以修改再送出。</p>
      <p v-else-if="acting === 'void'">作廢後釋放請款額度，不能復原。<template v-if="pr?.status === 'PAID'">已付款的請款單作廢請確認款項已處理。</template></p>
      <template v-if="acting === 'mark_paid'">
        <label>付款方式<select v-model="actMethod" data-testid="act-method"><option v-for="m in PAY_METHODS" :key="m" :value="m">{{ PAY_METHOD_LABELS[m] }}</option></select></label>
        <label>付款日期<input v-model="actDate" type="date" :max="taipeiToday()" data-testid="act-date" /></label>
        <label>付款參考號（轉帳末五碼、支票號碼等，選填）<input v-model="actRef" maxlength="60" data-testid="act-ref" /></label>
      </template>
      <label v-if="acting === 'return' || acting === 'void' || acting === 'note'">{{ acting === "return" ? "退回原因" : acting === "void" ? (reasonNeeded ? "作廢原因" : "作廢原因（草稿可不填）") : "備註內容" }}<input v-model="actReason" maxlength="500" data-testid="act-reason" /></label>
      <p v-if="actError" class="field-error" role="alert" data-testid="act-error">{{ actError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="actBusy" @click="acting = null">取消</button>
        <button type="button" class="primary" :disabled="actBusy" data-testid="act-confirm" @click="confirmAct">{{ actBusy ? "處理中…" : "確認" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.pe-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; margin-bottom: 14px; }
.pe-box h2 { margin: 0; font-size: 16px; }
.pe-box label { display: grid; gap: 4px; min-width: 0; }
.pe-box p { margin: 0; overflow-wrap: anywhere; }
.pe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.pe-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pe-line { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: grid; gap: 8px; min-width: 0; }
.pe-line-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.pe-items { width: 100%; border-collapse: collapse; font-size: 13px; display: block; overflow-x: auto; }
.pe-items th, .pe-items td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; white-space: nowrap; }
.pe-total { font-size: 16px; }
.pe-timeline { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; }
.pe-actions { flex-wrap: wrap; }
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.st { display: inline-block; margin-left: 10px; border-radius: 10px; padding: 1px 10px; font-size: 13px; font-weight: 600; border: 1px solid var(--line); vertical-align: middle; }
.st.submitted { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
.st.paid { color: #1b6e3a; border-color: #9fd2b0; background: #e8f6ec; }
.st.void { color: var(--muted); }
.pre { white-space: pre-wrap; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .dialog-actions button, .pe-line button, .head-actions button { min-height: 44px; } }
</style>
