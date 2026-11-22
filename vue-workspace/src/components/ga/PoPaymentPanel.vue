<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { openGaPage } from "../../lib/ga";
import { INVOICE_TYPE_LABELS, VOUCHER_LABELS, dateText, errorText, money, type PayAbilities } from "../../lib/ga-invoices";

// 採購單詳情的「發票與請款」分頁：這張採購單的進貨憑證狀態、已連發票、累計驗入含稅額、已請款、已付款、尚可請款額。
// 金額與入口只給請款檢視／管理權限者（伺服端判斷，沒有權限整個分頁不出現）；登錄憑證與新增發票需要請款管理權限。
// 「登錄憑證」：沒有發票或只有收據、對方免開發票的進貨，記下原因（免開發票／僅收據）；連了有效發票的進貨由發票決定，不能手動改。
const props = defineProps<{ poId: string }>();
const emit = defineEmits<{ changed: [] }>();
type Rec = {
  receipt_id: string; receipt_no: string; received_date: string; delivery_note_no: string | null; voucher_status: string; voucher_note: string | null; voided: boolean; updated_at: string;
  untaxed: number; total: number; claimed: number; invoices: Array<{ id: string; invoice_no: string | null; invoice_type: keyof typeof INVOICE_TYPE_LABELS; amount_total: number; missing_image: boolean }>;
};
type Summary = {
  po_no: string; po_status: string; tax_rate: number; tolerance: number; received_total: number; claimed_total: number; paid_total: number; claimable: number; claimable_max: number;
  receipts: Rec[]; requests: Array<{ id: string; pr_no: string; status: string; claim_total: number }>; can_manage: boolean;
};
const data = ref<Summary | null>(null);
const abilities = ref<PayAbilities | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const target = ref<Rec | null>(null);
const vStatus = ref<"NO_INVOICE" | "NONE">("NO_INVOICE");
const vNote = ref("");
const vError = ref("");
const vBusy = ref(false);
const canManage = computed(() => !!abilities.value?.canManage && !!data.value?.can_manage);
const PR_STATUS: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已送出", PAID: "已付款", VOID: "已作廢" };

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: Summary; permissions: PayAbilities }>(`general-affairs/purchase-orders/${props.poId}/payment-summary`);
    data.value = res.data;
    abilities.value = res.permissions;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openVoucher(receiptId: string) {
  const r = data.value?.receipts.find((x) => x.receipt_id === receiptId);
  if (!r) return;
  target.value = r;
  vStatus.value = r.voucher_status === "NO_INVOICE" ? "NONE" : "NO_INVOICE";
  vNote.value = r.voucher_note || "";
  vError.value = "";
}
defineExpose({ openVoucher, load });
async function saveVoucher() {
  if (!target.value || vBusy.value) return;
  if (vStatus.value === "NO_INVOICE" && !vNote.value.trim()) { vError.value = "請填寫沒有發票的原因（例如僅有送貨單、對方免開發票）"; return; }
  vBusy.value = true;
  vError.value = "";
  try {
    await api(`general-affairs/purchase-orders/${props.poId}/receipts/${target.value.receipt_id}/voucher`, {
      method: "PATCH", body: JSON.stringify({ status: vStatus.value, note: vStatus.value === "NO_INVOICE" ? vNote.value.trim() : "", expected_updated_at: target.value.updated_at }),
    });
    target.value = null;
    notice.value = "已登錄進貨憑證。";
    emit("changed");
    await load();
  } catch (e) {
    vError.value = errorText(e);
  } finally {
    vBusy.value = false;
  }
}
</script>

