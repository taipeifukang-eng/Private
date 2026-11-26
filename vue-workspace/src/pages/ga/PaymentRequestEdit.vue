<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import PaymentRequestUtility from "../../components/ga/PaymentRequestUtility.vue";
import PrintFieldsBox from "../../components/ga/PrintFieldsBox.vue";
import PayeeBuyerFields from "../../components/ga/PayeeBuyerFields.vue";
import PaidFields from "../../components/ga/PaidFields.vue";
import PayoutAccountDialog from "../../components/ga/PayoutAccountDialog.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import {
  EVENT_LABELS, PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_CLASS, PR_STATUS_LABELS, availableActions, bankText, checkClaimLimit, dateText, errorCodeOf, errorText, paidDateProblem, paidDateRange, payErrorText, PAID_BACKDATE_DAYS,
  holdsQuota, isEditable, lineDiffReasonRequired, money, newKey, timeText, voidReasonRequired, payeeBankText, payeeName, type Candidate, type PayAbilities, type PaymentRequest, type PrAction,
} from "../../lib/ga-payments";
import { prepayAmount, prepaySplit } from "../../../../lib/workspace/general-affairs/payment-request-rules";
import type { BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";
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
// G46 水電話費請款單：水電模式整頁交給 PaymentRequestUtility（採購流程完全不動）。
// 建立：由列表帶 payload.source（UTILITY 或 PURCHASE，可隨時切換）；既有請款單：載入後依資料的來源判斷。
const loadedUtility = ref(false);
const isUtility = computed(() => loadedUtility.value || (!prId.value && (props.tab.payload as { source?: unknown } | undefined)?.source === "UTILITY"));

type FormLine = {
  receipt_id: string; receipt_no: string; po_id: string; po_no: string; tax_rate: number; received_date: string; receipt_total: number; receipt_untaxed: number;
  po_received_total: number; po_claimed_total: number; known: boolean; invoices: Candidate["invoices"]; invoice_id: string; claim_untaxed: string; claim_tax: string; tax_touched: boolean; diff_reason: string; prepay_offset: number; covered: boolean;
};
const lines = ref<FormLine[]>([]);
const vendorId = ref("");
const vendorName = ref("");
const expectedPayDate = ref("");
const notes = ref("");
const candidates = ref<Candidate[]>([]);
const candError = ref("");
const search = ref("");
// ga-improve-b1：付款對象（G4）、買受人抬頭（G11）、預付款（G1）
const payeeType = ref<"VENDOR" | "EMPLOYEE">("VENDOR");
const payeeProfileId = ref("");
const payeeNameText = ref("");
const buyerCompanyId = ref("");
const companies = ref<BuyerCompany[]>([]);
const prepayAmt = ref("");
const isPrepay = computed(() => pr.value?.pay_kind === "PREPAY");
const isEmployee = computed(() => (pr.value ? pr.value.payee_type === "EMPLOYEE" : payeeType.value === "EMPLOYEE"));
const payeeAccount = computed(() => (pr.value?.payee_account_snapshot || {}) as Record<string, string | null>);
const hasPayeeAccount = computed(() => !!payeeAccount.value.bank_account);
const buyerText = computed(() => {
  if (pr.value?.buyer_title_snapshot) return `${pr.value.buyer_title_snapshot}${pr.value.buyer_tax_id_snapshot ? "（" + pr.value.buyer_tax_id_snapshot + "）" : ""}`;
  const c = companies.value.find((x) => x.id === buyerCompanyId.value);
  return c ? `${c.name}（${c.tax_id}）` : "";
});
const prepaySplitView = computed(() => {
  try { return prepaySplit(prepayAmount(prepayAmt.value), 0.05); } catch { return null; }
});
const showRegister = ref(false);
const refunding = ref(false);
const refAmount = ref("");
const refReason = ref("");
const refError = ref("");
const refBusy = ref(false);
const refKey = ref(newKey());

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
// 預付核銷額（prepay_offset）要加回請款額再和發票分攤額比，與資料庫一致。
const diffNeeded = (l: FormLine) => { const ref = reference(l); return ref !== null && Number.isFinite(lineTotal(l)) && lineDiffReasonRequired(lineTotal(l) + l.prepay_offset, ref, tolerance.value); };
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
  // G1：進貨單已被預付款核銷的部分不用再請；預設請款額＝進貨單含稅額 − 已請款 − 預付核銷，稅額用減的（與資料庫一致）。
  const offset = Number(c.receipt_prepay_offset || 0);
  const remainingForReceipt = Math.max(Number(c.receipt_total) - Number(c.receipt_claimed || 0) - offset, 0);
  const untaxed = remainingForReceipt === Number(c.receipt_total) ? Number(c.receipt_untaxed) : Math.max(Math.round(remainingForReceipt / (1 + Number(c.tax_rate))), 0);
  const okInv = c.invoices.filter((i) => !i.missing_image);
  return {
    receipt_id: c.receipt_id, receipt_no: c.receipt_no, po_id: c.po_id, po_no: c.po_no, tax_rate: Number(c.tax_rate), received_date: c.received_date, receipt_total: Number(c.receipt_total),
    receipt_untaxed: untaxed, po_received_total: Number(c.po_received_total), po_claimed_total: Number(c.po_claimed_total), known: true, invoices: c.invoices,
    invoice_id: okInv.length === 1 ? okInv[0].id : "", claim_untaxed: String(untaxed), claim_tax: offset > 0 ? String(remainingForReceipt - untaxed) : "", tax_touched: offset > 0, diff_reason: "",
    prepay_offset: offset, covered: !!c.prepay_covered,
  };
}
function fillFrom(r: PaymentRequest) {
  pr.value = r;
  vendorId.value = r.vendor_id;
  vendorName.value = r.vendor_name_snapshot || "";
  expectedPayDate.value = r.expected_pay_date ? dateText(r.expected_pay_date) : "";
  notes.value = r.notes || "";
  payeeType.value = r.payee_type === "EMPLOYEE" ? "EMPLOYEE" : "VENDOR";
  payeeProfileId.value = r.payee_profile_id || "";
  payeeNameText.value = r.payee_name_snapshot || r.payee_name || "";
  buyerCompanyId.value = r.buyer_company_id || "";
  prepayAmt.value = r.pay_kind === "PREPAY" ? String(r.amount_total) : "";
  lines.value = (r.lines || []).map((l) => ({
    receipt_id: l.receipt_id, receipt_no: l.receipt_no, po_id: l.po_id, po_no: l.po_no, tax_rate: Number(l.tax_rate), received_date: l.received_date, receipt_total: Number(l.receipt_total),
    receipt_untaxed: Number(l.receipt_untaxed), po_received_total: 0, po_claimed_total: 0, known: false,
    invoices: l.invoice_id ? [{ id: l.invoice_id, invoice_no: l.invoice_no, invoice_type: l.invoice_type || "", amount_total: Number(l.invoice_total || 0), allocated_total: Number(l.claim_total), missing_image: l.invoice_missing_image }] : [],
    invoice_id: l.invoice_id || "", claim_untaxed: String(l.claim_untaxed), claim_tax: String(l.claim_tax), tax_touched: true, diff_reason: l.diff_reason || "",
    prepay_offset: Number((l as { prepay_offset?: number }).prepay_offset || 0), covered: false,
  }));
  props.tab.title = r.pr_no;
}
async function loadRequest() {
  const res = await api<{ data: PaymentRequest; permissions: PayAbilities }>(`general-affairs/payment-requests/${prId.value}`);
  abilities.value = res.permissions;
  if ((res.data as { source?: string }).source === "UTILITY") { loadedUtility.value = true; return; }
  fillFrom(res.data);
}
async function loadCandidates() {
  if (!editing.value || isUtility.value) return;
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
    companies.value = (await api<{ data: BuyerCompany[] }>("general-affairs/buyer-companies").catch(() => ({ data: [] as BuyerCompany[] }))).data;
    if (prId.value) await loadRequest();
  } catch (e) {
    error.value = payErrorText(e);
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
/** 付款對象與買受人抬頭：建立時只在有選的時候帶；修改時只帶有變動的欄位（沒帶＝不動，避免誤清除預設抬頭）。 */
function payeeBuyerBody(forCreate: boolean) {
  const out: Record<string, unknown> = {};
  const cur = pr.value;
  const curEmp = cur?.payee_type === "EMPLOYEE";
  if (payeeType.value === "EMPLOYEE") {
    if (forCreate || !curEmp || cur?.payee_profile_id !== payeeProfileId.value) { out.payee_type = "EMPLOYEE"; out.payee_profile_id = payeeProfileId.value; }
  } else if (!forCreate && curEmp) out.payee_type = "VENDOR";
  const curBuyer = cur?.buyer_company_id || "";
  if (forCreate ? !!buyerCompanyId.value : buyerCompanyId.value !== curBuyer) out.buyer_company_id = buyerCompanyId.value || null;
  return out;
}
function linesPayload() {
  return lines.value.map((l) => ({
    receipt_id: l.receipt_id, invoice_id: l.invoice_id || null, claim_untaxed: lineUntaxed(l), claim_tax: lineTax(l), diff_reason: opt(l.diff_reason),
  }));
}
async function save() {
  if (saving.value || !editing.value) return;
  error.value = ""; saved.value = "";
  if (payeeType.value === "EMPLOYEE" && !payeeProfileId.value) { error.value = "請選擇代墊的同仁。"; return; }
  if (isPrepay.value) {
    try { prepayAmount(prepayAmt.value); } catch (e) { error.value = (e as Error).message; return; }
  } else {
    if (!lines.value.length) { error.value = "請至少選擇一筆進貨來請款。"; return; }
    if (overLimits.value.length) { error.value = overLimits.value.join("\n"); return; }
    if (missingDiff.value) { error.value = "有明細的請款額與發票分攤額相差超過尾差，請填寫差異原因（仍可儲存與送出）。"; return; }
  }
  saving.value = true;
  try {
    if (isPrepay.value && pr.value) {
      const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amount: prepayAmt.value, expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), ...payeeBuyerBody(false), expected_updated_at: pr.value.updated_at }),
      });
      props.tab.dirty = false;
      saved.value = "已儲存。";
      fillFrom(res.data);
    } else if (creating.value) {
      const res = await api<{ data: PaymentRequest }>("general-affairs/payment-requests", {
        method: "POST",
        body: JSON.stringify({ vendor_id: vendorId.value, expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), lines: linesPayload(), ...payeeBuyerBody(true), idempotency_key: createKey.value }),
      });
      props.tab.dirty = false;
      saved.value = "已建立請款單草稿。";
      const go = openGaPage("ga-payment-request-edit", res.data.id);
      work.remove([props.tab.id]);
      void go;
    } else if (pr.value) {
      const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), lines: linesPayload(), ...payeeBuyerBody(false), expected_updated_at: pr.value.updated_at }),
      });
      props.tab.dirty = false;
      saved.value = "已儲存。";
      fillFrom(res.data);
    }
  } catch (e) {
    error.value = payErrorText(e);
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
// 請款單建立日（台北）與付款日期可填範圍：建立日往前 30 天到今天（F3）。
const createdDay = computed(() => (pr.value?.created_at ? taipeiToday(new Date(pr.value.created_at)) : taipeiToday()));
const paidRange = computed(() => paidDateRange(createdDay.value, taipeiToday()));
const actRef = ref("");
const actCard = ref("");
const actPlatform = ref("");
const actError = ref("");
const actBusy = ref(false);
// 對話框欄位一變動就清掉舊的錯誤訊息，避免改成合法日期後紅字還在。
watch([actDate, actMethod, actRef, actReason, actCard, actPlatform], () => { if (actError.value) actError.value = ""; });
const actKey = ref(newKey());
const reasonNeeded = computed(() => acting.value === "return" || acting.value === "note" || (acting.value === "void" && voidReasonRequired(status.value)));
function ask(a: PrAction) {
  acting.value = a; actReason.value = ""; actRef.value = ""; actCard.value = ""; actPlatform.value = ""; actError.value = ""; actDate.value = taipeiToday(); actMethod.value = "TRANSFER"; actKey.value = newKey();
}
async function confirmAct() {
  if (!acting.value || !pr.value || actBusy.value) return;
  actError.value = "";
  const a = acting.value;
  const body: Record<string, unknown> = { action: a, expected_updated_at: pr.value.updated_at, idempotency_key: actKey.value };
  if (a === "return" || a === "void") body.reason = actReason.value.trim() || null;
  if (a === "note") body.note = actReason.value.trim() || null;
  if (a === "mark_paid") {
    body.pay_method = actMethod.value; body.paid_date = actDate.value || null; body.paid_ref = actRef.value.trim() || null;
    if (actMethod.value === "CREDIT_CARD" && actCard.value.trim()) body.card_last4 = actCard.value.trim();
    if (actMethod.value === "ONLINE_PLATFORM" && actPlatform.value.trim()) body.platform = actPlatform.value.trim();
  }
  if (a === "mark_paid") { const prob = paidDateProblem(actDate.value, createdDay.value, taipeiToday()); if (prob) { actError.value = prob; return; } }
  if (reasonNeeded.value && !actReason.value.trim()) { actError.value = a === "note" ? "請填寫備註內容。" : a === "return" ? "請填寫退回原因。" : "已送出或已付款的請款單作廢必須填寫原因。"; return; }
  actBusy.value = true;
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}/actions`, { method: "POST", body: JSON.stringify(body) });
    fillFrom(res.data);
    acting.value = null;
    saved.value = `已${PR_ACTION_LABELS[a]}。`;
  } catch (e) {
    actError.value = payErrorText(e);
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
    error.value = payErrorText(e);
    if (errorCodeOf(e) === "STALE") await loadRequest().catch(() => {});
  } finally {
    actBusy.value = false;
  }
}
function askRefund() { refunding.value = true; refAmount.value = ""; refReason.value = ""; refError.value = ""; refKey.value = newKey(); }
async function confirmRefund() {
  if (!pr.value || refBusy.value) return;
  refError.value = "";
  const n = Number(String(refAmount.value).replace(/,/g, ""));
  if (!Number.isInteger(n) || n <= 0) { refError.value = "退款金額必須是大於 0 的整數元。"; return; }
  if (!refReason.value.trim()) { refError.value = "請填寫退款或轉抵的說明。"; return; }
  refBusy.value = true;
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}/prepay-refund`, {
      method: "POST", body: JSON.stringify({ amount: n, reason: refReason.value.trim(), expected_updated_at: pr.value.updated_at, idempotency_key: refKey.value }),
    });
    fillFrom(res.data);
    refunding.value = false;
    saved.value = `已登錄預付款退款或轉抵 ${money(n)}。`;
  } catch (e) {
    refError.value = payErrorText(e);
    if (errorCodeOf(e) === "STALE") await loadRequest().catch(() => {});
  } finally {
    refBusy.value = false;
  }
}
async function accountSaved() {
  showRegister.value = false;
  saved.value = "已登錄同仁匯款帳戶。";
  if (pr.value && actions.value.includes("refresh_bank")) await quick("refresh_bank");
  else await loadRequest().catch(() => {});
}
// 預設列印紙本格式請款單；「列印明細版」是原本的 A4 明細版面。
const printPage = () => pr.value && openGaPage("ga-payment-request-print", pr.value.id, { layout: "paper" });
const printDetailPage = () => pr.value && openGaPage("ga-payment-request-print", pr.value.id, { layout: "detail" });
// 列印欄位另外儲存（不動請款單版本時間）：只更新這四欄與操作紀錄，不覆蓋表單上尚未儲存的修改。
function printFieldsSaved(r: PaymentRequest) {
  if (!pr.value) return;
  Object.assign(pr.value, { applicant_name: r.applicant_name ?? null, applicant_dept: r.applicant_dept ?? null, attach_docs: r.attach_docs ?? null, reason_override: r.reason_override ?? null, events: r.events ?? pr.value.events });
}
function backToList() { openGaPage("ga-payment-requests"); work.remove([props.tab.id]); }
</script>

