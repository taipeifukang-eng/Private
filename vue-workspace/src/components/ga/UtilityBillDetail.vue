<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import ResourceAttachmentPanel from "./ResourceAttachmentPanel.vue";
import { openGaPage } from "../../lib/ga";
import {
  BILL_STATUS_LABELS, EXPENSE_TYPE_LABELS, errorCodeOf, errorDataOf, errorText, identifierLabel, money, monthText, dateText, paidDateRange, siteOf, taipeiToday, timeText,
  type Bill,
} from "../../lib/ga-utility-bills";

// G23 帳單詳情：欄位、最後修改者、已刪除資訊（誰、何時、為何）、附件（掃描檔與照片）。
// 管理權限者可標記已繳（選日期，預設今天，不可未來、不早於帳單月份前 1 個月）、改回待繳（顯示原日期並確認）、刪除（必填原因；已繳帳單多一道確認並顯示原值）、編輯。
const props = defineProps<{ id: string; canManage: boolean }>();
const emit = defineEmits<{ close: []; edit: [Bill]; changed: [] }>();
const bill = ref<Bill | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const panel = ref<"" | "pay" | "unpay" | "delete">("");
const payDate = ref(taipeiToday());
const reason = ref("");
const confirmPaid = ref(false);
const live = computed(() => !!bill.value && !bill.value.deleted_at);
const manageable = computed(() => props.canManage && live.value);
const range = computed(() => (bill.value ? paidDateRange(bill.value.billing_month) : { min: "", max: "" }));
// G46：這筆帳單在已送出或已付款的請款單內時，繳費狀態（勾自動標記者）、刪除由請款單管理。
const req = computed(() => bill.value?.payment_request || null);
const locked = computed(() => bill.value?.locked ?? []);
const payLocked = computed(() => locked.value.includes("paid_at"));
const deleteLocked = computed(() => locked.value.includes("delete"));
const reqStatusText = computed(() => (req.value?.status === "PAID" ? "已付款" : req.value?.status === "SUBMITTED" ? "已送出" : req.value?.status === "DRAFT" ? "草稿" : ""));
const autoMarked = computed(() => !!bill.value?.paid_by_pr_id);
function openRequest() { if (req.value?.id) openGaPage("ga-payment-request-edit", req.value.id); }

