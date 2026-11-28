<script setup lang="ts">
import AutoPayBox from "./AutoPayBox.vue";
import PrintFieldsBox from "./PrintFieldsBox.vue";
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "./GaShell.vue";
import BillScanButton from "./BillScanButton.vue";
import PayeeBuyerFields from "./PayeeBuyerFields.vue";
import PaidFields from "./PaidFields.vue";
import PayoutAccountDialog from "./PayoutAccountDialog.vue";
import Modal from "../Modal.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import {
  EVENT_LABELS, EXCLUDED_LABELS, PAID_BACKDATE_DAYS, PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_CLASS, PR_STATUS_LABELS, availableActions, bankText, billLabel, dateText, errorCodeOf, errorText,
  isEditable, money, newKey, noPayeeNotice, paidDateProblem, paidDateRange, timeText, utilityErrorMessage, voidPaidWarning, voidReasonRequired, payeeBankText, payeeName,
  type PaymentRequest, type PrAction, type UtilityAbilities, type UtilityCandidateBill, type UtilityCandidates, type UtilityBillLine,
} from "../../lib/ga-payments";
import { EXPENSE_TYPE_LABELS, periodText } from "../../lib/ga-utility-bills";
import { taipeiToday } from "../../lib/ga-invoices";
import type { BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";
import { useWorkspace, type WorkTab } from "../../stores";

// G46 水電話費請款單：建立、編輯與檢視（來源＝水電話費）。付款對象只有「公用事業」繳費單位；一張請款單＝同一繳費單位＋同一帳單月份。
// 建立時選繳費單位與月份，系統自動帶入該單位該月可請款的帳單（預設全選），可以手動增減（不可請款的帳單灰字並寫原因）。
// 「送出後帳單自動標記已繳」預設勾選。送出前每張帳單要有附件，缺的會列出並擋下。狀態流程與採購請款單相同（草稿→送出→已付款，可退回、作廢）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const prId = computed(() => props.tab.recordId || "");
const creating = computed(() => !prId.value);
const pr = ref<PaymentRequest | null>(null);
const abilities = ref<UtilityAbilities | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref("");
const dropNote = ref("");
const createKey = ref(newKey());

const vendorId = ref("");
const vendorName = ref("");
const month = ref(taipeiToday().slice(0, 7));
const expectedPayDate = ref("");
const notes = ref("");
const autoMark = ref(true);
// ga-improve-b1：水電請款單也能選「同仁代墊」（例如門市同仁先繳）與買受人抬頭；繳費單位仍是 vendor_id。
const payeeType = ref<"VENDOR" | "EMPLOYEE">("VENDOR");
const payeeProfileId = ref("");
const payeeNameText = ref("");
const buyerCompanyId = ref("");
const companies = ref<BuyerCompany[]>([]);
const showRegister = ref(false);
const isEmployee = computed(() => (pr.value ? pr.value.payee_type === "EMPLOYEE" : payeeType.value === "EMPLOYEE"));
const payeeAccount = computed(() => (pr.value?.payee_account_snapshot || {}) as Record<string, string | null>);
const hasPayeeAccount = computed(() => !!payeeAccount.value.bank_account);
const buyerText = computed(() => {
  if (pr.value?.buyer_title_snapshot) return `${pr.value.buyer_title_snapshot}${pr.value.buyer_tax_id_snapshot ? "（" + pr.value.buyer_tax_id_snapshot + "）" : ""}`;
  const c = companies.value.find((x) => x.id === buyerCompanyId.value);
  return c ? `${c.name}（${c.tax_id}）` : "";
});
const payees = ref<UtilityCandidates["payees"]>([]);
const noPayee = ref(0);
const cand = ref<UtilityCandidates | null>(null);
const selected = ref<Set<string>>(new Set());
const candError = ref("");
const candLoading = ref(false);

const canManage = computed(() => !!abilities.value?.canManage);
const canCreate = computed(() => !!abilities.value?.canCreateUtility);
const status = computed(() => pr.value?.status ?? "DRAFT");
const editing = computed(() => canCreate.value && (creating.value || isEditable(status.value)));
const actions = computed(() => (pr.value ? availableActions(status.value, canManage.value).filter((a) => a !== "submit" || canCreate.value) : []));
const bills = computed<UtilityCandidateBill[]>(() => cand.value?.bills ?? []);
const selectedBills = computed(() => bills.value.filter((b) => selected.value.has(b.id)));
const selectedTotal = computed(() => selectedBills.value.reduce((s, b) => s + Number(b.amount || 0), 0));
const missingBills = computed(() => selectedBills.value.filter((b) => !(Number(b.attachment_count) > 0)));
const billsMasked = computed(() => !!cand.value?.bills_masked || !!pr.value?.bills_masked);
const viewLines = computed<UtilityBillLine[]>(() => pr.value?.bill_lines ?? []);
const noPayeeText = computed(() => noPayeeNotice(cand.value?.no_payee_count ?? noPayee.value));
const dirty = () => { props.tab.dirty = true; };

function fillFrom(r: PaymentRequest) {
  pr.value = r;
  vendorId.value = r.vendor_id;
  vendorName.value = r.vendor_name_snapshot || "";
  month.value = String(r.bill_month || "").slice(0, 7) || month.value;
  expectedPayDate.value = r.expected_pay_date ? dateText(r.expected_pay_date) : "";
  notes.value = r.notes || "";
  autoMark.value = r.auto_mark_paid !== false;
  payeeType.value = r.payee_type === "EMPLOYEE" ? "EMPLOYEE" : "VENDOR";
  payeeProfileId.value = r.payee_profile_id || "";
  payeeNameText.value = r.payee_name_snapshot || r.payee_name || "";
  buyerCompanyId.value = r.buyer_company_id || "";
  props.tab.title = r.pr_no;
}
async function loadRequest() {
  const res = await api<{ data: PaymentRequest; permissions: UtilityAbilities }>(`general-affairs/payment-requests/${prId.value}`);
  abilities.value = res.permissions;
  fillFrom(res.data);
}
async function loadAbilities() {
  const res = await api<{ permissions: UtilityAbilities }>("general-affairs/payment-settings");
  abilities.value = res.permissions;
}
async function loadPayees() {
  if (!canCreate.value || !creating.value) return;
  candError.value = "";
  try {
    const res = await api<{ data: UtilityCandidates }>("general-affairs/payment-requests/utility-candidates?" + new URLSearchParams({ month: month.value }));
    payees.value = res.data.payees || [];
    noPayee.value = res.data.no_payee_count || 0;
  } catch (e) {
    candError.value = errorText(e);
    payees.value = [];
  }
}
async function loadBills(resetSelection: boolean) {
  if (!vendorId.value || !month.value) { cand.value = null; selected.value = new Set(); return; }
  candLoading.value = true;
  candError.value = "";
  try {
    const q = new URLSearchParams({ month: month.value, vendor_id: vendorId.value });
    if (pr.value) q.set("pr_id", pr.value.id);
    const res = await api<{ data: UtilityCandidates }>("general-affairs/payment-requests/utility-candidates?" + q);
    cand.value = res.data;
    if (resetSelection) selected.value = new Set((res.data.bills || []).filter((b) => b.eligible).map((b) => b.id));
  } catch (e) {
    candError.value = errorText(e);
    cand.value = null;
  } finally {
    candLoading.value = false;
  }
}
onMounted(async () => {
  if (!allowed.value) { loading.value = false; return; }
  try {
    companies.value = (await api<{ data: BuyerCompany[] }>("general-affairs/buyer-companies").catch(() => ({ data: [] as BuyerCompany[] }))).data;
    if (prId.value) {
      await loadRequest();
      if (editing.value) {
        await loadBills(false);
        // 單內帳單若已變成不可請款（被標已繳、換單位、金額有小數、已刪除），載入時自動移出勾選並提示
        const okIds = new Set(bills.value.filter((b) => b.eligible).map((b) => b.id));
        const lineIds = viewLines.value.map((l) => l.bill_id);
        selected.value = new Set(lineIds.filter((id) => okIds.has(id)));
        const dropped = lineIds.length - selected.value.size;
        if (dropped > 0) dropNote.value = `有 ${dropped} 張帳單已不可請款（已標記已繳、已刪除或繳費單位／金額已變動），已自動從勾選中移除；儲存後就會從請款單拿掉。`;
      }
    } else {
      await loadAbilities();
      await loadPayees();
    }
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
});
// 建立時換繳費單位或月份：重新帶入該單位該月可請款的帳單並預設全選
watch(month, () => { if (creating.value && !loading.value) { void loadPayees(); void loadBills(true); } });
function pickVendor() {
  const p = (payees.value || []).find((x) => x.vendor_id === vendorId.value);
  vendorName.value = p?.vendor_name || "";
  void loadBills(true);
}
function toggle(b: UtilityCandidateBill) {
  if (!editing.value || (!b.eligible && !selected.value.has(b.id))) return;
  const s = new Set(selected.value);
  if (s.has(b.id)) s.delete(b.id); else s.add(b.id);
  selected.value = s;
  dirty();
}
const eligibleIds = computed(() => bills.value.filter((b) => b.eligible).map((b) => b.id));
function selectAll(on: boolean) { selected.value = new Set(on ? eligibleIds.value : []); dirty(); }

const opt = (v: string) => (v.trim() ? v.trim() : null);
/** 付款對象與買受人抬頭：建立時只在有選的時候帶；修改時只帶有變動的欄位（沒帶＝不動）。 */
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
async function save() {
  if (saving.value || !editing.value) return;
  error.value = ""; saved.value = "";
  if (creating.value && !vendorId.value) { error.value = "請先選擇繳費單位。"; return; }
  if (payeeType.value === "EMPLOYEE" && !payeeProfileId.value) { error.value = "請選擇代墊的同仁。"; return; }
  if (!selected.value.size) { error.value = "請至少選擇一張帳單。"; return; }
  saving.value = true;
  try {
    const ids = [...selected.value];
    if (creating.value) {
      const res = await api<{ data: PaymentRequest }>("general-affairs/payment-requests", {
        method: "POST",
        body: JSON.stringify({ source: "UTILITY", vendor_id: vendorId.value, bill_month: month.value, bill_ids: ids, auto_mark_paid: autoMark.value, expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), ...payeeBuyerBody(true), idempotency_key: createKey.value }),
      });
      props.tab.dirty = false;
      openGaPage("ga-payment-request-edit", res.data.id);
      work.remove([props.tab.id]);
    } else if (pr.value) {
      const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}`, {
        method: "PATCH",
        body: JSON.stringify({ bill_ids: ids, auto_mark_paid: autoMark.value, expected_pay_date: opt(expectedPayDate.value), notes: opt(notes.value), ...payeeBuyerBody(false), expected_updated_at: pr.value.updated_at }),
      });
      props.tab.dirty = false;
      saved.value = "已儲存。";
      fillFrom(res.data);
      await loadBills(false);
      selected.value = new Set((res.data.bill_lines || []).map((l) => l.bill_id));
    }
  } catch (e) {
    error.value = utilityErrorMessage(errorCodeOf(e), errorText(e));
    if (errorCodeOf(e) === "STALE" && pr.value) await loadRequest().catch(() => {});
  } finally {
    saving.value = false;
  }
}
/** 重新帶入：帳單金額在草稿期間被改了，按這個把請款金額更新成帳單目前的金額。 */
async function refresh() {
  if (!pr.value || saving.value) return;
  saving.value = true; error.value = ""; saved.value = "";
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}`, { method: "PATCH", body: JSON.stringify({ refresh: true, expected_updated_at: pr.value.updated_at }) });
    fillFrom(res.data);
    await loadBills(false);
    selected.value = new Set((res.data.bill_lines || []).map((l) => l.bill_id));
    saved.value = "已重新帶入帳單目前的金額。";
  } catch (e) {
    error.value = utilityErrorMessage(errorCodeOf(e), errorText(e));
  } finally {
    saving.value = false;
  }
}

