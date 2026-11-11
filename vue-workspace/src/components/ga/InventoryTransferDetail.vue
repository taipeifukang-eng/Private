<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import TransferStatusBadge from "./TransferStatusBadge.vue";
import { fmtTime, newKey } from "../../lib/ga-inventory-stock";
import { itemState, itemText, placeText, type TransferView } from "../../lib/ga-inventory-transfers";
import {
  ACTION_LABEL, EXCEPTION_LABEL, EXCEPTION_TYPES, REPORT_LABEL, REPORT_TYPES, SHIPPING_METHODS, reportSummary, transferNextStep, validateActionPayload,
} from "../../../../lib/workspace/general-affairs/inventory-transfer-rules";

// G13 調撥單詳情與動作：確認交出、運送中、收貨、取消（可勾退回來源庫存、結構化異常類型）、「未收」註記（只註記，單子仍待收貨 C9）、店長回報問題（C10，只寫標記）。
// 每個動作帶 expected_updated_at（別人先處理過回 409 STALE，可重新載入）與固定識別（連點、重送只會處理一次）；按鈕依伺服端算好的 abilities 顯示。
const props = defineProps<{ transferId: string; overdueDays: number }>();
const emit = defineEmits<{ close: []; changed: [] }>();

type Panel = "confirm_source" | "ship" | "receive" | "cancel" | "mark_unreceived" | "store_report" | "";
const t = ref<TransferView | null>(null);
const loadError = ref("");
const panel = ref<Panel>("");
const note = ref("");
const shipping = ref("");
const cancelKind = ref<"plain" | "exception">("plain");
const exceptionType = ref("SHORT_RECEIVED");
const returnStock = ref(false);
const reportType = ref("NOT_ARRIVED");
const key = ref(newKey());
const busy = ref(false);
const error = ref("");
const stale = ref(false);
const done = ref("");

