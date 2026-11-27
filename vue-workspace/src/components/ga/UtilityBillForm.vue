<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import {
  EXPENSE_TYPES, EXPENSE_TYPE_LABELS, PAID_FIELD_LABELS, errorCodeOf, errorDataOf, errorText, emptyBillForm, formFromBill, formProblem, identifierLabel, money, monthText, payloadFromForm, storeLabel,
  isPeriodRequired, type Anomaly, type Bill, type BillForm, type StoreOption,
} from "../../lib/ga-utility-bills";
import { addDays, gapNote, isLongPeriod, longPeriodMessage, periodDays, slashDate } from "../../../../lib/workspace/general-affairs/utility-period-rules";

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
// 計費期間：水費、電費必填；舊帳單（水電、沒有期間）編輯時要求補填；超過 70 天先確認；新增時依上一期自動帶入起日。
const legacyEdit = !isNew && isPeriodRequired(props.bill?.expense_type) && !props.bill?.service_period_start;
const periodRequired = computed(() => isPeriodRequired(form.expense_type));
const days = computed(() => periodDays(form.service_period_start, form.service_period_end));
const periodLong = ref(false);
const periodAcked = ref(false);
const prev = ref<{ end: string; month: string } | null>(null);
const startAuto = ref(false);
const gap = computed(() => (prev.value && form.service_period_start ? gapNote(form.service_period_start, prev.value.end) : null));
let prevTimer: ReturnType<typeof setTimeout> | null = null;
let prevSeq = 0;
async function loadPrev() {
  if (!isNew) return;
  const n = (prevSeq += 1);
  const q = new URLSearchParams({ expense_type: form.expense_type });
  if (form.store_id) q.set("store_id", form.store_id);
  else if (form.location_name.trim()) q.set("location_name", form.location_name.trim());
  for (const k of ["service_identifier", "equipment_serial", "account_number"] as const) if (form[k].trim()) q.set(k, form[k].trim());
  if (!(form.store_id || form.location_name.trim()) || !(form.service_identifier.trim() || form.equipment_serial.trim() || form.account_number.trim())) { prev.value = null; return; }
  try {
    const r = await api<{ data: { found: boolean; service_period_end?: string; billing_month?: string } }>("general-affairs/utility-bills/prev-period?" + q);
    if (n !== prevSeq) return;
    if (r.data.found && r.data.service_period_end) {
      prev.value = { end: String(r.data.service_period_end).slice(0, 10), month: String(r.data.billing_month || "").slice(0, 7) };
      // 起日還沒填、或還是上一次自動帶入的值才自動帶入（不覆蓋使用者自己填的）。
      if (!form.service_period_start || startAuto.value) { form.service_period_start = addDays(prev.value.end, 1); startAuto.value = true; }
    } else {
      prev.value = null;
      if (startAuto.value) { form.service_period_start = ""; startAuto.value = false; }
    }
  } catch {
    if (n === prevSeq) prev.value = null;
  }
}
if (isNew) {
  watch(() => [form.store_id, form.location_name, form.expense_type, form.service_identifier, form.equipment_serial, form.account_number], () => {
    if (prevTimer) clearTimeout(prevTimer);
    prevTimer = setTimeout(() => { void loadPrev(); }, 350);
  });
}
onBeforeUnmount(() => { if (prevTimer) clearTimeout(prevTimer); });
watch(() => [form.service_period_start, form.service_period_end], () => { periodAcked.value = false; periodLong.value = false; });
function onStartInput() { startAuto.value = false; }
// G46 繳費單位（公用事業分類且合作中的廠商）；帳單已在已送出或已付款的請款單內時，金額、繳費單位、月份、類型、據點、識別號碼鎖定（勾自動標記者繳費日期也鎖定）。
const payees = ref<Array<{ id: string; name: string }>>([]);
const payeeError = ref("");
const locked = computed(() => props.bill?.locked ?? []);
const isLocked = (k: string) => locked.value.includes(k);
const anyLocked = computed(() => locked.value.length > 0);
onMounted(async () => {
  try { payees.value = (await api<{ data: Array<{ id: string; name: string }> }>("general-affairs/utility-bills/payees")).data; } catch (e) { payeeError.value = errorText(e); }
});
const payeeOptions = computed(() => {
  const list = [...payees.value];
  const own = props.bill;
  if (own?.payee_vendor_id && !list.some((p) => p.id === own.payee_vendor_id)) list.unshift({ id: own.payee_vendor_id, name: own.payee_vendor_name || "（原繳費單位）" });
  return list;
});
function pickPayee() {
  const p = payees.value.find((x) => x.id === form.payee_vendor_id);
  if (p && !form.provider_name.trim()) form.provider_name = p.name;
}

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
  const p = formProblem(form, legacyEdit);
  if (p) { error.value = p; return; }
  if (!periodAcked.value && isLongPeriod(days.value)) { periodLong.value = true; return; }
  periodLong.value = false;
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
      <p v-if="anyLocked" class="notice" role="status" data-testid="uf-locked-note">這筆帳單已在請款單 {{ bill?.payment_request?.pr_no || "" }} 內（{{ bill?.payment_request?.status === "PAID" ? "已付款" : "已送出" }}），金額、繳費單位、帳單月份、費用類型、據點與識別號碼已鎖定<template v-if="isLocked('paid_at')">，繳費狀態由請款單管理</template>；備註與繳費期限仍可修改。要改鎖定的欄位請先把請款單退回或作廢。</p>
      <p v-if="legacyEdit" class="notice" role="status" data-testid="uf-period-legacy">這筆舊帳單沒有計費期間。水費、電費現在必須填計費起日與迄日，儲存前請一併補上。</p>
      <p v-if="wasPaid" class="notice" data-testid="uf-paid-note">這筆帳單已在 {{ bill?.paid_at?.slice(0, 10) }} 繳費；改金額、據點、類型、月份、供應商或識別號碼時會再請你確認一次。</p>

      <div class="uf-grid">
        <label>據點
          <select v-model="form.store_id" :disabled="isLocked('location')" data-testid="uf-store" @change="pickStore">
            <option value="">其他據點（自行輸入名稱）</option>
            <option v-for="s in storeOptions" :key="s.id" :value="s.id">{{ storeLabel(s) }}</option>
          </select>
          <small v-if="ownInactive" class="muted">這間門市已停用，編輯時保留原門市。</small>
        </label>
        <label>據點名稱<input v-model="form.location_name" maxlength="120" :readonly="!!form.store_id || isLocked('location')" data-testid="uf-location" /></label>
        <label>費用類型<select v-model="form.expense_type" :disabled="isLocked('expense_type')" data-testid="uf-type"><option v-for="t in EXPENSE_TYPES" :key="t" :value="t">{{ EXPENSE_TYPE_LABELS[t] }}</option></select></label>
        <label>帳單月份<input v-model="form.billing_month" type="month" :disabled="isLocked('billing_month')" data-testid="uf-month" /></label>
        <label>供應商<input v-model="form.provider_name" maxlength="120" data-testid="uf-provider" /></label>
        <label>繳費單位（請款對象，選填）
          <select v-model="form.payee_vendor_id" :disabled="isLocked('payee_vendor_id')" data-testid="uf-payee" @change="pickPayee">
            <option value="">未指定（請款前要補填）</option>
            <option v-for="p in payeeOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <small class="muted">只列「公用事業」分類且合作中的廠商。請款時帳單必須指定繳費單位。</small>
          <small v-if="payeeError" class="field-error" role="alert">{{ payeeError }}</small>
        </label>
        <label v-if="form.expense_type === 'INTERNET'">線路／數據機名稱<input v-model="form.service_label" maxlength="120" placeholder="例如：POS 主線、監視器網路" data-testid="uf-label" /></label>
        <label>{{ identifierLabel(form.expense_type) }}<input v-model="form.service_identifier" maxlength="200" :readonly="isLocked('identifier')" data-testid="uf-ident" /></label>
        <label>客戶／帳單帳號（選填）<input v-model="form.account_number" maxlength="200" :readonly="isLocked('identifier')" data-testid="uf-account" /></label>
        <label v-if="form.expense_type === 'INTERNET'">網路設備序號<input v-model="form.equipment_serial" maxlength="200" :readonly="isLocked('identifier')" data-testid="uf-serial" /><small class="muted">電路編號與設備序號至少填一項。</small></label>
        <label>金額<input v-model="form.amount" type="number" min="0" step="0.01" inputmode="decimal" :readonly="isLocked('amount')" data-testid="uf-amount" /></label>
        <label v-if="form.expense_type === 'ELECTRICITY'">用電度數（kWh）<input v-model="form.electricity_kwh" type="number" min="0" step="0.01" data-testid="uf-kwh" /></label>
        <label>計費起日{{ periodRequired ? "（必填）" : "（選填）" }}<input v-model="form.service_period_start" type="date" :required="periodRequired" data-testid="uf-period-start" @input="onStartInput" />
          <small v-if="prev && startAuto" class="muted" data-testid="uf-period-prev">依上一期（迄 {{ slashDate(prev.end) }}）帶入，可修改。</small>
          <small v-else-if="prev" class="muted" data-testid="uf-period-prev">上一期迄 {{ slashDate(prev.end) }}（帳單月份 {{ prev.month }}）。</small>
          <small v-if="gap && gap.kind !== 'ok'" class="warn" role="status" data-testid="uf-period-gap">{{ gap.message }}</small>
        </label>
        <label>計費迄日{{ periodRequired ? "（必填）" : "（選填）" }}<input v-model="form.service_period_end" type="date" :required="periodRequired" data-testid="uf-period-end" /><small v-if="days !== null" class="muted" data-testid="uf-period-days">共 {{ days }} 天</small></label>
        <label>繳費期限<input v-model="form.due_date" type="date" data-testid="uf-due" /></label>
        <label>繳費日期（已繳才填）<input v-model="form.paid_at" type="date" :disabled="isLocked('paid_at')" data-testid="uf-paid" /></label>
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

      <section v-if="periodLong" class="uf-panel" role="alertdialog" aria-label="計費期間過長提醒" data-testid="uf-period-long">
        <strong>計費期間超過 70 天</strong>
        <p data-testid="uf-period-long-message">{{ longPeriodMessage(days || 0) }}（{{ slashDate(form.service_period_start) }}～{{ slashDate(form.service_period_end) }}）</p>
        <div class="uf-row"><button type="button" data-testid="uf-period-long-back" :disabled="busy" @click="periodLong = false">返回修改</button><button type="button" class="primary" data-testid="uf-period-long-ok" :disabled="busy" @click="periodAcked = true; periodLong = false; save()">日期沒錯，仍要儲存</button></div>
      </section>

      <section v-if="paidConfirm" class="uf-panel" role="alertdialog" aria-label="已繳帳單修改確認" data-testid="uf-paid-confirm">
        <strong>這筆帳單已繳費，確認要修改嗎？</strong>
        <p>被修改的欄位與原本的值：</p>
        <ul class="uf-samples"><li v-for="k in paidConfirm.fields" :key="k" :data-testid="'uf-orig-' + k">{{ PAID_FIELD_LABELS[k] || k }}：原本是 {{ origText(k, paidConfirm.original) }}</li></ul>
        <div class="uf-row"><button type="button" data-testid="uf-paid-confirm-cancel" :disabled="busy" @click="paidConfirm = null">先不要</button><button type="button" class="primary" data-testid="uf-paid-confirm-ok" :disabled="busy" @click="paidConfirm = null; save(true, true)">確認修改</button></div>
      </section>

      <div class="dialog-actions">
        <button type="button" data-testid="uf-cancel" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" data-testid="uf-save" :disabled="busy || !!anomaly || !!paidConfirm || periodLong">{{ busy ? "儲存中…" : isNew ? "儲存" : "儲存變更" }}</button>
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
.warn { color: #b3261e; font-weight: 600; }
.uf-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
@media (max-width: 700px) {
  .uf-grid { grid-template-columns: minmax(0, 1fr); }
  .dialog-actions button, .uf-row button { min-height: 44px; }
}
</style>