<template>
  <PaymentRequestUtility v-if="isUtility" :tab="tab" />
  <template v-else>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>{{ creating ? "建立請款單" : pr ? `請款單 ${pr.pr_no}` : "請款單" }}<span v-if="pr" class="st" :class="PR_STATUS_CLASS[pr.status]" data-testid="pe-status">{{ PR_STATUS_LABELS[pr.status] }}</span><span v-if="isPrepay" class="kind" data-testid="pe-kind">預付款</span><span v-if="isEmployee" class="kind emp" data-testid="pe-kind-employee">同仁代墊</span></h1>
      <p v-if="isPrepay" class="muted" data-testid="pe-prepay-subtitle">預付款：採購單已下訂、貨還沒到就先付的款項。到貨驗入時系統自動核銷在進貨單上，之後一般請款只請差額；預付款被退回或作廢時，已核銷的金額會自動回復。</p>
      <p v-if="creating || !pr" class="muted" data-testid="pe-subtitle">只能選已驗收進貨的項目；累計請款不能超過累計驗收含稅金額（含 {{ money(tolerance) }} 尾差），也不能超過採購單含稅總額（同樣含尾差）。請款不需要核准。</p>
      <p v-else class="muted" data-testid="pe-subtitle">{{ pr.status === "DRAFT" ? "草稿可以修改明細、儲存或送出；送出後要改請先退回草稿。" : pr.status === "SUBMITTED" ? "已送出，等待會計付款；要修改內容請先退回草稿。" : pr.status === "PAID" ? "已付款，內容已鎖定，只能加備註或作廢。" : "已作廢，內容唯讀。" }}累計請款上限含 {{ money(tolerance) }} 尾差。</p>
    </div>
    <div class="head-actions">
      <button v-if="pr" type="button" data-testid="pe-print" @click="printPage">列印請款單</button>
      <button v-if="pr" type="button" data-testid="pe-print-detail" @click="printDetailPage">列印明細版</button>
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
      <p>廠商：<strong data-testid="pe-vendor">{{ vendorName || "（選擇進貨後帶出）" }}</strong><template v-if="isPrepay && pr?.prepay_po_no">　採購單：<strong data-testid="pe-prepay-po">{{ pr.prepay_po_no }}</strong></template></p>
      <div v-if="isEmployee && pr" class="pe-payee" data-testid="pe-payee-box">
        <p>付款對象：<strong data-testid="pe-payee-name">同仁代墊：{{ payeeName(pr) }}</strong>（公司把錢還給同仁，廠商仍是上面那一家）</p>
        <p v-if="pr.payee_account_masked" class="muted" data-testid="pe-payee-masked">同仁匯款帳戶屬帳務機密，你沒有廠商帳務檢視權限，只顯示末四碼：{{ pr.payee_account_last4 || "（尚未登錄）" }}。</p>
        <p v-else-if="hasPayeeAccount" data-testid="pe-payee-account">同仁匯款帳戶（快照）：{{ payeeBankText(pr.payee_account_snapshot) }}</p>
        <p v-else class="notice" role="status" data-testid="pe-payee-no-account">這位同仁還沒有登錄匯款帳戶，送出前要先登錄：請同仁到右上角「我的代墊款」登錄，或由會計代為登錄{{ pr.status === "DRAFT" ? "，再按「重抓同仁匯款帳戶」" : "" }}。</p>
        <button v-if="canManage && abilities?.vendorVisible && pr.status !== 'VOID'" type="button" data-testid="pe-payee-register" @click="showRegister = true">代同仁登錄匯款帳戶</button>
      </div>
      <p v-if="pr && !editing && buyerText" data-testid="pe-buyer-text">買受人抬頭：{{ buyerText }}</p>
      <PayeeBuyerFields v-if="editing && !loading && abilities" v-model:payee-type="payeeType" v-model:payee-profile-id="payeeProfileId" v-model:payee-name="payeeNameText" v-model:buyer-company-id="buyerCompanyId" :companies="companies" :editing="editing" prefix="pe" @change="dirty" />
      <template v-if="pr">
        <p v-if="pr.vendor_masked" class="muted" data-testid="pe-masked">廠商統編與銀行帳號屬帳務機密，你沒有廠商查看權限，不顯示。</p>
        <template v-else>
          <p data-testid="pe-tax">統一編號：{{ pr.vendor_tax_id_snapshot || "—" }}</p>
          <p v-if="!isEmployee" data-testid="pe-bank">收款帳號（建立時快照）：{{ bankText(pr.bank_snapshot) || "廠商未填寫銀行資料" }}</p>
          <p v-else class="muted" data-testid="pe-bank-hidden">同仁代墊：請依上方「同仁匯款帳戶」付款，這張單不匯給廠商，所以不顯示廠商收款帳號。</p>
        </template>
        <p class="muted">建立 {{ pr.created_by_name || "—" }} {{ timeText(pr.created_at) }}<template v-if="pr.submitted_at">；送出 {{ pr.submitted_by_name || "—" }} {{ timeText(pr.submitted_at) }}</template><template v-if="pr.paid_at">；付款 {{ pr.paid_by_name || "—" }} {{ timeText(pr.paid_at) }}</template></p>
        <p v-if="pr.status === 'PAID'" data-testid="pe-paid-info">付款方式 {{ PAY_METHOD_LABELS[pr.pay_method as keyof typeof PAY_METHOD_LABELS] || pr.pay_method }}<template v-if="pr.pay_card_last4 || pr.card_last4">（卡號末四碼 {{ pr.pay_card_last4 || pr.card_last4 }}）</template><template v-if="pr.pay_platform || pr.platform">（平台 {{ pr.pay_platform || pr.platform }}）</template>，付款日 {{ dateText(pr.paid_date) }}<template v-if="pr.paid_ref">，參考號 {{ pr.paid_ref }}</template></p>
      </template>
      <div class="pe-grid">
        <label>預計付款日<input v-model="expectedPayDate" type="date" :disabled="!editing" data-testid="pe-pay-date" @input="dirty" /></label>
        <label>備註<input v-model="notes" maxlength="500" :disabled="!editing" data-testid="pe-notes" @input="dirty" /></label>
      </div>
    </section>

    <PrintFieldsBox v-if="!loading && pr" :pr="pr" :can-manage="canManage" test-prefix="pe" @saved="printFieldsSaved" />
    <section v-if="!loading && isPrepay && pr" class="pe-box" data-testid="pe-prepay">
      <h2>預付款</h2>
      <p v-if="pr.prepay_unsettled" class="notice error" role="alert" data-testid="pe-prepay-unsettled">採購單已全部到貨，但這張預付款還有餘額 {{ money(pr.prepay_balance) }} 沒有核銷，請向廠商要求退款後，在下方登記退款或轉抵。</p>
      <p v-if="pr.prepay_overdue" class="notice error" role="alert" data-testid="pe-prepay-overdue">超過預計到貨日 {{ pr.prepay_overdue_days }} 天仍未到貨，預付餘額 {{ money(pr.prepay_balance) }} 還沒核銷，請向廠商催貨或登記退款。</p>
      <label>預付金額（含稅，整數元）<input v-model="prepayAmt" inputmode="numeric" maxlength="9" :disabled="!editing" data-testid="pe-prepay-amount" @input="dirty" /></label>
      <p v-if="editing && prepaySplitView" class="muted" data-testid="pe-prepay-split">未稅 {{ money(prepaySplitView.untaxed) }}，稅額 {{ money(prepaySplitView.tax) }}</p>
      <ul class="pe-stats" aria-label="預付摘要">
        <li><span>預付金額（含稅）</span><strong data-testid="pe-prepay-total">{{ money(pr.amount_total) }}</strong></li>
        <li><span>已核銷到進貨</span><strong data-testid="pe-prepay-offset">{{ money(pr.prepay_offset_total || 0) }}</strong></li>
        <li><span>已退款或轉抵</span><strong data-testid="pe-prepay-refund">{{ money(pr.prepay_refund_total || 0) }}</strong></li>
        <li><span>預付餘額</span><strong data-testid="pe-prepay-balance">{{ money(pr.prepay_balance || 0) }}</strong></li>
      </ul>
      <p v-if="pr.status === 'DRAFT'" class="muted">草稿不核銷；送出後才會依既有進貨與之後到貨自動核銷。</p>
      <ul v-if="pr.prepay_ledger?.length" class="pe-list" data-testid="pe-prepay-ledger">
        <li v-for="g in pr.prepay_ledger" :key="g.id" class="pe-line" :class="{ gone: g.reversed_at }" data-testid="pe-prepay-ledger-row">
          <span><strong>{{ g.kind === "OFFSET" ? "核銷" : "退款或轉抵" }}</strong>　{{ money(g.amount) }}<template v-if="g.receipt_no">　進貨單 {{ g.receipt_no }}</template><template v-if="g.reason">　{{ g.reason }}</template>　<span class="muted">{{ timeText(g.created_at) }}</span></span>
          <span v-if="g.reversed_at" class="muted">已回復（{{ g.reversed_reason === "VOID" ? "作廢" : g.reversed_reason === "RETURN" ? "退回" : g.reversed_reason || "回復" }}，{{ timeText(g.reversed_at) }}）</span>
        </li>
      </ul>
      <div v-if="pr.status === 'PAID' && canManage && Number(pr.prepay_balance) > 0"><button type="button" data-testid="pe-prepay-refund-btn" @click="askRefund">登記退款或轉抵</button></div>
    </section>

    <section v-if="!loading && !isPrepay" class="pe-box" data-testid="pe-lines">
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
          <p v-if="l.prepay_offset > 0" class="muted" data-testid="pe-line-offset">這張進貨單已由預付款核銷 {{ money(l.prepay_offset) }}，下面是扣掉核銷後的請款金額。</p>
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

    <section v-if="!loading && editing && !isPrepay" class="pe-box" data-testid="pe-candidates">
      <h2>可請款的進貨</h2>
      <label>搜尋（採購單號、進貨單號、送貨單號）<input v-model="search" type="search" data-testid="pe-search" /></label>
      <p v-if="candError" class="notice error" role="alert" data-testid="pe-cand-error">{{ candError }}</p>
      <ul class="pe-list">
        <li v-for="c in candidates" :key="c.receipt_id" class="pe-line" data-testid="pe-cand">
          <span><strong>{{ c.po_no }}</strong> / {{ c.receipt_no }}　{{ c.vendor_name }}　進貨含稅 {{ money(c.receipt_total) }}；此採購單尚可請款 {{ money(c.po_remaining) }}<span v-if="c.invoices.length" class="muted">，已連 {{ c.invoices.length }} 張發票</span><span v-if="Number(c.receipt_prepay_offset) > 0" class="muted" data-testid="pe-cand-offset">，已由預付款核銷 {{ money(c.receipt_prepay_offset) }}</span><strong v-if="c.prepay_covered" class="covered" data-testid="pe-cand-covered">　已由預付款核銷，免再請款（仍可登錄憑證與連結發票）</strong></span>
          <button type="button" :data-testid="'pe-add-' + c.receipt_no" :disabled="(!!vendorId && vendorId !== c.vendor_id) || !!c.prepay_covered" @click="addLine(c)">加入</button>
        </li>
      </ul>
      <p v-if="!candidates.length && !candError" class="muted" data-testid="pe-cand-empty">沒有可請款的進貨（尚未驗收、全部拒收、已請完、已由預付款全額核銷或已作廢的進貨不會出現；已由預付款核銷的進貨單免再請款）。</p>
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
        <button v-if="pr && actions.includes('refresh_bank')" type="button" :disabled="actBusy || saving" data-testid="pe-refresh-bank" @click="quick('refresh_bank')">{{ isEmployee ? "重抓同仁匯款帳戶" : "重抓廠商帳號" }}</button>
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
        <PaidFields v-model:method="actMethod" v-model:card="actCard" v-model:platform="actPlatform" :employee="isEmployee" />
        <label>付款日期<input v-model="actDate" type="date" :min="paidRange.min" :max="paidRange.max" data-testid="act-date" /></label>
        <p class="muted" data-testid="act-date-hint">付款日期可以比請款單建立日（{{ createdDay }}）早，但最多早 {{ PAID_BACKDATE_DAYS }} 天（最早 {{ paidRange.min }}），不能是未來。</p>
        <label>付款參考號（轉帳末五碼、支票號碼等，選填）<input v-model="actRef" maxlength="60" data-testid="act-ref" /></label>
      </template>
      <label v-if="acting === 'return' || acting === 'void' || acting === 'note'">{{ acting === "return" ? "退回原因" : acting === "void" ? (reasonNeeded ? "作廢原因" : "作廢原因（草稿可不填）") : "備註內容" }}<input v-model="actReason" maxlength="500" data-testid="act-reason" /></label>
      <p v-if="actError" class="field-error" role="alert" data-testid="act-error">{{ actError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="actBusy" @click="acting = null">取消</button>
        <button type="button" class="primary" :disabled="actBusy" data-testid="act-confirm" @click="confirmAct">{{ actBusy ? "處理中…" : "確認" }}</button>
      </div>
    </Modal>

    <Modal v-if="refunding" title="登記預付款退款或轉抵" :busy="refBusy" @cancel="refunding = false">
      <p>廠商把預付款退回，或把預付款轉抵其他款項時登記在這裡，預付餘額會減少。目前餘額 {{ money(pr?.prepay_balance || 0) }}。</p>
      <label>金額（整數元，不超過餘額）<input v-model="refAmount" inputmode="numeric" maxlength="9" data-testid="ref-amount" /></label>
      <label>退款或轉抵的說明（必填）<input v-model="refReason" maxlength="200" data-testid="ref-reason" /></label>
      <p v-if="refError" class="field-error" role="alert" data-testid="ref-error">{{ refError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="refBusy" @click="refunding = false">取消</button>
        <button type="button" class="primary" :disabled="refBusy" data-testid="ref-confirm" @click="confirmRefund">{{ refBusy ? "處理中…" : "確認登記" }}</button>
      </div>
    </Modal>
    <PayoutAccountDialog v-if="showRegister && pr?.payee_profile_id" :who="pr.payee_profile_id" :label="payeeName(pr)" @close="showRegister = false" @saved="accountSaved" />
  </GaShell>
  </template>
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
.kind { display: inline-block; margin-left: 8px; border-radius: 6px; padding: 1px 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); vertical-align: middle; color: #0b5cab; }
.kind.emp { color: #7a3d00; }
.pe-payee { display: grid; gap: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: var(--soft); min-width: 0; }
.pe-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.pe-stats li { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; display: grid; gap: 2px; background: var(--surface); }
.pe-stats span { font-size: 12px; color: var(--muted); }
.pe-line.gone { opacity: 0.6; text-decoration: line-through; }
.covered { color: #1b6e3a; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .dialog-actions button, .pe-line button, .head-actions button { min-height: 44px; } }
</style>