async function load() {
  loadError.value = "";
  try {
    t.value = (await api<{ data: TransferView }>(`general-affairs/inventory/transfers/${props.transferId}`)).data;
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}
onMounted(load);
watch([panel, note, shipping, cancelKind, exceptionType, returnStock, reportType], () => { key.value = newKey(); });

function open(p: Panel) {
  panel.value = panel.value === p ? "" : p;
  error.value = "";
  stale.value = false;
  done.value = "";
  note.value = "";
  shipping.value = t.value?.shipping_method || "";
  cancelKind.value = "plain";
  returnStock.value = false;
}
const a = computed(() => t.value?.abilities);
const issued = computed(() => !!t.value?.items.some((i) => i.source_transaction_id && !i.receipt_transaction_id));
const nextStep = computed(() => (t.value ? transferNextStep(t.value.status) : ""));

async function submit() {
  if (!t.value || !panel.value || busy.value) return;
  error.value = "";
  let payload;
  try {
    payload = validateActionPayload({
      action: panel.value, expected_updated_at: t.value.updated_at, idempotency_key: key.value, note: note.value,
      ...(panel.value === "ship" || panel.value === "confirm_source" ? { shipping_method: shipping.value } : {}),
      ...(panel.value === "cancel" ? { return_stock: returnStock.value, ...(cancelKind.value === "exception" ? { exception_type: exceptionType.value } : {}) } : {}),
      ...(panel.value === "store_report" ? { report_type: reportType.value } : {}),
    });
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  busy.value = true;
  try {
    const res = await api<{ data: any; replay: boolean }>(`general-affairs/inventory/transfers/${t.value.id}/actions`, { method: "POST", body: JSON.stringify(payload) });
    done.value = res.replay ? "這個動作已經處理過了（重複送出），沒有再處理一次。" : `${ACTION_LABEL[panel.value]}完成。`;
    panel.value = "";
    emit("changed"); // 先通知清單重新整理：使用者若在詳情重新載入完成前就關閉視窗，清單仍會更新
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") stale.value = true;
    if (e instanceof ApiError && e.data?.code === "IDEMPOTENCY_CONFLICT") key.value = newKey();
  } finally {
    busy.value = false;
  }
}
async function reloadAfterStale() {
  panel.value = "";
  stale.value = false;
  error.value = "";
  emit("changed");
  await load();
}
const panelTitle = computed(() => (panel.value ? ACTION_LABEL[panel.value] : ""));
const submitLabel = computed(() => ({ confirm_source: "確認交出（扣來源庫存）", ship: "標記運送中", receive: "確認收貨（增加目的庫存）", cancel: cancelKind.value === "exception" ? "異常終結並取消" : "取消調撥單", mark_unreceived: "註記未收", store_report: "送出回報", "": "" })[panel.value]);
const eventText = (e: any) => {
  if (e.action === "store_report") return `${ACTION_LABEL.store_report}：${REPORT_LABEL[e.report_type] || ""}`;
  if (e.action === "cancel") return `${ACTION_LABEL.cancel}${e.exception_type ? `（異常：${EXCEPTION_LABEL[e.exception_type]}）` : ""}${e.return_stock ? "，已退回來源庫存" : ""}`;
  return ACTION_LABEL[e.action] || e.action;
};
</script>

<template>
  <Modal :title="t ? `調撥單 ${t.transfer_no}` : '調撥單'" wide :busy="busy" @cancel="emit('close')">
    <p v-if="loadError" class="notice error" role="alert" data-testid="detail-error">{{ loadError }}</p>
    <p v-else-if="!t" class="muted" role="status">載入中…</p>
    <div v-else class="detail" data-testid="transfer-detail">
      <div class="head-line">
        <TransferStatusBadge :status="t.status" />
        <span v-if="t.is_overdue" class="flag overdue" data-testid="flag-overdue">已交出 {{ t.days_since_issued }} 天還沒收貨（超過 {{ overdueDays }} 天）</span>
        <span v-if="t.has_store_report" class="flag reported" data-testid="flag-reported">門市回報有問題</span>
        <span v-if="t.unreceived_marked_at" class="flag unreceived" data-testid="flag-unreceived">已註記未收</span>
      </div>
      <p v-if="nextStep" class="muted" data-testid="next-step">{{ nextStep }}</p>
      <p v-if="done" class="notice success" role="status" data-testid="action-done">{{ done }}</p>

      <dl class="facts">
        <div><dt>來源位置</dt><dd data-testid="d-source">{{ placeText(t.source_location) }}</dd></div>
        <div><dt>目的位置</dt><dd data-testid="d-dest">{{ placeText(t.destination_location) }}</dd></div>
        <div><dt>調撥原因</dt><dd>{{ t.reason }}</dd></div>
        <div><dt>運送方式</dt><dd>{{ t.shipping_method || "未定" }}</dd></div>
        <div v-if="t.notes"><dt>備註</dt><dd data-testid="d-notes">{{ t.notes }}</dd></div>
        <div v-if="t.cancel_reason"><dt>取消原因</dt><dd data-testid="d-cancel">{{ t.cancel_reason }}</dd></div>
      </dl>

      <div v-if="t.unreceived_marked_at" class="callout" data-testid="unreceived-box">
        <strong>未收註記（{{ fmtTime(t.unreceived_marked_at) }}）</strong>
        <p v-if="t.unreceived_note">{{ t.unreceived_note }}</p>
        <p class="muted">這只是註記，調撥單仍是「待收貨」，目的位置收到後可以直接確認收貨。</p>
      </div>
      <div v-if="t.has_store_report" class="callout danger" data-testid="report-box">
        <strong>門市回報問題（{{ fmtTime(t.store_reported_at) }}）</strong>
        <p>{{ reportSummary(t.store_report_type, t.store_report_note) }}</p>
        <p class="muted">門市回報只是標記，不會改變調撥單狀態或庫存。</p>
      </div>

      <h3>調撥明細</h3>
      <ul class="items">
        <li v-for="i in t.items" :key="i.id" data-testid="detail-item"><strong>{{ itemText(i) }}</strong><span class="muted">{{ itemState(t.status, i) }}</span></li>
      </ul>

      <h3>處理紀錄</h3>
      <ol class="timeline" data-testid="timeline">
        <li v-for="e in t.events || []" :key="e.id" data-testid="timeline-item">
          <strong>{{ eventText(e) }}</strong><span class="muted">{{ fmtTime(e.created_at) }}{{ e.creator_name ? `　${e.creator_name}` : "" }}</span>
          <p v-if="e.note" class="tl-note">{{ e.note }}</p>
        </li>
        <li v-if="!(t.events || []).length" class="muted">沒有處理紀錄（舊版建立的調撥單沒有逐步紀錄）。</li>
      </ol>

      <p v-if="a?.problem && t.status !== 'RECEIVED' && t.status !== 'CANCELED'" class="notice" role="status" data-testid="ability-problem">您不能處理這張調撥單：{{ a.problem }}</p>
      <div class="actions" role="group" aria-label="調撥單動作">
        <button v-if="a?.confirm_source" type="button" :class="{ primary: panel === 'confirm_source' }" data-testid="act-confirm_source" @click="open('confirm_source')">確認交出</button>
        <button v-if="a?.ship" type="button" :class="{ primary: panel === 'ship' }" data-testid="act-ship" @click="open('ship')">標記運送中</button>
        <button v-if="a?.receive" type="button" :class="{ primary: panel === 'receive' }" data-testid="act-receive" @click="open('receive')">確認收貨</button>
        <button v-if="a?.mark_unreceived" type="button" :class="{ primary: panel === 'mark_unreceived' }" data-testid="act-mark_unreceived" @click="open('mark_unreceived')">註記未收</button>
        <button v-if="a?.cancel" type="button" class="danger-outline" :class="{ primary: panel === 'cancel' }" data-testid="act-cancel" @click="open('cancel')">取消／異常</button>
        <button v-if="a?.store_report" type="button" :class="{ primary: panel === 'store_report' }" data-testid="act-store_report" @click="open('store_report')">回報問題</button>
      </div>

      <form v-if="panel" class="panel" novalidate data-testid="action-panel" @submit.prevent="submit">
        <h3>{{ panelTitle }}</h3>
        <template v-if="panel === 'confirm_source'">
          <p>確認來源位置已把料件交出。系統會馬上從來源位置扣掉庫存；來源庫存不足（且不允許負庫存）會失敗，單子維持原狀。</p>
        </template>
        <template v-if="panel === 'receive'">
          <p>確認目的位置已收到<strong>全部</strong>料件。系統會增加目的位置的庫存。調撥單只能整張全收；有少收、損壞等問題請改用「取消／異常」。</p>
        </template>
        <template v-if="panel === 'mark_unreceived'">
          <p>目的位置回報還沒收到時，在這裡註記。<strong>單子仍是待收貨</strong>，不會取消也不會動庫存；收到了再按「確認收貨」。</p>
        </template>
        <label v-if="panel === 'confirm_source' || panel === 'ship'">運送方式<select v-model="shipping" aria-label="運送方式"><option value="">未定</option><option v-for="m in SHIPPING_METHODS" :key="m" :value="m">{{ m }}</option></select></label>
        <template v-if="panel === 'cancel'">
          <fieldset class="radios">
            <legend>取消方式</legend>
            <label><input v-model="cancelKind" type="radio" value="plain" name="cancel-kind" data-testid="cancel-plain" />一般取消（不要這張調撥了）</label>
            <label><input v-model="cancelKind" type="radio" value="exception" name="cancel-kind" data-testid="cancel-exception" />異常終結（少收、損壞、品項錯誤、遺失）</label>
          </fieldset>
          <label v-if="cancelKind === 'exception'">異常類型<select v-model="exceptionType" aria-label="異常類型" data-testid="exception-type"><option v-for="x in EXCEPTION_TYPES" :key="x" :value="x">{{ EXCEPTION_LABEL[x] }}</option></select></label>
          <div v-if="a?.returnStockAvailable || issued" class="return-box">
            <label class="check"><input v-model="returnStock" type="checkbox" data-testid="return-stock" />把已經從來源位置扣掉的庫存退回來源位置</label>
            <p v-if="!returnStock" class="warn-text" role="alert" data-testid="return-warning">沒有勾選：來源位置已扣掉的庫存不會回來。只有料件真的遺失或損壞時才不要勾。</p>
            <p v-else class="muted">會在來源位置入庫一筆「調撥取消退回來源」，流水可追蹤。</p>
          </div>
          <p v-else class="muted">這張單還沒交出，來源庫存沒有被扣，取消後不需要退回。</p>
        </template>
        <label v-if="panel === 'store_report'">問題類型<select v-model="reportType" aria-label="問題類型" data-testid="report-type"><option v-for="x in REPORT_TYPES" :key="x" :value="x">{{ REPORT_LABEL[x] }}</option></select></label>
        <label>{{ panel === "cancel" ? (cancelKind === "exception" ? "說明（類型選「其他」時必填）" : "取消原因（必填）") : panel === "store_report" ? "說明（類型選「其他」時必填）" : "備註（選填）" }}
          <textarea v-model="note" rows="2" maxlength="500" aria-label="說明或備註" data-testid="action-note" /></label>
        <p v-if="error" class="field-error" role="alert" data-testid="action-error">{{ error }}</p>
        <p v-if="stale" class="notice" role="alert" data-testid="stale-box">這張調撥單剛被別人處理過。<button type="button" data-testid="reload-detail" @click="reloadAfterStale">重新載入最新狀態</button></p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="panel = ''">先不要</button>
          <button type="submit" class="primary" :class="{ danger: panel === 'cancel' }" :disabled="busy" data-testid="action-submit">{{ busy ? "處理中…" : submitLabel }}</button>
        </div>
      </form>
      <div class="dialog-actions"><button type="button" data-testid="detail-close" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.detail { display: grid; gap: 12px; }
.head-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.flag { border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.flag.overdue, .flag.reported { background: #fde7e5; color: #8c1d18; border-color: #e5a9a5; }
.flag.unreceived { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .flag.overdue, :root[data-theme="dark"] .flag.reported { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
:root[data-theme="dark"] .flag.unreceived { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 0; }
.facts div { display: grid; gap: 2px; min-width: 0; }
.facts dt { font-size: 12px; color: var(--muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
h3 { margin: 4px 0 0; font-size: 15px; }
.callout { border: 1px solid #ecd391; background: #fff8e4; border-radius: 8px; padding: 10px 12px; display: grid; gap: 4px; }
.callout.danger { border-color: #e5a9a5; background: #fdeeed; }
.callout p { margin: 0; }
:root[data-theme="dark"] .callout { background: #3a3114; border-color: #6b5a24; }
:root[data-theme="dark"] .callout.danger { background: #3d1a18; border-color: #7a3531; }
.items, .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.items li { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.timeline li { border-left: 3px solid var(--line); padding: 2px 0 2px 12px; display: grid; gap: 2px; }
.timeline .tl-note { margin: 0; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions button { min-height: 40px; }
.danger-outline { color: var(--danger, #b3261e); border-color: var(--danger, #b3261e); }
.panel { border: 2px solid var(--primary); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; background: var(--soft); }
.panel p { margin: 0; }
.panel label { display: grid; gap: 4px; }
.radios { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: grid; gap: 6px; margin: 0; }
.radios label, .panel label.check { display: flex; gap: 8px; align-items: center; }
.radios input, .check input { width: auto; }
.warn-text { color: var(--danger, #b3261e); font-weight: 600; }
.return-box { display: grid; gap: 6px; }
@media (max-width: 700px) { .facts { grid-template-columns: 1fr; } .actions button, .panel .dialog-actions button { min-height: 44px; } }
</style>
