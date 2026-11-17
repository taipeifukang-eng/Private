<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import PoDispatchDialog from "./PoDispatchDialog.vue";
import PoReceiptDialog from "./PoReceiptDialog.vue";
import { openGaPage } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { FULFIL_TEXT, PO_STATUS_LABEL, dateText, eventText, money, num, visibleActions, type DispatchView, type PoDetail, type Receiving } from "../../lib/ga-purchase";
import { PO_ACTION_LABEL, reasonRequired, type PoAction } from "../../../../lib/workspace/general-affairs/purchase-order-rules";

// 採購單詳情與處理（清單頁與待簽核頁共用）：品項、金額、核准資訊、時間軸（每步操作人與時間，D11）、進貨紀錄、配發紀錄，
// 以及送核准、撤回、核准、駁回（須原因）、撤回核准、下訂、取消、短收結案、結案、登錄到貨、配發。按鈕依伺服端算好的 abilities 顯示；缺權限會說清楚缺哪個。
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const po = ref<PoDetail | null>(null);
const receiving = ref<Receiving | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const stale = ref(false);
const panel = ref<"" | "action" | "receipt" | "dispatch">("");
const action = ref<PoAction>("submit");
const note = ref("");
const formError = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: PoDetail; receiving: Receiving }>(`general-affairs/purchase-orders/${props.id}`);
    po.value = res.data;
    receiving.value = res.receiving;
    stale.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const a = computed(() => po.value?.abilities);
const canReceive = computed(() => !!po.value && a.value?.problem === "" && ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.value.status) && !!receiving.value?.items.some((i) => i.remaining_qty > 0));
const canDispatch = computed(() => !!po.value && a.value?.problem === "" && !["DRAFT", "PENDING_APPROVAL", "APPROVED", "CANCELED"].includes(po.value.status) && !!receiving.value?.items.some((i) => i.fulfil_mode === "STOCK" && i.dispatchable_base > 0));
const available = computed(() => (po.value ? (visibleActions(po.value) as PoAction[]) : []));
const needReason = computed(() => !!po.value && reasonRequired(action.value, po.value.status));
const NOTE_LABEL: Record<string, string> = { reject: "駁回原因（必填）", revoke_approval: "撤回核准的原因（必填）", short_close: "短收結案的原因（必填）", cancel: "取消原因", approve: "核准備註（選填）" };

function startAction(x: PoAction) { action.value = x; note.value = ""; formError.value = ""; panel.value = "action"; }
async function submitAction() {
  if (busy.value || !po.value) return;
  formError.value = "";
  if (needReason.value && !note.value.trim()) { formError.value = NOTE_LABEL[action.value] ? NOTE_LABEL[action.value].replace("（必填）", "") + "必須填寫" : "必須填寫原因"; return; }
  busy.value = true;
  try {
    const res = await api<{ data: PoDetail }>(`general-affairs/purchase-orders/${po.value.id}/actions`, {
      method: "POST", body: JSON.stringify({ action: action.value, expected_updated_at: po.value.updated_at, note: note.value.trim() || undefined }),
    });
    notice.value = `已${PO_ACTION_LABEL[action.value]}。`;
    panel.value = "";
    po.value = res.data;
    emit("changed"); // 先通知清單重新整理：使用者若在重新載入完成前關閉視窗，清單仍會更新
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") stale.value = true;
  } finally {
    busy.value = false;
  }
}
async function onReceipt(r: { order: PoDetail; receiving: Receiving; replay: boolean }) {
  po.value = r.order;
  receiving.value = r.receiving;
  panel.value = "";
  notice.value = r.replay ? "這次到貨先前已登錄，沒有重複入帳。" : "到貨已登錄並驗入，庫存已更新。";
  emit("changed");
}
async function onDispatch(r: { order: PoDetail; receiving: Receiving; replay: boolean; data: any }) {
  po.value = r.order;
  receiving.value = r.receiving;
  panel.value = "";
  const n = r.data?.equipment?.length ?? 0;
  notice.value = r.replay ? "這次配發先前已完成，沒有重複建立設備。" : `已配發並建立 ${n} 筆設備，門市店長的貼標待辦已出現。`;
  emit("changed");
}
function edit() { if (po.value) { openGaPage("ga-purchase-order-edit", po.value.id); emit("close"); } }
const nameOf = (id: string) => po.value?.items.find((i) => i.id === id)?.item_name || "";
const dispatchesOf = computed<DispatchView[]>(() => receiving.value?.dispatches || []);
</script>

