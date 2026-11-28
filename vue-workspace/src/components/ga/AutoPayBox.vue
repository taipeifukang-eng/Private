<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import {
  CANCEL_AUTO_PAY_LABEL, CANCEL_AUTO_PAY_NOTE, autoPayHint, autoPaidLabel, canCancelAutoPay, errorCodeOf, isAutoPaid, newKey, payErrorText, resolveAutoPayDate,
  type PaymentRequest,
} from "../../lib/ga-payments";

// 付款日到期自動標記已付款：已送出的單顯示「到期後系統會自動標記」的提示；系統自動標記的已付款單顯示「系統自動標記（付款日 YYYY/MM/DD）」與「取消自動付款」按鈕。
// 取消需請款管理權限、原因必填；只限系統自動標記的單（人工標記的不顯示按鈕）。取消後這張單改回已送出，且之後系統不會再自動標記。
const props = defineProps<{ pr: PaymentRequest; canManage: boolean; testPrefix: string }>();
const emit = defineEmits<{ (e: "updated", pr: PaymentRequest): void; (e: "stale"): void }>();
const t = (s: string) => `${props.testPrefix}-${s}`;
const auto = computed(() => isAutoPaid(props.pr));
const canCancel = computed(() => canCancelAutoPay(props.pr, props.canManage));
const hint = computed(() => {
  const r = props.pr;
  return autoPayHint({
    status: r.status, source: r.source, payee_type: r.payee_type, expected_pay_date: r.expected_pay_date, auto_pay_off: r.auto_pay_off,
    bill_due_dates: (r.bill_lines || []).filter((l) => l.active).map((l) => l.due_date),
  });
});
const hasDate = computed(() => !!resolveAutoPayDate({ source: props.pr.source, expected_pay_date: props.pr.expected_pay_date, bill_due_dates: (props.pr.bill_lines || []).filter((l) => l.active).map((l) => l.due_date) }));
const asking = ref(false);
const reason = ref("");
const error = ref("");
const busy = ref(false);
const done = ref("");
const key = ref(newKey());
function ask() { asking.value = true; reason.value = ""; error.value = ""; key.value = newKey(); }
async function confirm() {
  if (busy.value) return;
  if (!reason.value.trim()) { error.value = "請填寫取消自動付款的原因。"; return; }
  busy.value = true; error.value = "";
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${props.pr.id}/actions`, {
      method: "POST", body: JSON.stringify({ action: "cancel_auto_pay", reason: reason.value.trim(), expected_updated_at: props.pr.updated_at, idempotency_key: key.value }),
    });
    asking.value = false;
    done.value = "已取消自動付款，請款單改回「已送出」，系統不會再自動標記。";
    emit("updated", res.data);
  } catch (e) {
    error.value = payErrorText(e);
    if (errorCodeOf(e) === "STALE") emit("stale");
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section v-if="auto || (pr.status === 'SUBMITTED' && (hint || done))" class="ap-box" :data-testid="t('auto-box')">
    <h2>自動付款</h2>
    <template v-if="auto">
      <p class="ap-flag" :data-testid="t('auto-paid')"><strong>{{ autoPaidLabel(pr) }}</strong></p>
      <p class="muted" :data-testid="t('auto-paid-note')">付款日到期，系統在當天凌晨自動把這張請款單標記為已付款（沒有付款人）。如果實際還沒付款，可以取消。</p>
      <div v-if="canCancel"><button type="button" class="danger" :disabled="busy" :data-testid="t('cancel-auto')" @click="ask">{{ CANCEL_AUTO_PAY_LABEL }}</button></div>
    </template>
    <template v-else>
      <p v-if="done" class="notice" role="status" :data-testid="t('auto-cancelled')">{{ done }}</p>
      <p v-if="hint" :class="hasDate && !pr.auto_pay_off ? 'muted' : 'notice'" :data-testid="t('auto-hint')">{{ hint }}</p>
    </template>
    <Modal v-if="asking" :title="CANCEL_AUTO_PAY_LABEL" :busy="busy" @cancel="asking = false">
      <p>{{ CANCEL_AUTO_PAY_NOTE }}</p>
      <label>取消原因（必填）<input v-model="reason" maxlength="200" :data-testid="t('cancel-reason')" /></label>
      <p v-if="error" class="field-error" role="alert" :data-testid="t('cancel-error')">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" @click="asking = false">不取消</button>
        <button type="button" class="primary" :disabled="busy" :data-testid="t('cancel-confirm')" @click="confirm">{{ busy ? "處理中…" : "確認取消自動付款" }}</button>
      </div>
    </Modal>
  </section>
</template>
<style scoped>
.ap-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; margin-bottom: 14px; }
.ap-box h2 { margin: 0; font-size: 16px; }
.ap-box p { margin: 0; overflow-wrap: anywhere; }
.ap-box label { display: grid; gap: 4px; min-width: 0; }
.ap-flag { color: #20614a; }
@media (prefers-color-scheme: dark) { .ap-flag { color: #7fd1ae; } }
</style>