async function load() {
  loading.value = true;
  error.value = "";
  try {
    bill.value = (await api<{ data: Bill }>(`general-affairs/utility-bills/${props.id}`)).data;
  } catch (e) {
    bill.value = null;
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function open(p: "pay" | "unpay" | "delete") {
  panel.value = p;
  error.value = "";
  notice.value = "";
  payDate.value = taipeiToday() > range.value.max ? range.value.max : taipeiToday();
  reason.value = "";
  confirmPaid.value = false;
}
async function run(path: string, payload: Record<string, unknown>, done: string) {
  if (!bill.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api(`general-affairs/utility-bills/${bill.value.id}/${path}`, { method: "POST", body: JSON.stringify({ ...payload, expected_updated_at: bill.value.updated_at }) });
    notice.value = done;
    panel.value = "";
    emit("changed"); // 先通知清單重新整理：使用者若在重新載入完成前關閉視窗，清單仍會更新
    await load();
  } catch (e) {
    error.value = errorText(e);
    // 版本過期或已被別人處理：重新載入最新內容讓使用者看到現況。
    if (["STALE", "ALREADY_PAID", "DELETED"].includes(errorCodeOf(e))) { panel.value = ""; emit("changed"); await load(); }
    // 已繳帳單刪除需要確認：伺服端回 409 時打開確認勾選。
    if (errorCodeOf(e) === "PAID_CHANGE_CONFIRM_REQUIRED" && Object.keys(errorDataOf(e).original || {}).length) confirmPaid.value = false;
  } finally {
    busy.value = false;
  }
}
const pay = () => { if (!payDate.value) { error.value = "請選擇繳費日期"; return; } void run("pay", { paid_at: payDate.value }, `已標記為已繳（${payDate.value}）。`); };
const unpay = () => run("unpay", { confirm: true }, "已改回待繳，繳費日期已清除。");
function del() {
  if (!reason.value.trim()) { error.value = "請填寫刪除原因"; return; }
  if (bill.value?.paid_at && !confirmPaid.value) { error.value = "這筆帳單已繳費，請勾選確認後再刪除"; return; }
  void run("delete", { reason: reason.value.trim(), confirm_paid_change: confirmPaid.value }, "已刪除這筆帳單（可在「顯示已刪除」檢視）。");
}
</script>

<template>
  <Modal :title="bill ? `${siteOf(bill)}｜${EXPENSE_TYPE_LABELS[bill.expense_type]}` : '帳單詳情'" wide :busy="busy" @cancel="emit('close')">
    <div class="bd" data-testid="bill-detail">
      <p v-if="loading" role="status">載入中…</p>
      <p v-if="error" class="notice error" role="alert" data-testid="bd-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
      <p v-if="notice" class="notice success" role="status" data-testid="bd-notice">{{ notice }}</p>
      <template v-if="bill">
        <p class="bd-status"><span class="st" :data-status="bill.status" data-testid="bd-status">{{ BILL_STATUS_LABELS[bill.status] }}</span>
          <strong data-testid="bd-amount">{{ money(bill.amount) }}</strong></p>
        <p v-if="bill.deleted_at" class="notice" data-testid="bd-deleted-info">已刪除：{{ bill.deleted_by_name || "（未知）" }} 於 {{ timeText(bill.deleted_at) }} 刪除。原因：{{ bill.deletion_reason || "（未填）" }}</p>
        <p v-if="autoMarked" class="notice" role="status" data-testid="bd-auto-marked">已繳（請款單 {{ bill.paid_by_pr_no || "" }} 自動標記）。請款單被退回或作廢時，這筆帳單會自動改回待繳。</p>
        <dl class="bd-grid">
          <div><dt>帳單月份</dt><dd>{{ monthText(bill.billing_month) }}</dd></div>
          <div><dt>供應商</dt><dd>{{ bill.provider_name || "—" }}</dd></div>
          <div><dt>繳費單位</dt><dd data-testid="bd-payee"><template v-if="bill.payee_vendor_name">{{ bill.payee_vendor_name }}</template><span v-else class="warn">未指定（請款前要補填）</span></dd></div>
          <div><dt>請款單</dt><dd data-testid="bd-request"><template v-if="req"><button v-if="req.pr_no" type="button" class="link" data-testid="bd-open-request" @click="openRequest">{{ req.pr_no }}</button><template v-else>已在請款單內</template><template v-if="reqStatusText">（{{ reqStatusText }}）</template></template><template v-else>—</template></dd></div>
          <div><dt>{{ identifierLabel(bill.expense_type) }}</dt><dd>{{ bill.service_identifier || "—" }}</dd></div>
          <div v-if="bill.account_number"><dt>客戶帳號</dt><dd>{{ bill.account_number }}</dd></div>
          <div v-if="bill.equipment_serial"><dt>設備序號</dt><dd>{{ bill.equipment_serial }}</dd></div>
          <div v-if="bill.electricity_kwh !== null"><dt>用電度數</dt><dd>{{ Number(bill.electricity_kwh).toLocaleString("zh-TW") }} 度</dd></div>
          <div><dt>繳費期限</dt><dd>{{ dateText(bill.due_date) || "未填" }}</dd></div>
          <div><dt>繳費日期</dt><dd data-testid="bd-paid-at">{{ dateText(bill.paid_at) || "—" }}</dd></div>
          <div><dt>銷帳編號</dt><dd>{{ bill.reference_no || "—" }}</dd></div>
          <div class="wide"><dt>備註</dt><dd>{{ bill.notes || "—" }}</dd></div>
          <div><dt>建立</dt><dd>{{ bill.created_by_name || "—" }}　{{ timeText(bill.created_at) }}</dd></div>
          <div><dt>最後修改</dt><dd data-testid="bd-updated-by">{{ bill.updated_by_name || "—" }}　{{ timeText(bill.updated_at) }}</dd></div>
        </dl>

        <p v-if="locked.length" class="notice" role="status" data-testid="bd-locked-note">這筆帳單已在請款單內（{{ reqStatusText }}），金額、繳費單位、月份、類型、據點、識別號碼與刪除已鎖定<template v-if="payLocked">，繳費狀態由請款單管理</template>。要修改請先把請款單退回或作廢。</p>
        <div v-if="manageable && !panel" class="bd-actions">
          <button type="button" data-testid="bd-edit" @click="emit('edit', bill)">編輯</button>
          <button v-if="!bill.paid_at" type="button" class="primary" data-testid="bd-pay" :disabled="payLocked" @click="open('pay')">標記已繳</button>
          <button v-else type="button" data-testid="bd-unpay" :disabled="payLocked" @click="open('unpay')">改回待繳</button>
          <button type="button" class="danger" data-testid="bd-delete" :disabled="deleteLocked" @click="open('delete')">刪除</button>
        </div>

        <section v-if="panel === 'pay'" class="bd-panel" data-testid="bd-pay-panel">
          <label>繳費日期<input v-model="payDate" type="date" :min="range.min" :max="range.max" data-testid="bd-pay-date" /></label>
          <small class="muted">預設今天；不能選未來，最早可選 {{ range.min }}（帳單月份前 1 個月）。憑證可在下方附件上傳（非必填）。</small>
          <div class="bd-row"><button type="button" :disabled="busy" @click="panel = ''">取消</button><button type="button" class="primary" :disabled="busy" data-testid="bd-pay-ok" @click="pay">確認已繳</button></div>
        </section>
        <section v-if="panel === 'unpay'" class="bd-panel" data-testid="bd-unpay-panel">
          <p>這筆帳單已在 <strong data-testid="bd-unpay-date">{{ dateText(bill.paid_at) }}</strong> 繳費。改回待繳會清除這個繳費日期，確定嗎？</p>
          <div class="bd-row"><button type="button" :disabled="busy" @click="panel = ''">取消</button><button type="button" class="primary" :disabled="busy" data-testid="bd-unpay-ok" @click="unpay">確定改回待繳</button></div>
        </section>
        <section v-if="panel === 'delete'" class="bd-panel" data-testid="bd-delete-panel">
          <p v-if="bill.paid_at" data-testid="bd-delete-orig">這筆帳單已繳費。原值：{{ money(bill.amount) }}、{{ monthText(bill.billing_month) }}、{{ bill.location_name }}、繳費日 {{ dateText(bill.paid_at) }}。</p>
          <label>刪除原因（必填）<textarea v-model="reason" rows="2" maxlength="500" data-testid="bd-delete-reason" /></label>
          <label v-if="bill.paid_at" class="check"><input v-model="confirmPaid" type="checkbox" data-testid="bd-delete-confirm-paid" /> 我確認要刪除這筆已繳費的帳單</label>
          <div class="bd-row"><button type="button" :disabled="busy" @click="panel = ''">取消</button><button type="button" class="danger" :disabled="busy" data-testid="bd-delete-ok" @click="del">確定刪除</button></div>
        </section>

        <ResourceAttachmentPanel v-if="live" resource-type="UTILITY_BILL" :resource-id="bill.id" purpose="BILL_DOCUMENT" title="帳單掃描檔與照片" :can-upload="canManage" :can-delete="canManage" :phone-upload="canManage" />
        <p v-else class="muted">已刪除的帳單不顯示附件（檔案仍保留）。</p>
      </template>
      <div class="dialog-actions"><button type="button" data-testid="bd-close" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.bd { display: grid; gap: 12px; min-width: 0; }
.bd-status { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 0; font-size: 18px; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.st[data-status="overdue"] { color: #b3261e; border-color: #d9a3a0; }
.st[data-status="paid"] { color: #1b6e3a; }
.bd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 0; }
.bd-grid div { min-width: 0; }
.bd-grid .wide { grid-column: 1 / -1; }
.bd-grid dt { font-size: 12px; color: var(--muted); }
.bd-grid dd { margin: 0; overflow-wrap: anywhere; }
.bd-actions, .bd-row { display: flex; flex-wrap: wrap; gap: 8px; }
.warn { color: #b3261e; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
.bd-row { justify-content: flex-end; }
.bd-panel { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; display: grid; gap: 8px; background: var(--soft); }
.bd-panel p { margin: 0; }
.bd-panel label { display: grid; gap: 4px; }
.bd-panel .check { display: flex; align-items: center; gap: 8px; }
.bd-panel .check input { width: auto; min-height: 0; }
@media (max-width: 700px) {
  .bd-grid { grid-template-columns: minmax(0, 1fr); }
  .bd-actions button, .bd-row button, .dialog-actions button { min-height: 44px; }
}
</style>
