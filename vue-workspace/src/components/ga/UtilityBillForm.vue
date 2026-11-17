<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import {
  EXPENSE_TYPES, EXPENSE_TYPE_LABELS, PAID_FIELD_LABELS, errorCodeOf, errorDataOf, errorText, emptyBillForm, formFromBill, formProblem, identifierLabel, money, monthText, payloadFromForm, storeLabel,
  type Anomaly, type Bill, type BillForm, type StoreOption,
} from "../../lib/ga-utility-bills";

// G23 水電帳單新增與編輯。
// 送出前先做金額異常檢查（V7：與近三筆同據點、同類型、同識別號碼的平均比，顯示基準與明細，仍可儲存）；已繳帳單改金額或識別欄位要二次確認並顯示原值（V6）；重複帳單用白話指出既有那一筆。
// 新增後由頁面接著開詳情，附件（掃描檔、照片）在詳情上傳；上傳失敗也留在詳情可補傳。
const props = defineProps<{ bill: Bill | null; stores: StoreOption[] }>();
const emit = defineEmits<{ close: []; saved: [Bill, Anomaly | null]; "open-existing": [string] }>();
const isNew = !props.bill;
const form = reactive<BillForm>(props.bill ? formFromBill(props.bill) : emptyBillForm());
const initialKey = JSON.stringify(keyOf(form));
const busy = ref(false);
const error = ref("");
const existing = ref<{ id: string; amount: number; billing_month: string; due_date: string | null } | null>(null);
const anomaly = ref<Anomaly | null>(null);
const paidConfirm = ref<{ original: Record<string, any>; fields: string[] } | null>(null);
const wasPaid = !!props.bill?.paid_at;

function keyOf(f: BillForm) {
  return [f.amount, f.store_id, f.location_name, f.expense_type, f.billing_month, f.service_identifier, f.equipment_serial, f.account_number];
}
// 編輯時，原本的門市即使已停用也要留在選單裡（保留原門市）。
const storeOptions = computed(() => {
  const list = [...props.stores];
  const own = props.bill?.store;
  if (own && !list.some((s) => s.id === own.id)) list.unshift({ id: own.id, store_code: own.store_code, store_name: own.store_name, short_name: own.short_name });
  return list;
});
const ownInactive = computed(() => !!props.bill?.store && props.bill.store.is_active === false);
function pickStore() {
  const s = storeOptions.value.find((x) => x.id === form.store_id);
  if (s) form.location_name = storeLabel(s);
  else if (!form.store_id && props.bill?.store_id) form.location_name = "";
}
const origText = (k: string, o: Record<string, any>) => {
  if (k === "amount") return money(o.amount);
  if (k === "location") return o.location_name;
  if (k === "expense_type") return EXPENSE_TYPE_LABELS[o.expense_type as keyof typeof EXPENSE_TYPE_LABELS] || o.expense_type;
  if (k === "billing_month") return monthText(o.billing_month);
  if (k === "provider_name") return o.provider_name || "（空白）";
  if (k === "identifier") return [o.service_identifier, o.equipment_serial, o.account_number].filter(Boolean).join(" / ") || "（空白）";
  return "";
};