<template>
  <section class="pp" data-testid="po-payment-panel">
    <p v-if="loading" role="status">載入中…</p>
    <p v-if="error" class="notice error" role="alert" data-testid="pp-error">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status" data-testid="pp-notice">{{ notice }}</p>
    <template v-if="data">
      <ul class="pp-stats" aria-label="請款摘要">
        <li><span>累計驗入（含稅）</span><strong data-testid="pp-received">{{ money(data.received_total) }}</strong></li>
        <li><span>已請款</span><strong data-testid="pp-claimed">{{ money(data.claimed_total) }}</strong></li>
        <li><span>已付款</span><strong data-testid="pp-paid">{{ money(data.paid_total) }}</strong></li>
        <li><span>尚可請款</span><strong data-testid="pp-claimable">{{ money(data.claimable) }}</strong></li>
      </ul>
      <p class="muted" data-testid="pp-rule">累計請款不能超過累計驗入含稅金額（含 {{ money(data.tolerance) }} 尾差）；拒收的部分不能請款。</p>
      <div class="pp-actions">
        <button v-if="canManage" type="button" data-testid="pp-new-invoice" @click="openGaPage('ga-purchase-invoice-edit')">新增發票</button>
        <button type="button" data-testid="pp-open-invoices" @click="openGaPage('ga-purchase-invoices')">看發票清單</button>
      </div>
      <h3>進貨與憑證</h3>
      <ul class="pp-list" data-testid="pp-receipts">
        <li v-for="r in data.receipts" :key="r.receipt_id" data-testid="pp-receipt" :class="{ gone: r.voided }">
          <div class="pp-row">
            <strong>{{ r.receipt_no }}</strong><span>到貨日 {{ dateText(r.received_date) }}</span><span v-if="r.delivery_note_no">送貨單 {{ r.delivery_note_no }}</span>
            <span>驗入含稅 {{ money(r.total) }}</span><span v-if="r.claimed">已請款 {{ money(r.claimed) }}</span>
            <span v-if="r.voided" class="chip">已作廢</span>
            <span v-else class="chip" :data-status="r.voucher_status" data-testid="pp-voucher">{{ VOUCHER_LABELS[r.voucher_status] || r.voucher_status }}</span>
            <button v-if="canManage && !r.voided && r.voucher_status !== 'LINKED'" type="button" :data-testid="'pp-voucher-' + r.receipt_no" @click="openVoucher(r.receipt_id)">登錄憑證</button>
          </div>
          <p v-if="r.voucher_note" class="muted pp-note">說明：{{ r.voucher_note }}</p>
          <ul v-if="r.invoices.length" class="pp-inv">
            <li v-for="i in r.invoices" :key="i.id">
              <button type="button" class="link" data-testid="pp-invoice" @click="openGaPage('ga-purchase-invoice-edit', i.id)">{{ INVOICE_TYPE_LABELS[i.invoice_type] }} {{ i.invoice_no || "" }}　{{ money(i.amount_total) }}</button>
              <span v-if="i.missing_image" class="chip bad" data-testid="pp-missing">缺圖</span>
            </li>
          </ul>
        </li>
        <li v-if="!data.receipts.length" class="muted" data-testid="pp-empty">這張採購單還沒有進貨紀錄，到貨驗入後才能登錄憑證與請款。</li>
      </ul>
      <template v-if="data.requests.length">
        <h3>請款單</h3>
        <ul class="pp-list" data-testid="pp-requests">
          <li v-for="q in data.requests" :key="q.id" data-testid="pp-request"><strong>{{ q.pr_no }}</strong>　{{ PR_STATUS[q.status] || q.status }}　{{ money(q.claim_total) }}</li>
        </ul>
      </template>
    </template>

    <Modal v-if="target" title="登錄進貨憑證" :busy="vBusy" @cancel="target = null">
      <p>進貨單 {{ target.receipt_no }}。連結發票請到「新增發票」；這裡只登錄沒有發票的情況。</p>
      <fieldset class="pp-radio">
        <label><input v-model="vStatus" type="radio" value="NO_INVOICE" data-testid="v-no-invoice" /> 免開發票／僅收據（沒有發票）</label>
        <label><input v-model="vStatus" type="radio" value="NONE" data-testid="v-none" /> 改回「尚未登錄」</label>
      </fieldset>
      <label v-if="vStatus === 'NO_INVOICE'">原因（必填，例如僅有送貨單、對方免開發票）<input v-model="vNote" maxlength="200" data-testid="v-note" /></label>
      <p v-if="vError" class="field-error" role="alert" data-testid="v-error">{{ vError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="vBusy" @click="target = null">取消</button>
        <button type="button" class="primary" :disabled="vBusy" data-testid="v-save" @click="saveVoucher">{{ vBusy ? "處理中…" : "儲存" }}</button>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.pp { display: grid; gap: 10px; min-width: 0; }
.pp h3 { margin: 6px 0 0; font-size: 15px; }
.pp-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.pp-stats li { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: grid; gap: 2px; background: var(--surface); }
.pp-stats span { font-size: 12px; color: var(--muted); }
.pp-stats strong { font-size: 18px; }
.pp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pp-list > li { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.pp-list > li.gone { opacity: 0.7; }
.pp-row { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
.pp-note { margin: 4px 0 0; }
.pp-inv { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.chip { display: inline-block; border-radius: 6px; padding: 0 8px; font-size: 12px; font-weight: 600; background: var(--soft); border: 1px solid var(--line); }
.chip.bad { color: #b3261e; border-color: #d9a3a0; background: #fdecea; }
.pp-radio { border: 0; padding: 0; margin: 0 0 8px; display: grid; gap: 6px; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .pp button, .dialog-actions button { min-height: 44px; } }
</style>
