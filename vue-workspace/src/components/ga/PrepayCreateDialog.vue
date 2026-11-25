<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import PayeeBuyerFields from "./PayeeBuyerFields.vue";
import { errorText, money, newKey, payErrorText, type PaymentRequest } from "../../lib/ga-payments";
import { prepayAmount, prepaySplit } from "../../../../lib/workspace/general-affairs/payment-request-rules";
import type { BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";

// ga-improve-b1 G1：新增預付請款單。採購單核准並下訂後（已下訂或部分到貨）就能先付一筆訂金或貨款，不必等到貨。
// 到貨驗入時系統自動把預付款核銷在該進貨單上；之後一般請款只請差額。預付款先存成草稿，確認後在請款單頁送出。
const props = defineProps<{ poId: string; poNo: string; total: number; taxRate: number; buyerCompanyId?: string | null; expectedDeliveryDate?: string | null }>();
const emit = defineEmits<{ close: []; created: [pr: PaymentRequest] }>();
const amount = ref("");
const payDate = ref("");
const notes = ref("");
const payeeType = ref<"VENDOR" | "EMPLOYEE">("VENDOR");
const payeeProfileId = ref("");
const payeeName = ref("");
const buyerCompanyId = ref(props.buyerCompanyId || "");
const companies = ref<BuyerCompany[]>([]);
const busy = ref(false);
const error = ref("");
const key = ref(newKey());
onMounted(async () => {
  companies.value = (await api<{ data: BuyerCompany[] }>("general-affairs/buyer-companies").catch(() => ({ data: [] as BuyerCompany[] }))).data;
});
const split = computed(() => {
  try {
    return prepaySplit(prepayAmount(amount.value), props.taxRate);
  } catch {
    return null;
  }
});
async function submit() {
  if (busy.value) return;
  error.value = "";
  try {
    prepayAmount(amount.value);
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  if (payeeType.value === "EMPLOYEE" && !payeeProfileId.value) { error.value = "請選擇代墊的同仁。"; return; }
  busy.value = true;
  try {
    const body: Record<string, unknown> = { po_id: props.poId, amount: amount.value, expected_pay_date: payDate.value || null, notes: notes.value.trim() || null, buyer_company_id: buyerCompanyId.value || null, idempotency_key: key.value };
    if (payeeType.value === "EMPLOYEE") { body.payee_type = "EMPLOYEE"; body.payee_profile_id = payeeProfileId.value; }
    const res = await api<{ data: PaymentRequest }>("general-affairs/payment-requests/prepay", { method: "POST", body: JSON.stringify(body) });
    emit("created", res.data);
  } catch (e) {
    error.value = payErrorText(e) || errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="`新增預付請款（採購單 ${poNo}）`" :busy="busy" @cancel="emit('close')">
    <form class="pc" data-testid="prepay-form" @submit.prevent="submit">
      <p class="muted">採購單含稅總額 {{ money(total) }}。預付款加上這張採購單其他請款不能超過總額（含尾差）。貨到驗入時系統會自動核銷，之後一般請款只請「還沒付」的差額；超過預計到貨日仍未到貨，會在總務待辦與列表提醒追蹤。</p>
      <p v-if="!expectedDeliveryDate" class="notice" role="status" data-testid="prepay-no-eta">這張採購單還沒填「預計到貨日」：沒有預計到貨日，系統就不會在逾期未到貨時提醒你追預付款。建議先回採購單補填預計到貨日（可以先建立預付款，之後再補）。</p>
      <label>預付金額（含稅，整數元）<input v-model="amount" inputmode="numeric" maxlength="9" data-testid="prepay-amount" /></label>
      <p v-if="split" class="muted" data-testid="prepay-split">未稅 {{ money(split.untaxed) }}，稅額 {{ money(split.tax) }}，合計 {{ money(split.total) }}</p>
      <label>預計付款日（選填）<input v-model="payDate" type="date" data-testid="prepay-date" /></label>
      <label>備註（選填）<input v-model="notes" maxlength="500" data-testid="prepay-notes" /></label>
      <PayeeBuyerFields v-model:payee-type="payeeType" v-model:payee-profile-id="payeeProfileId" v-model:payee-name="payeeName" v-model:buyer-company-id="buyerCompanyId" :companies="companies" editing prefix="prepay" />
      <p v-if="error" class="field-error pre" role="alert" data-testid="prepay-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="prepay-cancel" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy" data-testid="prepay-submit">{{ busy ? "建立中…" : "建立預付請款單（草稿）" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.pc { display: grid; gap: 10px; min-width: 0; }
.pc label { display: grid; gap: 4px; min-width: 0; }
.pc p { margin: 0; overflow-wrap: anywhere; }
.pre { white-space: pre-wrap; }
@media (max-width: 700px) { .dialog-actions button { min-height: 44px; } }
</style>