// ---- 動作（送出、退回、標已付款、作廢、備註、重抓帳號）
const acting = ref<PrAction | null>(null);
const actReason = ref("");
const actMethod = ref("TRANSFER");
const actDate = ref(taipeiToday());
const createdDay = computed(() => (pr.value?.created_at ? taipeiToday(new Date(pr.value.created_at)) : taipeiToday()));
const paidRange = computed(() => paidDateRange(createdDay.value, taipeiToday()));
const actRef = ref("");
const actCard = ref("");
const actPlatform = ref("");
const actError = ref("");
const actBusy = ref(false);
const actKey = ref(newKey());
const missingList = ref<Array<{ bill_id: string; location_name: string; expense_type: string; identifier: string | null; amount: number; billing_month: string }> | null>(null);
watch([actDate, actMethod, actRef, actReason, actCard, actPlatform], () => { if (actError.value) actError.value = ""; });
const reasonNeeded = computed(() => acting.value === "return" || acting.value === "note" || (acting.value === "void" && voidReasonRequired(status.value)));
function ask(a: PrAction) {
  acting.value = a; actReason.value = ""; actRef.value = ""; actCard.value = ""; actPlatform.value = ""; actError.value = ""; actDate.value = taipeiToday(); actMethod.value = "TRANSFER"; actKey.value = newKey();
}
const autoCount = computed(() => viewLines.value.length || pr.value?.bill_count || 0);
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
    if (editing.value) { await loadBills(false); selected.value = new Set((res.data.bill_lines || []).map((l) => l.bill_id)); }
  } catch (e) {
    const code = errorCodeOf(e);
    if (code === "BILL_MISSING_ATTACHMENT" && e instanceof ApiError) {
      missingList.value = (e.data?.missing_bills as typeof missingList.value) || [];
      acting.value = null;
      error.value = utilityErrorMessage(code, errorText(e));
    } else {
      actError.value = utilityErrorMessage(code, errorText(e));
    }
    if (code === "STALE") await loadRequest().catch(() => {});
  } finally {
    actBusy.value = false;
  }
}
async function quick(a: PrAction) {
  if (!pr.value || actBusy.value) return;
  actBusy.value = true; error.value = ""; saved.value = "";
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${pr.value.id}/actions`, { method: "POST", body: JSON.stringify({ action: a, expected_updated_at: pr.value.updated_at, idempotency_key: newKey() }) });
    fillFrom(res.data);
    saved.value = `已${PR_ACTION_LABELS[a]}。`;
  } catch (e) {
    error.value = utilityErrorMessage(errorCodeOf(e), errorText(e));
  } finally {
    actBusy.value = false;
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
  Object.assign(pr.value, { applicant_name: r.applicant_name ?? null, applicant_dept: r.applicant_dept ?? null, attach_docs: r.attach_docs ?? null, reason_override: r.reason_override ?? null, print_units: r.print_units ?? null, events: r.events ?? pr.value.events });
}
function backToList() { openGaPage("ga-payment-requests"); work.remove([props.tab.id]); }
function goBills(search?: string) { openGaPage("ga-utility-bills", undefined, { month: month.value, search: search || "" }); }
const typeText = (t: string) => EXPENSE_TYPE_LABELS[t as keyof typeof EXPENSE_TYPE_LABELS] || t;
const lineState = (l: UtilityBillLine) => {
  if (l.bill_deleted) return "已刪除";
  if (l.bill_paid_at) return l.bill_paid_by_this ? `已繳 ${dateText(l.bill_paid_at)}（本請款單自動標記）` : `已繳 ${dateText(l.bill_paid_at)}`;
  if (l.auto_reverted_at) return l.auto_revert_reason === "VOID" ? "待繳（作廢時已改回）" : "待繳（退回時已改回）";
  return "待繳";
};
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>{{ creating ? "建立水電話費請款單" : pr ? `請款單 ${pr.pr_no}` : "請款單" }}<span v-if="pr" class="st" :class="PR_STATUS_CLASS[pr.status]" data-testid="pu-status">{{ PR_STATUS_LABELS[pr.status] }}</span><span class="src" data-testid="pu-source">水電話費</span><span v-if="isEmployee" class="src emp" data-testid="pu-kind-employee">同仁代墊</span></h1>
      <p v-if="creating || !pr" class="muted" data-testid="pu-subtitle">繳費單位是公用事業（台電、台水、電信公司等），付款對象預設就是繳費單位；若是同仁先繳，可改選「同仁代墊」，公司再把錢還給同仁。一張請款單只含同一個繳費單位、同一個帳單月份。選好後系統會自動帶入該月可請款的帳單，你可以增減。</p>
      <p v-else class="muted" data-testid="pu-subtitle">{{ pr.status === "DRAFT" ? "草稿可以增減帳單、儲存或送出；送出後要改請先退回草稿。" : pr.status === "SUBMITTED" ? "已送出，等待會計付款；要修改內容請先退回草稿。" : pr.status === "PAID" ? "已付款，內容已鎖定，只能加備註或作廢。" : "已作廢，內容唯讀。" }}</p>
    </div>
    <div class="head-actions">
      <button v-if="pr" type="button" data-testid="pu-print" @click="printPage">列印請款單</button>
      <button v-if="pr" type="button" data-testid="pu-print-detail" @click="printDetailPage">列印明細版</button>
      <button type="button" data-testid="pu-back" @click="backToList">回請款單清單</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '請款單']">
    <p v-if="loading" role="status">載入中…</p>
    <p v-if="error" class="notice error pre" role="alert" data-testid="pu-error">{{ error }}</p>
    <p v-if="saved" class="notice success" role="status" data-testid="pu-saved">{{ saved }}</p>
    <p v-if="dropNote" class="notice" role="status" data-testid="pu-drop-note">{{ dropNote }}</p>
    <p v-if="!loading && creating && abilities && !canCreate" class="notice" role="status" data-testid="pu-need-perm">建立水電話費請款單需要「{{ abilities.missingForCreate.join("」與「") }}」權限。</p>
    <p v-else-if="!loading && abilities && !canManage" class="notice" role="status" data-testid="pu-readonly">你只有查看權限，不能處理請款單。</p>
    <p v-if="pr?.status === 'PAID'" class="notice" role="status" data-testid="pu-locked">已付款，內容鎖定，只能加備註或作廢。</p>
    <p v-if="pr?.status === 'VOID'" class="notice" role="status" data-testid="pu-void">已作廢（{{ timeText(pr.voided_at) }}，{{ pr.voided_by_name || "—" }}）：{{ pr.void_reason || "未填原因" }}。帳單已釋放，可以重新請款。</p>
    <p v-if="pr?.status === 'DRAFT' && pr.last_return_reason" class="notice" role="status" data-testid="pu-returned">上次退回原因：{{ pr.last_return_reason }}（退回時由這張請款單自動標記的帳單已改回待繳）</p>

    <section v-if="!loading" class="pe-box" data-testid="pu-info">
      <h2>基本資料</h2>
      <template v-if="creating">
        <div class="pe-grid">
          <label>繳費單位
            <select v-model="vendorId" :disabled="!canCreate" data-testid="pu-vendor" @change="pickVendor">
              <option value="">請選擇繳費單位</option>
              <option v-for="p in payees" :key="p.vendor_id" :value="p.vendor_id">{{ p.vendor_name }}（可請款 {{ p.eligible_count }} 張 {{ money(p.eligible_amount) }}）</option>
            </select>
          </label>
          <label>帳單月份<input v-model="month" type="month" :disabled="!canCreate" data-testid="pu-month" /></label>
        </div>
        <p v-if="!payees?.length && !candError" class="muted" data-testid="pu-no-payee-list">這個月還沒有指定繳費單位的帳單。請先到「水電電話網路費」為帳單指定繳費單位，並在廠商資料建立「公用事業」分類的廠商。</p>
      </template>
      <template v-else>
        <p>繳費單位：<strong data-testid="pu-vendor-name">{{ vendorName || "—" }}</strong>　帳單月份：<strong data-testid="pu-month-text">{{ month }}</strong></p>
        <div v-if="isEmployee && pr" class="pe-payee" data-testid="pu-payee-box">
          <p>付款對象：<strong data-testid="pu-payee-name">同仁代墊：{{ payeeName(pr) }}</strong>（同仁先繳，公司把錢還給同仁；繳費單位仍是上面那一家）</p>
          <p v-if="pr.payee_account_masked" class="muted" data-testid="pu-payee-masked">同仁匯款帳戶屬帳務機密，你沒有廠商帳務檢視權限，只顯示末四碼：{{ pr.payee_account_last4 || "（尚未登錄）" }}。</p>
          <p v-else-if="hasPayeeAccount" data-testid="pu-payee-account">同仁匯款帳戶（快照）：{{ payeeBankText(pr.payee_account_snapshot) }}</p>
          <p v-else class="notice" role="status" data-testid="pu-payee-no-account">這位同仁還沒有登錄匯款帳戶，送出前要先登錄：請同仁到右上角「我的代墊款」登錄，或由會計代為登錄{{ pr.status === "DRAFT" ? "，再按「重抓同仁匯款帳戶」" : "" }}。</p>
          <button v-if="canManage && abilities?.vendorVisible && pr.status !== 'VOID'" type="button" data-testid="pu-payee-register" @click="showRegister = true">代同仁登錄匯款帳戶</button>
        </div>
        <p v-if="pr && !editing && buyerText" data-testid="pu-buyer-text">買受人抬頭：{{ buyerText }}</p>
        <p v-if="pr?.vendor_masked" class="muted" data-testid="pu-masked">廠商統編與銀行帳號屬帳務機密，你沒有廠商查看權限，不顯示。</p>
        <template v-else-if="pr">
          <p data-testid="pu-tax">統一編號：{{ pr.vendor_tax_id_snapshot || "—" }}</p>
          <p v-if="!isEmployee" data-testid="pu-bank">收款帳號（建立時快照）：{{ bankText(pr.bank_snapshot) || "廠商未填寫銀行資料" }}</p>
          <p v-else class="muted" data-testid="pu-bank-hidden">同仁代墊：請依上方「同仁匯款帳戶」付款，這張單不匯給繳費單位，所以不顯示收款帳號。</p>
        </template>
        <p v-if="pr" class="muted">建立 {{ pr.created_by_name || "—" }} {{ timeText(pr.created_at) }}<template v-if="pr.submitted_at">；送出 {{ pr.submitted_by_name || "—" }} {{ timeText(pr.submitted_at) }}</template><template v-if="pr.paid_at">；付款 {{ pr.paid_by_name || "—" }} {{ timeText(pr.paid_at) }}</template></p>
        <p v-if="pr?.status === 'PAID'" data-testid="pu-paid-info">付款方式 {{ PAY_METHOD_LABELS[pr.pay_method as keyof typeof PAY_METHOD_LABELS] || pr.pay_method }}，付款日 {{ dateText(pr.paid_date) }}<template v-if="pr.paid_ref">，參考號 {{ pr.paid_ref }}</template></p>
        <p v-if="pr && !editing" data-testid="pu-auto-info">送出後帳單自動標記已繳：<strong>{{ pr.auto_mark_paid ? "是" : "否" }}</strong><template v-if="pr.auto_mark_paid && pr.status !== 'DRAFT'">　已標記 {{ pr.auto_marked_count ?? 0 }} 張</template><template v-if="(pr.auto_reverted_count ?? 0) > 0 && pr.status !== 'SUBMITTED' && pr.status !== 'PAID'">　已回復 {{ pr.auto_reverted_count }} 張</template></p>
      </template>
      <PayeeBuyerFields v-if="editing && !loading && abilities" v-model:payee-type="payeeType" v-model:payee-profile-id="payeeProfileId" v-model:payee-name="payeeNameText" v-model:buyer-company-id="buyerCompanyId" :companies="companies" :editing="editing" prefix="pu" @change="dirty" />
      <div class="pe-grid">
        <label>預計付款日<input v-model="expectedPayDate" type="date" :disabled="!editing" data-testid="pu-pay-date" @input="dirty" /><small class="muted">沒填就用這張單帳單最早的繳費期限；到期後系統會自動標記已付款。</small></label>
        <label>備註<input v-model="notes" maxlength="500" :disabled="!editing" data-testid="pu-notes" @input="dirty" /></label>
      </div>
      <label v-if="editing" class="pu-auto" data-testid="pu-auto-box"><span class="pu-auto-row"><input v-model="autoMark" type="checkbox" data-testid="pu-auto" @change="dirty" />送出後帳單自動標記已繳</span>
        <small class="muted" data-testid="pu-auto-help">勾選：送出請款單時，這些帳單會標記為已繳（繳費日期＝送出日）；請款單被退回或作廢時，會一併改回待繳。不勾選：帳單維持原狀，請你確認付款後自己到水電帳單標記。</small>
      </label>
    </section>

    <AutoPayBox v-if="!loading && pr" :pr="pr" :can-manage="canManage" test-prefix="pu" @updated="fillFrom" @stale="loadRequest" />
    <PrintFieldsBox v-if="!loading && pr" :pr="pr" :can-manage="canManage" test-prefix="pu" @saved="printFieldsSaved" />
    <section v-if="!loading && (creating ? !!vendorId : editing)" class="pe-box" data-testid="pu-candidates">
      <h2>帳單（{{ vendorName }} {{ month }}）</h2>
      <p v-if="noPayeeText" class="notice" role="status" data-testid="pu-no-payee-notice">{{ noPayeeText }}<button type="button" class="link" data-testid="pu-goto-bills" @click="goBills()">前往水電帳單補填</button></p>
      <p v-if="candError" class="notice error" role="alert" data-testid="pu-cand-error">{{ candError }}</p>
      <p v-if="candLoading" role="status">載入中…</p>
      <p v-if="cand?.bills_masked" class="notice" role="status" data-testid="pu-cand-masked">帳單明細需要「水電帳單檢視」權限（目前只看得到張數 {{ cand.bill_count }} 張、可請款 {{ cand.eligible_count }} 張、合計 {{ money(cand.eligible_amount) }}）。</p>
      <div v-if="bills.length" class="pu-tools"><button type="button" data-testid="pu-select-all" @click="selectAll(true)">全選可請款的帳單</button><button type="button" data-testid="pu-select-none" @click="selectAll(false)">全部取消</button></div>
      <table v-if="bills.length" class="pu-table" data-testid="pu-bills">
        <thead><tr><th>選</th><th>門市</th><th>費用類型</th><th>帳單月份</th><th>計費期間</th><th>電號／水號／用戶號碼</th><th class="r">金額</th><th>附件</th><th>狀態</th></tr></thead>
        <tbody>
          <tr v-for="b in bills" :key="b.id" :class="{ off: !b.eligible }" data-testid="pu-bill">
            <td data-label="選"><input type="checkbox" :checked="selected.has(b.id)" :disabled="(!b.eligible && !selected.has(b.id)) || !editing" :aria-label="'選擇 ' + billLabel(b)" data-testid="pu-bill-check" @change="toggle(b)" /></td>
            <td data-label="門市">{{ b.location_name }}</td>
            <td data-label="費用類型">{{ typeText(b.expense_type) }}</td>
            <td data-label="帳單月份">{{ String(b.billing_month).slice(0, 7) }}</td>
            <td data-label="計費期間" data-testid="pu-bill-period">{{ periodText(b.service_period_start, b.service_period_end) || "—" }}</td>
            <td data-label="識別號碼">{{ b.identifier || "—" }}</td>
            <td data-label="金額" class="r" data-testid="pu-bill-amount">{{ money(b.amount) }}</td>
            <td data-label="附件"><span v-if="Number(b.attachment_count) > 0" data-testid="pu-att-ok">{{ b.attachment_count }} 個</span><strong v-else class="bad" data-testid="pu-missing">缺附件</strong> <BillScanButton v-if="Number(b.attachment_count) > 0 && !billsMasked" :bill-id="b.id" :label="billLabel(b)" /></td>
            <td data-label="狀態"><span v-if="b.eligible" class="ok">可請款</span><span v-else class="muted" data-testid="pu-reason">{{ b.reason }}</span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!bills.length && !candLoading && !candError && vendorId && !cand?.bills_masked" class="muted" data-testid="pu-empty">這個繳費單位這個月沒有帳單。</p>
      <p class="pe-total">已選 <strong data-testid="pu-count">{{ selected.size }}</strong> 張，合計 <strong data-testid="pu-grand">{{ money(selectedTotal) }}</strong></p>
      <p v-if="missingBills.length" class="field-error" role="alert" data-testid="pu-warn-missing">有 {{ missingBills.length }} 張帳單還沒有附件（帳單照片或 PDF）：{{ missingBills.map(billLabel).join("、") }}。送出前要先上傳。<button type="button" class="link" data-testid="pu-goto-upload" @click="goBills()">前往上傳</button></p>
    </section>

    <section v-if="!loading && pr && !editing" class="pe-box" data-testid="pu-lines">
      <h2>請款明細（帳單）</h2>
      <p v-if="billsMasked || pr.bills_masked" class="muted" data-testid="pu-lines-masked">明細已遮蔽（需要水電帳單檢視權限）。這張請款單共 {{ pr.bill_count ?? 0 }} 張帳單，合計 {{ money(pr.amount_total) }}。</p>
      <table v-else class="pu-table" data-testid="pu-view-bills">
        <thead><tr><th>#</th><th>門市</th><th>費用類型</th><th>帳單月份</th><th>計費期間</th><th>電號／水號／用戶號碼</th><th class="r">金額</th><th>附件</th><th>帳單狀態</th></tr></thead>
        <tbody>
          <tr v-for="l in viewLines" :key="l.id" data-testid="pu-line">
            <td data-label="#">{{ l.line_no }}</td><td data-label="門市">{{ l.location_name }}</td><td data-label="費用類型">{{ typeText(l.expense_type) }}</td><td data-label="帳單月份">{{ String(l.billing_month).slice(0, 7) }}</td>
            <td data-label="計費期間" data-testid="pu-line-period">{{ periodText(l.service_period_start, l.service_period_end) || "—" }}</td>
            <td data-label="識別號碼">{{ l.identifier || "—" }}</td><td data-label="金額" class="r">{{ money(l.claim_total) }}</td>
            <td data-label="附件">{{ l.attachment_count }} 個 <BillScanButton v-if="Number(l.attachment_count) > 0 && !l.bill_deleted" :bill-id="l.bill_id" :label="billLabel(l)" /></td><td data-label="帳單狀態" data-testid="pu-line-state">{{ lineState(l) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="pe-total">合計 <strong data-testid="pu-total">{{ money(pr.amount_total) }}</strong>（水電帳單金額視為含稅應繳金額）</p>
    </section>

    <section v-if="pr?.events?.length" class="pe-box" data-testid="pu-events">
      <h2>操作紀錄</h2>
      <ol class="pe-timeline">
        <li v-for="e in pr.events" :key="e.id" data-testid="pu-event"><strong>{{ EVENT_LABELS[e.event_type] || e.event_type }}</strong>　{{ e.actor_name || (e.payload?.auto ? "系統" : "—") }}　{{ timeText(e.created_at) }}<template v-if="e.reason">：{{ e.reason }}</template></li>
      </ol>
      <p class="muted">操作紀錄不可修改或刪除。</p>
    </section>

    <div v-if="!loading" class="dialog-actions pe-actions">
      <template v-if="editing">
        <button v-if="pr" type="button" :disabled="saving || actBusy" data-testid="pu-refresh" @click="refresh">重新帶入帳單金額</button>
        <button v-if="pr && actions.includes('refresh_bank')" type="button" :disabled="actBusy || saving" data-testid="pu-refresh-bank" @click="quick('refresh_bank')">{{ isEmployee ? "重抓同仁匯款帳戶" : "重抓廠商帳號" }}</button>
        <button type="button" class="primary" :disabled="saving || (creating && !vendorId)" data-testid="pu-save" @click="save">{{ saving ? "儲存中…" : creating ? "建立草稿" : "儲存草稿" }}</button>
      </template>
      <button v-if="actions.includes('submit')" type="button" class="primary" :disabled="actBusy || saving" data-testid="pu-submit" @click="ask('submit')">送出請款</button>
      <button v-if="actions.includes('return')" type="button" :disabled="actBusy" data-testid="pu-return" @click="ask('return')">退回草稿</button>
      <button v-if="actions.includes('mark_paid')" type="button" class="primary" :disabled="actBusy" data-testid="pu-paid" @click="ask('mark_paid')">標記已付款</button>
      <button v-if="actions.includes('note')" type="button" :disabled="actBusy" data-testid="pu-note" @click="ask('note')">加備註</button>
      <button v-if="actions.includes('void')" type="button" class="danger" :disabled="actBusy" data-testid="pu-void-btn" @click="ask('void')">作廢</button>
    </div>

    <Modal v-if="acting" :title="PR_ACTION_LABELS[acting]" :busy="actBusy" @cancel="acting = null">
      <template v-if="acting === 'submit'">
        <p>送出後內容不能直接修改（要改請先退回草稿），由會計付款。確定送出請款單 {{ pr?.pr_no }}（{{ money(pr?.amount_total) }}）？</p>
        <p v-if="pr?.auto_mark_paid" class="notice" data-testid="act-auto-note">送出後，這 {{ autoCount }} 張帳單會標記為已繳（繳費日期＝今天）。</p>
        <p v-else class="muted" data-testid="act-auto-note">這張請款單沒有勾選自動標記，帳單維持待繳，付款後請到水電帳單自己標記。</p>
      </template>
      <p v-else-if="acting === 'return'">退回後變回草稿，總務可以修改再送出。<template v-if="pr?.auto_mark_paid">由這張請款單自動標記已繳的帳單會改回待繳，手動標記的不動。</template></p>
      <template v-else-if="acting === 'void'">
        <p>作廢後帳單釋放，可以重新請款，不能復原。<template v-if="pr?.auto_mark_paid">由這張請款單自動標記已繳的帳單會改回待繳，手動標記的不動。</template></p>
        <p v-if="pr?.status === 'PAID'" class="notice error" role="alert" data-testid="act-void-paid-warning">{{ voidPaidWarning }}</p>
      </template>
      <template v-if="acting === 'mark_paid'">
        <PaidFields v-model:method="actMethod" v-model:card="actCard" v-model:platform="actPlatform" :employee="isEmployee" />
        <label>付款日期<input v-model="actDate" type="date" :min="paidRange.min" :max="paidRange.max" data-testid="act-date" /></label>
        <p class="muted" data-testid="act-date-hint">付款日期可以比請款單建立日（{{ createdDay }}）早，但最多早 {{ PAID_BACKDATE_DAYS }} 天（最早 {{ paidRange.min }}），不能是未來。標記已付款不會改動帳單的繳費狀態。</p>
        <label>付款參考號（轉帳末五碼、支票號碼等，選填）<input v-model="actRef" maxlength="60" data-testid="act-ref" /></label>
      </template>
      <label v-if="acting === 'return' || acting === 'void' || acting === 'note'">{{ acting === "return" ? "退回原因" : acting === "void" ? (reasonNeeded ? "作廢原因" : "作廢原因（草稿可不填）") : "備註內容" }}<input v-model="actReason" maxlength="500" data-testid="act-reason" /></label>
      <p v-if="actError" class="field-error" role="alert" data-testid="act-error">{{ actError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="actBusy" @click="acting = null">取消</button>
        <button type="button" class="primary" :disabled="actBusy" data-testid="act-confirm" @click="confirmAct">{{ actBusy ? "處理中…" : "確認" }}</button>
      </div>
    </Modal>

    <PayoutAccountDialog v-if="showRegister && pr?.payee_profile_id" :who="pr.payee_profile_id" :label="payeeName(pr)" @close="showRegister = false" @saved="accountSaved" />
    <Modal v-if="missingList" title="有帳單還沒有附件" @cancel="missingList = null">
      <p data-testid="missing-intro">每張帳單送出前至少要有一個附件（帳單照片或 PDF）。下面 {{ missingList.length }} 張缺附件，請先上傳；請款單維持草稿。</p>
      <ul class="pu-missing-list" data-testid="missing-list">
        <li v-for="m in missingList" :key="m.bill_id" data-testid="missing-item">{{ billLabel(m) }}　{{ money(m.amount) }}　<button type="button" class="link" data-testid="missing-goto" @click="goBills(m.identifier || m.location_name); missingList = null">前往上傳</button></li>
      </ul>
      <div class="dialog-actions"><button type="button" class="primary" data-testid="missing-close" @click="missingList = null">知道了</button></div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.pe-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; margin-bottom: 14px; }
.pe-box h2 { margin: 0; font-size: 16px; }
.pe-box label { display: grid; gap: 4px; min-width: 0; }
.pe-box p { margin: 0; overflow-wrap: anywhere; }
.pe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.pe-total { font-size: 16px; }
.pe-timeline { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; }
.pe-actions { flex-wrap: wrap; }
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.st { display: inline-block; margin-left: 10px; border-radius: 10px; padding: 1px 10px; font-size: 13px; font-weight: 600; border: 1px solid var(--line); vertical-align: middle; }
.st.submitted { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
.st.paid { color: #1b6e3a; border-color: #9fd2b0; background: #e8f6ec; }
.st.void { color: var(--muted); }
.src { display: inline-block; margin-left: 8px; border-radius: 6px; padding: 1px 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); vertical-align: middle; }
.pre { white-space: pre-wrap; }
.src.emp { color: #7a3d00; }
.pe-payee { display: grid; gap: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: var(--soft); min-width: 0; }
.pu-auto { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--soft); }
.pu-auto-row { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.pu-auto-row input { width: auto; min-height: 0; }
.pu-tools { display: flex; flex-wrap: wrap; gap: 8px; }
.pu-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.pu-table th, .pu-table td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; }
.pu-table .r { text-align: right; white-space: nowrap; }
.pu-table tr.off td { color: var(--muted); }
.pu-table .ok { color: #1b6e3a; }
.bad { color: #b3261e; }
.pu-missing-list { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) {
  .dialog-actions button, .head-actions button, .pu-tools button { min-height: 44px; }
  .pu-table { min-width: 0; }
  .pu-table thead { display: none; }
  .pu-table, .pu-table tbody, .pu-table tr, .pu-table td { display: block; width: 100%; }
  .pu-table tr { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; }
  .pu-table td { border: 0; padding: 2px 0; display: flex; gap: 8px; justify-content: space-between; text-align: right; }
  .pu-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-align: left; }
  .pu-table td.r { text-align: right; }
  .pu-table td input[type="checkbox"] { width: 24px; height: 24px; }
}
</style>
