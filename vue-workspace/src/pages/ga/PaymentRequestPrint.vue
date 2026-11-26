<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import { PAY_METHOD_LABELS, PR_STATUS_LABELS, UTILITY_PRINT_HEADERS, bankText, dateText, errorText, isUtilityRequest, money, payeeBankText, payeeName, timeText, utilityPrintRow, type PaymentRequest } from "../../lib/ga-payments";
import { INVOICE_TYPE_LABELS } from "../../lib/ga-invoices";
import { useWorkspace, type WorkTab } from "../../stores";
import { SIGN_CELL_SUFFIX, buildPaperPrint, moneyCell } from "../../../../lib/workspace/general-affairs/payment-print-rules";

// 第 4.5 批 請款單 A4 列印頁（/general-affairs/payment-requests/:id/print）：抬頭用請款設定的買受人；
// 廠商統編與銀行帳號沒有廠商查看權限時整區省略；簽章區顯示總務請款與會計付款的人與時間。列印只輸出紙張那一塊。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const pr = ref<PaymentRequest | null>(null);
const buyer = ref<{ title: string | null; tax_id: string | null }>({ title: null, tax_id: null });
type PrintExtra = Parameters<typeof buildPaperPrint>[1];
const extra = ref<PrintExtra>(null);
// 預設是紙本格式（「列印請款單」）；「列印明細版」是原本的 A4 明細版面。請款單頁的兩顆按鈕用頁籤 payload.layout 指定。
const layoutOf = (p: unknown): "paper" | "detail" => ((p as { layout?: string } | undefined)?.layout === "detail" ? "detail" : "paper");
const layout = ref<"paper" | "detail">(layoutOf(props.tab.payload));
watch(() => props.tab.payload, (p) => { layout.value = layoutOf(p); });
const paper = computed(() => (pr.value ? buildPaperPrint(pr.value, extra.value, buyer.value.title) : null));
const loading = ref(true);
const error = ref("");
const prId = computed(() => props.tab.recordId || "");
const lines = computed(() => pr.value?.lines || []);
// G46 水電話費請款單：明細改列「門市、費用類型、帳單月份、電號／水號／用戶號碼、金額」；沒有採購單、進貨單、發票、未稅、稅額。
const utility = computed(() => isUtilityRequest(pr.value));
// ga-improve-b1：預付款單標題加「（預付款）」並列出採購單號；同仁代墊顯示付款對象（同仁）與匯款帳戶（沒有帳務權限只露末四碼）；抬頭用請款單送出時的快照或所選公司。
const prepay = computed(() => pr.value?.pay_kind === "PREPAY");
const employee = computed(() => pr.value?.payee_type === "EMPLOYEE");
const payeeAccount = computed(() => (pr.value?.payee_account_snapshot || {}) as Record<string, string | null>);
const billRows = computed(() => (pr.value?.bill_lines || []).map((l) => ({ id: l.id, no: l.line_no, cells: utilityPrintRow(l) })));

async function load() {
  if (!allowed.value) { loading.value = false; return; }
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: PaymentRequest; buyer: { title: string | null; tax_id: string | null }; print_extra?: PrintExtra }>(`general-affairs/payment-requests/${prId.value}`);
    pr.value = res.data;
    extra.value = res.print_extra ?? null;
    buyer.value = res.buyer || buyer.value;
    props.tab.title = `列印 ${res.data.pr_no}`;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// 既有列印頁籤會被重用（openGaPage 只更新 payload）：再次開啟或切回這一頁時重新取資料，避免印出舊的申請人、事由。
watch(() => props.tab.payload, () => { void load(); });
watch(() => work.active === props.tab.id, (on, was) => { if (on && !was && !loading.value) void load(); });
// 只有這一頁在前景時才套用「只印紙張」的全域列印樣式（頁籤用 v-show 保留，不能影響其他頁的列印）。
const active = computed(() => work.active === props.tab.id);
watchEffect(() => document.body.classList.toggle("printing-payment", active.value));
onBeforeUnmount(() => document.body.classList.remove("printing-payment"));
const printNow = () => window.print();
function back() { if (pr.value) openGaPage("ga-payment-request-edit", pr.value.id); work.remove([props.tab.id]); }
</script>

