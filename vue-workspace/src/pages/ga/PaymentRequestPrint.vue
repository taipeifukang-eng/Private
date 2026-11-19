<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import { PAY_METHOD_LABELS, PR_STATUS_LABELS, bankText, dateText, errorText, money, timeText, type PaymentRequest } from "../../lib/ga-payments";
import { INVOICE_TYPE_LABELS } from "../../lib/ga-invoices";
import { useWorkspace, type WorkTab } from "../../stores";

// 第 4.5 批 請款單 A4 列印頁（/general-affairs/payment-requests/:id/print）：抬頭用請款設定的買受人；
// 廠商統編與銀行帳號沒有廠商查看權限時整區省略；簽章區顯示總務請款與會計付款的人與時間。列印只輸出紙張那一塊。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const pr = ref<PaymentRequest | null>(null);
const buyer = ref<{ title: string | null; tax_id: string | null }>({ title: null, tax_id: null });
const loading = ref(true);
const error = ref("");
const prId = computed(() => props.tab.recordId || "");
const lines = computed(() => pr.value?.lines || []);

onMounted(async () => {
  if (!allowed.value) { loading.value = false; return; }
  try {
    const res = await api<{ data: PaymentRequest; buyer: { title: string | null; tax_id: string | null } }>(`general-affairs/payment-requests/${prId.value}`);
    pr.value = res.data;
    buyer.value = res.buyer || buyer.value;
    props.tab.title = `列印 ${res.data.pr_no}`;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
});
const printNow = () => window.print();
function back() { if (pr.value) openGaPage("ga-payment-request-edit", pr.value.id); work.remove([props.tab.id]); }
</script>

<template>
  <header class="page-heading no-print">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>請款單列印</h1>
      <p class="muted">A4 直式。按「列印」只會輸出下方紙張內容。</p>
    </div>
    <div class="head-actions">
      <button type="button" data-testid="pp-back" @click="back">回請款單</button>
      <button type="button" class="primary" :disabled="!pr" data-testid="pp-print" @click="printNow">列印</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '請款單列印']">
    <p v-if="loading" role="status" class="no-print">載入中…</p>
    <p v-if="error" class="notice error no-print" role="alert" data-testid="pp-error">{{ error }}</p>
    <article v-if="pr" class="pp-sheet" data-testid="pp-sheet">
      <h2 class="pp-title" data-testid="pp-buyer">{{ buyer.title || "請款單" }}<span v-if="buyer.title">　請款單</span></h2>
      <p v-if="buyer.tax_id" class="pp-sub" data-testid="pp-buyer-tax">統一編號 {{ buyer.tax_id }}</p>
      <table class="pp-meta">
        <tbody>
          <tr><th>請款單號</th><td data-testid="pp-no">{{ pr.pr_no }}</td><th>狀態</th><td>{{ PR_STATUS_LABELS[pr.status] }}</td></tr>
          <tr><th>廠商</th><td data-testid="pp-vendor">{{ pr.vendor_name_snapshot }}</td><th>建立日期</th><td>{{ dateText(pr.created_at) }}</td></tr>
          <template v-if="!pr.vendor_masked">
            <tr data-testid="pp-secret"><th>統一編號</th><td>{{ pr.vendor_tax_id_snapshot || "—" }}</td><th>預計付款日</th><td>{{ dateText(pr.expected_pay_date) || "—" }}</td></tr>
            <tr data-testid="pp-bank"><th>收款帳號</th><td colspan="3">{{ bankText(pr.bank_snapshot) || "廠商未填寫銀行資料" }}</td></tr>
          </template>
          <tr v-else><th>預計付款日</th><td colspan="3">{{ dateText(pr.expected_pay_date) || "—" }}</td></tr>
        </tbody>
      </table>
      <table class="pp-lines" data-testid="pp-lines">
        <thead><tr><th>#</th><th>採購單</th><th>進貨單</th><th>發票</th><th class="r">未稅</th><th class="r">稅額</th><th class="r">請款金額</th></tr></thead>
        <tbody>
          <tr v-for="l in lines" :key="l.id" data-testid="pp-line">
            <td>{{ l.line_no }}</td><td>{{ l.po_no }}</td><td>{{ l.receipt_no }}</td>
            <td>{{ l.invoice_no || (l.invoice_type ? INVOICE_TYPE_LABELS[l.invoice_type as keyof typeof INVOICE_TYPE_LABELS] : "—") }}</td>
            <td class="r">{{ money(l.claim_untaxed) }}</td><td class="r">{{ money(l.claim_tax) }}</td><td class="r">{{ money(l.claim_total) }}</td>
          </tr>
        </tbody>
        <tfoot><tr><td colspan="4">合計</td><td class="r">{{ money(pr.amount_untaxed) }}</td><td class="r">{{ money(pr.amount_tax) }}</td><td class="r" data-testid="pp-total">{{ money(pr.amount_total) }}</td></tr></tfoot>
      </table>
      <p v-if="pr.notes" class="pp-note">備註：{{ pr.notes }}</p>
      <p v-if="pr.status === 'PAID'" class="pp-note" data-testid="pp-paid">付款方式：{{ PAY_METHOD_LABELS[pr.pay_method as keyof typeof PAY_METHOD_LABELS] || pr.pay_method }}　付款日：{{ dateText(pr.paid_date) }}<template v-if="pr.paid_ref">　參考號：{{ pr.paid_ref }}</template></p>
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
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  :global(body *) { visibility: hidden; }
  .pp-sheet, .pp-sheet * { visibility: visible; }
  .pp-sheet { position: absolute; left: 0; top: 0; width: 100%; border: 0; padding: 0; }
  .no-print { display: none !important; }
}
@media (max-width: 700px) { .head-actions button { min-height: 44px; } .pp-sheet { padding: 8mm 4mm; } }
</style>