async function save(ack = false, confirm = false) {
  if (busy.value) return;
  error.value = "";
  existing.value = null;
  const p = formProblem(form);
  if (p) { error.value = p; return; }
  busy.value = true;
  try {
    const payload = payloadFromForm(form);
    if (!ack && (isNew || JSON.stringify(keyOf(form)) !== initialKey)) {
      const chk = await api<{ data: Anomaly }>("general-affairs/utility-bills/anomaly-check", { method: "POST", body: JSON.stringify({ ...payload, exclude_id: props.bill?.id }) });
      if (chk.data.warn) { anomaly.value = chk.data; return; }
    }
    anomaly.value = null;
    const res = props.bill
      ? await api<{ data: Bill; anomaly: Anomaly | null }>(`general-affairs/utility-bills/${props.bill.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expected_updated_at: props.bill.updated_at, confirm_paid_change: confirm }) })
      : await api<{ data: Bill; anomaly: Anomaly | null }>("general-affairs/utility-bills", { method: "POST", body: JSON.stringify(payload) });
    emit("saved", res.data, res.anomaly?.warn ? res.anomaly : null);
  } catch (e) {
    const code = errorCodeOf(e);
    const d = errorDataOf(e);
    if (code === "PAID_CHANGE_CONFIRM_REQUIRED") { paidConfirm.value = { original: d.original || {}, fields: d.changed_fields || [] }; return; }
    error.value = errorText(e);
    if (code === "DUPLICATE_BILL" && d.existing?.id) existing.value = d.existing;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="bill ? '編輯費用' : '新增費用'" wide :busy="busy" @cancel="emit('close')">
    <form class="uf" novalidate data-testid="utility-form" @submit.prevent="save()">
      <p v-if="error" class="notice error" role="alert" data-testid="uf-error">{{ error }}</p>
      <p v-if="existing" class="notice" data-testid="uf-existing">已有的那一筆：{{ monthText(existing.billing_month) }}、{{ money(existing.amount) }}。<button type="button" data-testid="uf-open-existing" @click="emit('open-existing', existing.id)">查看並編輯那一筆</button></p>
      <p v-if="wasPaid" class="notice" data-testid="uf-paid-note">這筆帳單已在 {{ bill?.paid_at?.slice(0, 10) }} 繳費；改金額、據點、類型、月份、供應商或識別號碼時會再請你確認一次。</p>

      <div class="uf-grid">
        <label>據點
          <select v-model="form.store_id" data-testid="uf-store" @change="pickStore">
            <option value="">其他據點（自行輸入名稱）</option>
            <option v-for="s in storeOptions" :key="s.id" :value="s.id">{{ storeLabel(s) }}</option>
          </select>
          <small v-if="ownInactive" class="muted">這間門市已停用，編輯時保留原門市。</small>
        </label>
        <label>據點名稱<input v-model="form.location_name" maxlength="120" :readonly="!!form.store_id" data-testid="uf-location" /></label>
        <label>費用類型<select v-model="form.expense_type" data-testid="uf-type"><option v-for="t in EXPENSE_TYPES" :key="t" :value="t">{{ EXPENSE_TYPE_LABELS[t] }}</option></select></label>
        <label>帳單月份<input v-model="form.billing_month" type="month" data-testid="uf-month" /></label>
        <label>供應商<input v-model="form.provider_name" maxlength="120" data-testid="uf-provider" /></label>
        <label v-if="form.expense_type === 'INTERNET'">線路／數據機名稱<input v-model="form.service_label" maxlength="120" placeholder="例如：POS 主線、監視器網路" data-testid="uf-label" /></label>
        <label>{{ identifierLabel(form.expense_type) }}<input v-model="form.service_identifier" maxlength="200" data-testid="uf-ident" /></label>
        <label>客戶／帳單帳號（選填）<input v-model="form.account_number" maxlength="200" data-testid="uf-account" /></label>
        <label v-if="form.expense_type === 'INTERNET'">網路設備序號<input v-model="form.equipment_serial" maxlength="200" data-testid="uf-serial" /><small class="muted">電路編號與設備序號至少填一項。</small></label>
        <label>金額<input v-model="form.amount" type="number" min="0" step="0.01" inputmode="decimal" data-testid="uf-amount" /></label>
        <label v-if="form.expense_type === 'ELECTRICITY'">用電度數（kWh）<input v-model="form.electricity_kwh" type="number" min="0" step="0.01" data-testid="uf-kwh" /></label>
        <label>繳費期限<input v-model="form.due_date" type="date" data-testid="uf-due" /></label>
        <label>繳費日期（已繳才填）<input v-model="form.paid_at" type="date" data-testid="uf-paid" /></label>
        <label>本期帳單／銷帳編號（選填）<input v-model="form.reference_no" maxlength="200" data-testid="uf-ref" /></label>
        <label class="wide">備註<textarea v-model="form.notes" rows="2" maxlength="1000" data-testid="uf-notes" /></label>
      </div>
      <p v-if="isNew" class="muted">儲存後會開啟這筆帳單，可以直接上傳掃描檔或照片。</p>

      <section v-if="anomaly" class="uf-panel" role="alert" data-testid="uf-anomaly">
        <strong>金額異常提醒</strong>
        <p data-testid="uf-anomaly-message">{{ anomaly.message }}</p>
        <p v-if="anomaly.baseline !== null" data-testid="uf-anomaly-baseline">基準金額（近 {{ anomaly.sample_count }} 筆平均）：{{ money(anomaly.baseline) }}<template v-if="anomaly.partial">（僅 {{ anomaly.sample_count }} 筆參考）</template></p>
        <ul v-if="anomaly.samples.length" class="uf-samples" data-testid="uf-anomaly-samples"><li v-for="(s, i) in anomaly.samples" :key="i">{{ monthText(s.billing_month) }}　{{ money(s.amount) }}</li></ul>
        <div class="uf-row"><button type="button" data-testid="uf-back" :disabled="busy" @click="anomaly = null">返回修改</button><button type="button" class="primary" data-testid="uf-save-anyway" :disabled="busy" @click="save(true)">金額沒錯，仍要儲存</button></div>
      </section>

      <section v-if="paidConfirm" class="uf-panel" role="alertdialog" aria-label="已繳帳單修改確認" data-testid="uf-paid-confirm">
        <strong>這筆帳單已繳費，確認要修改嗎？</strong>
        <p>被修改的欄位與原本的值：</p>
        <ul class="uf-samples"><li v-for="k in paidConfirm.fields" :key="k" :data-testid="'uf-orig-' + k">{{ PAID_FIELD_LABELS[k] || k }}：原本是 {{ origText(k, paidConfirm.original) }}</li></ul>
        <div class="uf-row"><button type="button" data-testid="uf-paid-confirm-cancel" :disabled="busy" @click="paidConfirm = null">先不要</button><button type="button" class="primary" data-testid="uf-paid-confirm-ok" :disabled="busy" @click="paidConfirm = null; save(true, true)">確認修改</button></div>
      </section>

      <div class="dialog-actions">
        <button type="button" data-testid="uf-cancel" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" data-testid="uf-save" :disabled="busy || !!anomaly || !!paidConfirm">{{ busy ? "儲存中…" : isNew ? "儲存" : "儲存變更" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.uf { display: grid; gap: 12px; min-width: 0; }
.uf-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.uf-grid label { display: grid; gap: 4px; min-width: 0; }
.uf-grid .wide { grid-column: 1 / -1; }
.uf-panel { border: 1px solid #d9a3a0; border-radius: 8px; background: var(--soft); padding: 10px 14px; display: grid; gap: 6px; }
.uf-panel p { margin: 0; }
.uf-samples { margin: 0; padding-left: 18px; }
.uf-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
@media (max-width: 700px) {
  .uf-grid { grid-template-columns: minmax(0, 1fr); }
  .dialog-actions button, .uf-row button { min-height: 44px; }
}
</style>
