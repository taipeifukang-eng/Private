<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { PO_STATUS_LABEL, money, num, type RequestRow } from "../../lib/ga-requests";

// 採購評估（D1）：選「進入採購」儲存時，系統在同一個交易內自動產生一張草稿採購單並連回需求單；確認供應商與單價後才下訂。
// 改成別的決策時，舊的採購單會一併標為已取消（已有到貨者擋下）；舊報價保留歷史。
const props = defineProps<{ request: RequestRow }>();
const emit = defineEmits<{ close: []; done: [] }>();
const DECISIONS = [
  { id: "PURCHASE", label: "進入採購（自動產生草稿採購單）" },
  { id: "STOCK_ISSUE", label: "改由庫存出庫" },
  { id: "TRANSFER", label: "改由調撥" },
  { id: "SUBSTITUTE", label: "改用替代品" },
  { id: "REJECT", label: "駁回" },
];
const vendors = ref<Array<{ id: string; name: string }>>([]);
const locations = ref<Array<{ id: string; code: string; name: string }>>([]);
const orders = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const result = ref<any | null>(null);
const f = reactive({
  decision: "PURCHASE", vendorId: "", vendorName: "", approvedQuantity: props.request.desired_quantity ? String(props.request.desired_quantity) : "", approvedUnit: props.request.desired_unit || "",
  estimatedAmount: "", quotedAmount: "", negotiatedAmount: "", finalAmount: "", expectedDeliveryDate: "", deliveryMethod: "", receivingLocationId: "", substituteDescription: "",
  decisionNote: "", publicNote: "", quoteLeadTimeDays: "", quoteNotes: "",
});
onMounted(async () => {
  try {
    const res = await api<any>(`general-affairs/requests/${props.request.id}/purchase-review`);
    vendors.value = res.data.vendors || [];
    locations.value = res.data.inventoryLocations || [];
    orders.value = res.data.purchase_orders || [];
    const r = res.data.review;
    if (r) {
      Object.assign(f, {
        decision: r.decision, vendorId: r.vendor_id || "", vendorName: r.vendor_name || "", approvedQuantity: r.approved_quantity ? String(r.approved_quantity) : f.approvedQuantity, approvedUnit: r.approved_unit || f.approvedUnit,
        estimatedAmount: r.estimated_amount ?? "", quotedAmount: r.quoted_amount ?? "", negotiatedAmount: r.negotiated_amount ?? "", finalAmount: r.final_amount ?? "",
        expectedDeliveryDate: r.expected_delivery_date || "", deliveryMethod: r.delivery_method || "", receivingLocationId: r.receiving_location_id || "",
        substituteDescription: r.substitute_description || "", decisionNote: r.decision_note || "", publicNote: r.public_note || "",
      });
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
const isPurchase = computed(() => f.decision === "PURCHASE");
async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!f.decisionNote.trim()) { error.value = "請填寫評估說明"; return; }
  if (isPurchase.value && !(Number(f.approvedQuantity) > 0)) { error.value = "進入採購時請填寫核准數量"; return; }
  if (f.decision === "SUBSTITUTE" && !f.substituteDescription.trim()) { error.value = "改用替代品時請填寫替代品說明"; return; }
  if (f.decision === "REJECT" && !f.publicNote.trim()) { error.value = "駁回時請填寫門市可見說明"; return; }
  busy.value = true;
  try {
    const res = await api<any>(`general-affairs/requests/${props.request.id}/purchase-review`, {
      method: "POST",
      body: JSON.stringify({ ...f, vendorId: f.vendorId || undefined, expectedDeliveryDate: f.expectedDeliveryDate || undefined, receivingLocationId: f.receivingLocationId || undefined, expected_updated_at: props.request.updated_at }),
    });
    result.value = res.data;
    if (!res.data.purchase_order) emit("done");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="採購評估" :busy="busy" @cancel="emit('close')">
    <div v-if="result?.purchase_order" class="pr" data-testid="review-result">
      <p class="notice success" role="status">評估已儲存，已產生草稿採購單 <strong data-testid="review-po-no">{{ result.purchase_order.po_no }}</strong>（含稅 {{ money(result.purchase_order.total_amount) }}）。請到採購單確認供應商與單價後下訂。</p>
      <div class="dialog-actions"><button type="button" class="primary" data-testid="review-done" @click="emit('done')">完成</button></div>
    </div>
    <form v-else class="pr" novalidate data-testid="review-form" @submit.prevent="submit">
      <p v-if="loading" role="status">載入中…</p>
      <p class="muted">需求單 {{ request.request_no }}：{{ request.title }}（{{ num(request.desired_quantity) }} {{ request.desired_unit }}）。</p>
      <ul v-if="orders.length" class="pr-orders"><li v-for="o in orders" :key="o.id">已連結採購單 {{ o.po_no }}（{{ PO_STATUS_LABEL[o.status] || o.status }}，已驗入 {{ num(o.received_qty) }} / {{ num(o.ordered_qty) }}）</li></ul>
      <label>評估結果<select v-model="f.decision" data-testid="rv-decision"><option v-for="d in DECISIONS" :key="d.id" :value="d.id">{{ d.label }}</option></select></label>
      <template v-if="isPurchase">
        <div class="pr-row"><label>核准數量<input v-model="f.approvedQuantity" inputmode="decimal" data-testid="rv-qty" /></label><label>單位<input v-model="f.approvedUnit" maxlength="20" /></label></div>
        <label>供應商（已建好的合作中廠商）<select v-model="f.vendorId" data-testid="rv-vendor"><option value="">稍後在採購單選擇</option><option v-for="v in vendors" :key="v.id" :value="v.id">{{ v.name }}</option></select></label>
        <div class="pr-row"><label>預估金額<input v-model="f.estimatedAmount" inputmode="decimal" /></label><label>報價金額<input v-model="f.quotedAmount" inputmode="decimal" /></label></div>
        <div class="pr-row"><label>議價後金額<input v-model="f.negotiatedAmount" inputmode="decimal" /></label><label>預計到貨日<input v-model="f.expectedDeliveryDate" type="date" /></label></div>
        <label v-if="locations.length">入庫位置（選填）<select v-model="f.receivingLocationId"><option value="">採購單預設位置</option><option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option></select></label>
        <p class="muted">儲存後會自動產生草稿採購單（單價由金額除以數量推算，請在採購單確認）。要下訂請到採購單。</p>
      </template>
      <label v-if="f.decision === 'SUBSTITUTE'">替代品說明（必填）<textarea v-model="f.substituteDescription" rows="2" maxlength="500" /></label>
      <label>評估說明（必填，內部）<textarea v-model="f.decisionNote" rows="3" maxlength="1000" data-testid="rv-note" /></label>
      <label>門市可見說明{{ f.decision === "REJECT" ? "（駁回必填）" : "（選填）" }}<textarea v-model="f.publicNote" rows="2" maxlength="500" data-testid="rv-public" /></label>
      <p v-if="error" class="field-error" role="alert" data-testid="rv-error">{{ error }}</p>
      <div class="dialog-actions"><button type="button" :disabled="busy" @click="emit('close')">取消</button><button type="submit" class="primary" :disabled="busy || loading" data-testid="rv-submit">{{ busy ? "儲存中…" : "儲存評估" }}</button></div>
    </form>
  </Modal>
</template>

<style scoped>
.pr { display: grid; gap: 10px; min-width: 0; max-width: 640px; }
.pr label { display: grid; gap: 4px; }
.pr-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pr-orders { margin: 0; padding-left: 18px; font-size: 14px; }
</style>