<template>
  <Modal :title="po ? `採購單 ${po.po_no}` : '採購單'" :busy="busy" wide @cancel="emit('close')">
    <div class="pd" data-testid="po-detail">
      <p v-if="loading && !po" role="status">載入中…</p>
      <p v-if="error" class="notice error" role="alert" data-testid="pd-error">{{ error }}</p>
      <p v-if="notice" class="notice success" role="status" data-testid="pd-notice">{{ notice }}</p>
      <template v-if="po && a">
        <p class="pd-status"><span class="st" :data-status="po.status" data-testid="pd-status">{{ PO_STATUS_LABEL[po.status] || po.status_label }}</span>
          <strong data-testid="pd-vendor">{{ po.vendor_name || "（尚未選供應商）" }}</strong>
          <span v-if="po.vendor_current_status && po.vendor_current_status !== 'active'" class="muted" data-testid="pd-vendor-status" :title="'廠商目前狀態：' + po.vendor_current_status">{{ po.vendor_current_status === "paused" ? "（暫停）" : "（已停用）" }}</span></p>
        <dl class="pd-meta">
          <div><dt>含稅總額</dt><dd data-testid="pd-total">{{ money(po.total_amount) }}<small class="muted">（未稅 {{ money(po.subtotal) }}＋稅 {{ money(po.tax_amount) }}）</small></dd></div>
          <div><dt>開單人</dt><dd>{{ po.created_by_name || "" }}　{{ fmtTime(po.created_at) }}</dd></div>
          <div><dt>預計到貨日</dt><dd>{{ dateText(po.expected_delivery_date) || "未填" }}</dd></div>
          <div><dt>收貨位置</dt><dd>{{ po.receiving_location_name || "未選" }}</dd></div>
          <div v-if="po.source_request_no"><dt>來源需求單</dt><dd data-testid="pd-request">{{ po.source_request_no }}</dd></div>
          <div v-if="po.vendor_billing_visible"><dt>統一編號</dt><dd data-testid="pd-tax-id">{{ po.vendor_tax_id || "未填" }}</dd></div>
          <div v-if="po.vendor_billing_visible"><dt>付款條件</dt><dd data-testid="pd-terms">{{ po.vendor_payment_terms || "未填" }}</dd></div>
          <div v-if="po.approval_required"><dt>核准</dt><dd data-testid="pd-approval">需核准（送簽當時門檻 {{ money(po.approval_threshold_snapshot) }}）<span v-if="po.approved_by_name">；已由 {{ po.approved_by_name }} 於 {{ fmtTime(po.approved_at) }} 核准<template v-if="po.approval_note">（{{ po.approval_note }}）</template></span></dd></div>
          <div v-if="po.last_reject_reason"><dt>最近駁回原因</dt><dd data-testid="pd-reject-reason">{{ po.last_reject_reason }}</dd></div>
          <div v-if="po.cancel_reason"><dt>取消原因</dt><dd>{{ po.cancel_reason }}</dd></div>
          <div v-if="po.short_close_reason"><dt>短收結案原因</dt><dd>{{ po.short_close_reason }}</dd></div>
          <div v-if="po.notes"><dt>備註</dt><dd class="pre">{{ po.notes }}</dd></div>
        </dl>
        <p v-if="!po.vendor_billing_visible" class="muted" data-testid="pd-billing-masked">您沒有廠商檢視權限，不顯示統編與付款條件。</p>
        <p v-if="a.problemNotice" class="notice" role="status" data-testid="pd-problem">{{ a.problemNotice }}</p>
        <p v-if="a.approveBlocked" class="notice" role="status" data-testid="approve-blocked">{{ a.approveBlocked }}</p>

        <div class="pd-actions">
          <button v-for="x in available" :key="x" type="button" :class="{ primary: x === 'approve' || x === 'place_order' || x === 'submit' }" :data-testid="'act-' + x" :disabled="busy" @click="startAction(x)">{{ PO_ACTION_LABEL[x] }}</button>
          <button v-if="a.edit || a.editNotesOnly" type="button" data-testid="act-edit" @click="edit">{{ a.edit ? "編輯草稿" : "改備註與預計到貨日" }}</button>
          <button v-if="canReceive" type="button" class="primary" data-testid="act-receipt" @click="panel = 'receipt'">登錄到貨</button>
          <button v-if="canDispatch" type="button" data-testid="act-dispatch" @click="panel = 'dispatch'">配發為設備</button>
        </div>
        <p v-if="stale" class="notice" role="alert"><button type="button" data-testid="reload-stale" @click="load">已有人修改過，重新載入最新內容</button></p>

        <section v-if="panel === 'action'" class="pd-form" data-testid="action-form">
          <h4>{{ PO_ACTION_LABEL[action] }}</h4>
          <p v-if="action === 'place_order'" class="muted">下訂後品項、數量、單價與供應商會鎖定，只能改備註與預計到貨日；並會複製供應商名稱、統編與付款條件作為下訂當時的快照。</p>
          <p v-if="action === 'submit'" class="muted">含稅總額超過核准門檻的採購單，送出後要由持有「採購核准」權限的人核准才能下訂；送出後不能修改，要改請先撤回。</p>
          <label>{{ NOTE_LABEL[action] || "備註（選填）" }}<textarea v-model="note" rows="3" maxlength="500" data-testid="f-note" /></label>
          <p v-if="formError" class="field-error" role="alert" data-testid="action-error">{{ formError }}</p>
          <div class="dialog-actions">
            <button type="button" :disabled="busy" data-testid="action-cancel" @click="panel = ''">取消</button>
            <button type="button" class="primary" :disabled="busy" data-testid="action-submit" @click="submitAction">{{ busy ? "處理中…" : "確定" + PO_ACTION_LABEL[action] }}</button>
          </div>
        </section>

        <h3>品項</h3>
        <div class="table-scroll"><table data-testid="pd-items">
          <thead><tr><th>#</th><th>品名</th><th>數量</th><th>單價（未稅）</th><th>小計</th><th>處理方式</th><th>已驗入</th><th>已配發</th></tr></thead>
          <tbody>
            <tr v-for="i in po.items" :key="i.id" data-testid="pd-item">
              <td>{{ i.line_no }}</td>
              <td>{{ i.item_name }}<small v-if="i.spec" class="muted"> {{ i.spec }}</small><small v-if="i.request_no" class="muted">　需求單 {{ i.request_no }}</small><small v-if="i.over_request_reason" class="muted">　超量原因：{{ i.over_request_reason }}</small></td>
              <td>{{ num(i.quantity) }} {{ i.unit }}</td><td>{{ money(i.unit_price) }}</td><td>{{ money(i.line_amount) }}</td>
              <td>{{ FULFIL_TEXT[i.fulfil_mode] }}<small v-if="i.target_store_name" class="muted">　送 {{ i.target_store_name }}</small></td>
              <td data-testid="pd-received">{{ num(i.received_qty) }}</td><td>{{ i.fulfil_mode === "STOCK" ? num(i.dispatched_qty) : "-" }}</td>
            </tr>
          </tbody>
        </table></div>

        <h3>進貨紀錄</h3>
        <ul class="pd-list" data-testid="pd-receipts">
          <li v-for="r in receiving?.receipts || []" :key="r.id" data-testid="pd-receipt">
            <strong>{{ r.receipt_no }}</strong>　到貨日 {{ dateText(r.received_date) }}<span v-if="r.delivery_note_no">　送貨單 {{ r.delivery_note_no }}</span><span class="muted">　{{ r.created_by_name }} {{ fmtTime(r.created_at) }}</span>
            <ul><li v-for="it in r.items" :key="it.id">{{ nameOf(it.po_item_id) || it.item_name }}：到貨 {{ num(it.delivered_qty) }}、驗入 {{ num(it.accepted_qty) }}<template v-if="Number(it.rejected_qty) > 0">、拒收 {{ num(it.rejected_qty) }}</template><template v-if="it.reason">（{{ it.reason }}）</template><template v-if="it.change_reason">　變更：{{ it.change_reason }}</template><template v-if="it.equipment?.length">　建立設備 {{ it.equipment.length }} 台</template></li></ul>
          </li>
          <li v-if="!(receiving?.receipts || []).length" class="muted">還沒有到貨紀錄</li>
        </ul>

        <h3>配發紀錄</h3>
        <ul class="pd-list" data-testid="pd-dispatches">
          <li v-for="d in dispatchesOf" :key="d.id" data-testid="pd-dispatch">
            <strong>{{ d.dispatch_no }}</strong>　{{ nameOf(d.po_item_id) }} × {{ num(d.quantity) }}　送 {{ d.store_name }}<span class="muted">　{{ fmtTime(d.created_at) }}</span>
            <ul><li v-for="e in d.equipment || []" :key="e.id">{{ e.asset_code || "（尚無編號）" }}　{{ e.name }}　序號：{{ e.serial_number || "未填（待店長貼標時補）" }}</li></ul>
          </li>
          <li v-if="!dispatchesOf.length" class="muted">還沒有配發紀錄</li>
        </ul>

        <h3>處理紀錄</h3>
        <ol class="pd-events" data-testid="pd-events">
          <li v-for="e in po.events" :key="e.id" data-testid="pd-event"><strong>{{ eventText(e.event_type) }}</strong><span class="muted">　{{ e.actor_name || "系統" }}　{{ fmtTime(e.created_at) }}</span><p v-if="e.note">{{ e.note }}</p></li>
        </ol>
      </template>
      <div class="dialog-actions"><button type="button" data-testid="pd-close" @click="emit('close')">關閉</button></div>
    </div>
    <PoReceiptDialog v-if="panel === 'receipt' && po && receiving" :order="po" :receiving="receiving" @close="panel = ''" @done="onReceipt" />
    <PoDispatchDialog v-if="panel === 'dispatch' && po && receiving" :order="po" :receiving="receiving" @close="panel = ''" @done="onDispatch" />
  </Modal>
</template>

<style scoped>
.pd { display: grid; gap: 10px; min-width: 0; }
.pd h3 { margin: 6px 0 0; font-size: 15px; }
.pd-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.pd-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 16px; margin: 0; }
.pd-meta div { min-width: 0; }
.pd-meta dt { font-size: 12px; color: var(--muted); }
.pd-meta dd { margin: 0; overflow-wrap: anywhere; }
.pre { white-space: pre-wrap; }
.pd-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-form { display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.pd-form h4 { margin: 0; }
.pd-form label { display: grid; gap: 4px; }
.pd-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pd-list ul { margin: 4px 0 0; padding-left: 18px; }
.pd-list li { overflow-wrap: anywhere; }
.pd-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pd-events li { border-left: 3px solid var(--line); padding-left: 10px; }
.pd-events p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 700px) { .pd-actions button, .dialog-actions button { min-height: 44px; } }
</style>