<template>
  <header class="page-heading no-print">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>請款單列印</h1>
      <p class="muted">A4 直式。按「列印」只會輸出下方紙張內容。目前是{{ layout === "paper" ? "紙本格式請款單" : "明細版" }}。</p>
    </div>
    <div class="head-actions">
      <button type="button" data-testid="pp-back" @click="back">回請款單</button>
      <button v-if="layout === 'paper'" type="button" data-testid="pp-layout-detail" @click="layout = 'detail'">切換到明細版</button>
      <button v-else type="button" data-testid="pp-layout-paper" @click="layout = 'paper'">切換到紙本格式</button>
      <button type="button" class="primary" :disabled="!pr" data-testid="pp-print" @click="printNow">列印</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '請款單列印']">
    <p v-if="loading" role="status" class="no-print">載入中…</p>
    <p v-if="error" class="notice error no-print" role="alert" data-testid="pp-error">{{ error }}</p>
    <article v-if="pr && paper && layout === 'paper'" class="pp-sheet pp-paper" data-testid="pp-paper">
      <h2 class="pk-title" data-testid="pk-title">{{ paper.title }}</h2>
      <p class="pk-sub" data-testid="pk-subtitle">{{ paper.subtitle }}</p>
      <div class="pk-meta" data-testid="pk-meta">
        <span>申請部門：<b data-testid="pk-dept">{{ paper.dept }}</b></span>
        <span>申請人：<b data-testid="pk-applicant">{{ paper.applicant }}</b></span>
        <span>檢附單據：<b data-testid="pk-attach">{{ paper.attach }}</b></span>
        <span>申請日期：<b data-testid="pk-date">{{ paper.applyDate }}</b></span>
        <span>登錄：<b>{{ paper.register }}</b></span>
      </div>
      <table class="pk-table" data-testid="pk-table">
        <thead><tr><th class="c-no">項<br />次</th><th class="c-unit">使　用　單　位</th><th class="c-reason">申　請　事　由</th><th class="c-amt">金額</th><th class="c-order">內部訂單</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in paper.rows" :key="i" data-testid="pk-row">
            <td class="c-no">{{ r.no ?? "" }}</td><td>{{ r.unit }}</td><td>{{ r.reason }}</td>
            <td class="amt"><template v-if="r.amount !== null"><span class="cur">$</span><span>{{ moneyCell(r.amount) }}</span></template></td><td>{{ r.order }}</td>
          </tr>
          <tr class="pk-sum"><td colspan="3" class="mid" data-testid="pk-tax-label">{{ paper.taxLabel }}</td><td class="amt" data-testid="pk-tax"><span>{{ moneyCell(paper.tax) }}</span></td><td></td></tr>
          <tr class="pk-sum"><td colspan="3" class="mid">合　　　　計</td><td class="amt" data-testid="pk-total"><span class="cur">$</span><span>{{ moneyCell(paper.total) }}</span></td><td></td></tr>
        </tbody>
      </table>
      <div class="pk-pay" data-testid="pk-pay">
        <span>付款方式：<span data-testid="pk-box-transfer">{{ paper.pay.transfer ? "☑" : "□" }}</span>匯款　<span data-testid="pk-box-check">{{ paper.pay.check ? "☑" : "□" }}</span>支票　<span data-testid="pk-box-cash">{{ paper.pay.cash ? "☑" : "□" }}</span>零用金　<span data-testid="pk-box-other">{{ paper.pay.other ? "☑" : "□" }}</span>其他：<u class="pk-other" data-testid="pk-other-text">{{ paper.pay.otherText }}</u></span>
        <span>到期日：<b data-testid="pk-due">{{ paper.dueDate }}</b></span>
      </div>
      <div class="pk-pay">
        <span>付款對象：<b data-testid="pk-payee">{{ paper.payee }}</b></span>
        <span>授款人簽收：</span>
      </div>
      <div class="pk-sign" data-testid="pk-sign">
        <div v-for="(row, ri) in paper.signRows" :key="ri" class="pk-sign-row">
          <span v-for="cell in row" :key="cell" class="pk-sign-cell">{{ cell }}：<u></u>{{ SIGN_CELL_SUFFIX[cell] || "" }}</span>
        </div>
      </div>
      <p class="pk-note">{{ paper.signNote }}</p>
      <p class="pk-no" data-testid="pk-no">系統單號 {{ paper.prNo }}</p>
    </article>
    <article v-if="pr && layout === 'detail'" class="pp-sheet" data-testid="pp-sheet">
      <h2 class="pp-title" data-testid="pp-buyer">{{ buyer.title || "請款單" }}<span v-if="buyer.title">　請款單</span><span v-if="prepay" data-testid="pp-prepay-title">（預付款）</span></h2>
      <p v-if="buyer.tax_id" class="pp-sub" data-testid="pp-buyer-tax">統一編號 {{ buyer.tax_id }}</p>
      <table class="pp-meta">
        <tbody>
          <tr><th>請款單號</th><td data-testid="pp-no">{{ pr.pr_no }}</td><th>狀態</th><td>{{ PR_STATUS_LABELS[pr.status] }}</td></tr>
          <tr><th>{{ utility ? "繳費單位" : "廠商" }}</th><td data-testid="pp-vendor">{{ pr.vendor_name_snapshot }}</td><th>建立日期</th><td>{{ dateText(pr.created_at) }}</td></tr>
          <tr v-if="prepay"><th>採購單</th><td data-testid="pp-prepay-po">{{ pr.prepay_po_no || (pr.po_nos || [])[0] || "—" }}</td><th>類型</th><td>預付款</td></tr>
          <tr v-if="employee" data-testid="pp-payee-row"><th>付款對象</th><td colspan="3"><span data-testid="pp-payee">同仁代墊：{{ payeeName(pr) }}</span><template v-if="pr.payee_account_masked">　匯款帳戶末四碼 {{ pr.payee_account_last4 || "—" }}</template><template v-else-if="payeeAccount.bank_account"><br /><span data-testid="pp-payee-account">{{ payeeBankText(pr.payee_account_snapshot) }}</span></template><template v-else><br />（同仁尚未登錄匯款帳戶）</template></td></tr>
          <tr v-if="utility"><th>來源</th><td data-testid="pp-source">水電話費</td><th>帳單月份</th><td data-testid="pp-bill-month">{{ String(pr.bill_month || "").slice(0, 7) }}</td></tr>
          <template v-if="!pr.vendor_masked">
            <tr data-testid="pp-secret"><th>統一編號</th><td>{{ pr.vendor_tax_id_snapshot || "—" }}</td><th>預計付款日</th><td>{{ dateText(pr.expected_pay_date) || "—" }}</td></tr>
            <tr v-if="!employee" data-testid="pp-bank"><th>收款帳號</th><td colspan="3">{{ bankText(pr.bank_snapshot) || "廠商未填寫銀行資料" }}</td></tr>
          </template>
          <tr v-else><th>預計付款日</th><td colspan="3">{{ dateText(pr.expected_pay_date) || "—" }}</td></tr>
        </tbody>
      </table>
      <table v-if="utility" class="pp-lines" data-testid="pp-lines">
        <thead><tr><th>#</th><th v-for="h in UTILITY_PRINT_HEADERS" :key="h" :class="{ r: h === '金額' }">{{ h }}</th></tr></thead>
        <tbody>
          <tr v-for="r in billRows" :key="r.id" data-testid="pp-line"><td>{{ r.no }}</td><td v-for="(c, i) in r.cells" :key="i" :class="{ r: i === 4 }">{{ i === 4 ? money(Number(c)) : c }}</td></tr>
          <tr v-if="pr.bills_masked" data-testid="pp-bills-masked"><td :colspan="UTILITY_PRINT_HEADERS.length + 1">明細已遮蔽（需要水電帳單檢視權限），本請款單共 {{ pr.bill_count ?? 0 }} 張帳單。</td></tr>
        </tbody>
        <tfoot><tr><td :colspan="UTILITY_PRINT_HEADERS.length">合計</td><td class="r" data-testid="pp-total">{{ money(pr.amount_total) }}</td></tr></tfoot>
      </table>
      <table v-else-if="prepay" class="pp-lines" data-testid="pp-lines">
        <thead><tr><th>項目</th><th>採購單</th><th class="r">未稅</th><th class="r">稅額</th><th class="r">預付金額</th></tr></thead>
        <tbody><tr data-testid="pp-line"><td>預付款</td><td>{{ pr.prepay_po_no || (pr.po_nos || [])[0] || "—" }}</td><td class="r">{{ money(pr.amount_untaxed) }}</td><td class="r" data-testid="pp-tax">{{ money(pr.tax_amount) }}</td><td class="r" data-testid="pp-total">{{ money(pr.amount_total) }}</td></tr></tbody>
      </table>
      <table v-else class="pp-lines" data-testid="pp-lines">
        <thead><tr><th>#</th><th>採購單</th><th>進貨單</th><th>發票</th><th class="r">未稅</th><th class="r">稅額</th><th class="r">請款金額</th></tr></thead>
        <tbody>
          <tr v-for="l in lines" :key="l.id" data-testid="pp-line">
            <td>{{ l.line_no }}</td><td>{{ l.po_no }}</td><td>{{ l.receipt_no }}</td>
            <td>{{ l.invoice_no || (l.invoice_type ? INVOICE_TYPE_LABELS[l.invoice_type as keyof typeof INVOICE_TYPE_LABELS] : "—") }}</td>
            <td class="r">{{ money(l.claim_untaxed) }}</td><td class="r">{{ money(l.claim_tax) }}</td><td class="r">{{ money(l.claim_total) }}</td>
          </tr>
        </tbody>
        <tfoot><tr><td colspan="4">合計</td><td class="r">{{ money(pr.amount_untaxed) }}</td><td class="r" data-testid="pp-tax">{{ money(pr.tax_amount) }}</td><td class="r" data-testid="pp-total">{{ money(pr.amount_total) }}</td></tr></tfoot>
      </table>
      <p v-if="pr.notes" class="pp-note">備註：{{ pr.notes }}</p>
      <p v-if="pr.status === 'PAID'" class="pp-note" data-testid="pp-paid">付款方式：{{ PAY_METHOD_LABELS[pr.pay_method as keyof typeof PAY_METHOD_LABELS] || pr.pay_method }}<template v-if="pr.pay_card_last4 || pr.card_last4">（卡號末四碼 {{ pr.pay_card_last4 || pr.card_last4 }}）</template><template v-if="pr.pay_platform || pr.platform">（平台 {{ pr.pay_platform || pr.platform }}）</template>　付款日：{{ dateText(pr.paid_date) }}<template v-if="pr.paid_ref">　參考號：{{ pr.paid_ref }}</template></p>
      <div class="pp-sign" data-testid="pp-sign">
        <div><strong>總務請款</strong><span data-testid="pp-sign-ga">{{ pr.submitted_by_name || "（尚未送出）" }}</span><small>{{ timeText(pr.submitted_at) }}</small></div>
        <div><strong>會計付款</strong><span data-testid="pp-sign-acc">{{ pr.paid_by_name || "（尚未付款）" }}</span><small>{{ timeText(pr.paid_at) }}</small></div>
      </div>
    </article>
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-sheet { background: #fff; color: #111; width: 210mm; max-width: 100%; min-height: 120mm; padding: 14mm 12mm; border: 1px solid var(--line); box-sizing: border-box; margin: 0 auto; overflow-x: auto; }
.pp-title { text-align: center; font-size: 20px; margin: 0 0 4px; }
.pp-sub { text-align: center; margin: 0 0 12px; font-size: 13px; }
.pp-meta, .pp-lines { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }
.pp-meta th, .pp-meta td, .pp-lines th, .pp-lines td { border: 1px solid #888; padding: 4px 8px; text-align: left; overflow-wrap: anywhere; }
.pp-meta th { background: #f1f1f1; width: 18%; white-space: nowrap; }
.pp-lines th { background: #f1f1f1; }
.pp-lines .r { text-align: right; white-space: nowrap; }
.pp-note { font-size: 13px; margin: 4px 0; }
.pp-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 28px; }
.pp-sign div { border: 1px solid #888; padding: 10px; min-height: 70px; display: grid; gap: 4px; align-content: start; }
.pp-sign small { color: #555; }
/* 紙本格式請款單：A4 直式，內容在上半頁（參考富康紙本請款單）。 */
.pp-paper { min-height: 0; font-size: 13px; line-height: 1.5; padding: 10mm 8mm 8mm; overflow-x: visible; }
.pk-title { text-align: center; font-size: 22px; letter-spacing: 3px; margin: 0; }
.pk-sub { text-align: center; font-size: 16px; letter-spacing: 6px; margin: 2px 0 12px; font-weight: 600; }
.pk-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 6px; }
.pk-meta b, .pk-pay b { font-weight: 600; }
.pk-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #111; }
.pk-table th, .pk-table td { border: 1px solid #111; padding: 3px 6px; height: 26px; overflow-wrap: anywhere; vertical-align: middle; }
.pk-table th { font-weight: 600; text-align: center; }
.pk-table .c-no { width: 8%; text-align: center; }
.pk-table .c-unit { width: 24%; }
.pk-table .c-reason { width: 36%; }
.pk-table .c-amt { width: 17%; }
.pk-table .c-order { width: 15%; }
.pk-table td.amt { white-space: nowrap; text-align: right; }
.pk-table td.amt .cur { float: left; }
.pk-table td.mid { text-align: center; letter-spacing: 2px; }
.pk-pay { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin-top: 12px; }
.pk-other { display: inline-block; min-width: 90px; text-align: center; }
.pk-sign { display: grid; gap: 10px; margin-top: 16px; }
.pk-sign-row { display: flex; gap: 18px; }
.pk-sign-cell { flex: 1 1 0; display: flex; align-items: flex-end; white-space: nowrap; }
.pk-sign-cell u { flex: 1; min-width: 40px; border-bottom: 1px solid #111; text-decoration: none; height: 1.3em; }
.pk-note { font-size: 11px; margin: 10px 0 0; }
.pk-no { text-align: right; font-size: 10px; color: #555; margin: 14px 0 0; }
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  :global(body.printing-payment *) { visibility: hidden; }
  .pp-sheet, .pp-sheet * { visibility: visible; }
  .pp-sheet { position: absolute; left: 0; top: 0; width: 100%; border: 0; padding: 0; }
  .no-print { display: none !important; }
}
@media (max-width: 700px) { .head-actions button { min-height: 44px; } .pp-sheet { padding: 8mm 4mm; } }
</style>
