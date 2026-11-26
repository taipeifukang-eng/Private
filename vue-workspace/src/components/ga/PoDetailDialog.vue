<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import PoDispatchDialog from "./PoDispatchDialog.vue";
import PoPaymentPanel from "./PoPaymentPanel.vue";
import PoReceiptDialog from "./PoReceiptDialog.vue";
import PrepayCreateDialog from "./PrepayCreateDialog.vue";
import { useSession } from "../../stores";
import { openGaPage } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { FULFIL_TEXT, PO_STATUS_LABEL, dateText, eventText, money, newKey, num, visibleActions, type DispatchView, type PoDetail, type Receiving } from "../../lib/ga-purchase";
import { receiptVoidBlock } from "../../../../lib/workspace/general-affairs/purchase-receipt-rules";
import { ADJ_KIND_LABELS, PO_ACTION_LABEL, PRICE_MODE_LABELS, reasonRequired, type PoAction } from "../../../../lib/workspace/general-affairs/purchase-order-rules";

// 採購單詳情與處理（清單頁與待簽核頁共用）：品項、金額、核准資訊、時間軸（每步操作人與時間，D11）、進貨紀錄、配發紀錄，
// 以及送核准、撤回、核准、駁回（須原因）、撤回核准、下訂、取消、短收結案、結案、登錄到貨、配發。按鈕依伺服端算好的 abilities 顯示；缺權限會說清楚缺哪個。
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
// 第 4.5 批：「發票與請款」分頁（金額與入口只給有請款檢視／管理權限者，與資料庫語意相同；管理員沒掛權限不顯示）。
const session = useSession();
const showPay = computed(() => !!session.data?.capabilities?.gaPurchaseInvoices);
const canPayManage = computed(() => !!session.data?.capabilities?.gaPaymentManage);
const tab = ref<"detail" | "pay">("detail");
const payPanel = ref<InstanceType<typeof PoPaymentPanel> | null>(null);
async function registerVoucher(receiptId: string) {
  tab.value = "pay";
  // 分頁剛切過來時元件才掛上；等載入完成再開對話框。
  for (let n = 0; n < 40 && !payPanel.value; n += 1) await new Promise((r) => setTimeout(r, 50));
  await payPanel.value?.load();
  payPanel.value?.openVoucher(receiptId);
}
const po = ref<PoDetail | null>(null);
const receiving = ref<Receiving | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const stale = ref(false);
const panel = ref<"" | "action" | "receipt" | "dispatch" | "voidReceipt" | "prepay">("");
// ga-improve-b1：登錄憑證連結只給「還沒連發票、還沒被已付款請款（含預付核銷）使用」的進貨單，口徑與「發票與請款」分頁一致。
const voucherOpen = (r: Receiving["receipts"][number]) => !!canPayManage.value && showPay.value && !r.voided_at && r.voucher_status !== "LINKED" && !r.has_paid_claim;
// G1：已下訂（已下訂或部分到貨）且有請款管理權限者可新增預付請款。
const canPrepay = computed(() => !!po.value && canPayManage.value && showPay.value && ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.value.status));
function onPrepayCreated(pr: { id: string }) { panel.value = ""; openGaPage("ga-payment-request-edit", pr.id); emit("changed"); emit("close"); }
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
// 第 4.5 批 P6：作廢進貨（原因必填；沖回庫存、扣回驗入量、重算採購單狀態；已請款、已配發、連有效發票、已結案者由伺服端擋下並說明）。
const voidTarget = ref<Receiving["receipts"][number] | null>(null);
const voidReason = ref("");
const voidError = ref("");
const voidKey = ref(newKey());
const canVoidReceipt = computed(() => !!po.value && a.value?.problem === "" && ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.value.status));
// 前端預判：已配發成設備、驗入時直接建立設備的進貨不顯示作廢按鈕（其餘條件由伺服端判斷並說明）。
const voidable = (r: Receiving["receipts"][number]) =>
  canVoidReceipt.value && !receiptVoidBlock({ poStatus: po.value?.status || "", voided: !!r.voided_at, dispatchedQty: r.items.reduce((s, i) => s + Number(i.dispatched_qty || 0), 0), directAssetAccepted: r.items.some((i) => i.fulfil_mode === "DIRECT_ASSET" && Number(i.accepted_qty) > 0) });
function startVoid(r: Receiving["receipts"][number]) { voidTarget.value = r; voidReason.value = ""; voidError.value = ""; voidKey.value = newKey(); panel.value = "voidReceipt"; }
async function submitVoid() {
  if (busy.value || !po.value || !voidTarget.value) return;
  if (!voidReason.value.trim()) { voidError.value = "作廢進貨必須填寫原因"; return; }
  busy.value = true;
  voidError.value = "";
  try {
    const res = await api<{ order: PoDetail; receiving: Receiving; replay: boolean }>(`general-affairs/purchase-orders/${po.value.id}/receipts/${voidTarget.value.id}/void`, {
      method: "POST", body: JSON.stringify({ reason: voidReason.value.trim(), idempotency_key: voidKey.value, expected_updated_at: voidTarget.value.updated_at }),
    });
    po.value = res.order;
    receiving.value = res.receiving;
    panel.value = "";
    voidTarget.value = null;
    notice.value = res.replay ? "這張進貨單先前已作廢，沒有重複沖回。" : "進貨已作廢：庫存已沖回，採購單的已驗入數量與狀態已重新計算。";
    emit("changed");
  } catch (e) {
    voidError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") stale.value = true;
  } finally {
    busy.value = false;
  }
}
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
          <div><dt>單價計價方式</dt><dd data-testid="pd-price-mode">{{ PRICE_MODE_LABELS[po.price_mode || "EXCL"] }}</dd></div>
          <div v-if="po.buyer_company_name"><dt>買受人抬頭</dt><dd data-testid="pd-buyer">{{ po.buyer_company_name }}<small class="muted">（{{ po.buyer_company_tax_id }}）</small></dd></div>
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

        <section v-if="po.prepay || canPrepay" class="pd-prepay" data-testid="pd-prepay">
          <h3>預付款</h3>
          <template v-if="po.prepay">
            <ul class="pd-stats" aria-label="預付摘要">
              <li><span>已預付</span><strong data-testid="pd-prepaid">{{ money(po.prepay.prepaid) }}</strong></li>
              <li><span>已核銷到進貨</span><strong data-testid="pd-prepay-offset">{{ money(po.prepay.offset) }}</strong></li>
              <li><span>已退款或轉抵</span><strong data-testid="pd-prepay-refunded">{{ money(po.prepay.refunded) }}</strong></li>
              <li><span>預付餘額</span><strong data-testid="pd-prepay-balance">{{ money(po.prepay.balance) }}</strong></li>
            </ul>
            <p v-if="po.prepay.overdue" class="notice error" role="alert" data-testid="pd-prepay-overdue">已預付 {{ money(po.prepay.balance) }}，超過預計到貨日 {{ po.prepay.overdue_days }} 天仍未到貨，請向廠商催貨或登記退款。</p>
            <p v-if="po.prepay.unsettled" class="notice error" role="alert" data-testid="pd-prepay-unsettled">這張採購單已全部到貨，但預付款還有餘額 {{ money(po.prepay.balance) }} 沒有核銷，請向廠商要求退款，並在預付請款單登記退款或轉抵。</p>
            <ul class="pd-list" data-testid="pd-prepay-requests">
              <li v-for="q in po.prepay.requests" :key="q.id" data-testid="pd-prepay-req"><button type="button" class="link" @click="openGaPage('ga-payment-request-edit', q.id)">{{ q.pr_no }}</button>　{{ money(q.amount_total) }}　<span class="muted">{{ ({ DRAFT: "草稿", SUBMITTED: "已送出", PAID: "已付款" } as Record<string, string>)[q.status] || q.status }}，餘額 {{ money(q.balance) }}</span></li>
            </ul>
          </template>
          <p v-else class="muted">還沒有預付款。下訂後可以先付訂金或貨款，不必等到貨。</p>
          <div><button v-if="canPrepay" type="button" data-testid="act-prepay" @click="panel = 'prepay'">新增預付請款</button></div>
        </section>
        <div v-if="showPay" class="pd-tabs" role="tablist" aria-label="採購單內容">
          <button type="button" role="tab" :aria-selected="tab === 'detail'" :class="{ on: tab === 'detail' }" data-testid="pd-tab-detail" @click="tab = 'detail'">明細與進貨</button>
          <button type="button" role="tab" :aria-selected="tab === 'pay'" :class="{ on: tab === 'pay' }" data-testid="pd-tab-pay" @click="tab = 'pay'">發票與請款</button>
        </div>
        <PoPaymentPanel v-if="showPay && tab === 'pay'" ref="payPanel" :po-id="po.id" @changed="emit('changed')" />
        <div v-show="tab === 'detail'" class="pd-detail">
        <h3>品項</h3>
        <div class="table-scroll"><table data-testid="pd-items">
          <thead><tr><th>#</th><th>品名</th><th>數量</th><th>{{ po.price_mode === "INCL" ? "單價（含稅）" : "單價（未稅）" }}</th><th>小計</th><th>處理方式</th><th>已驗入</th><th>已配發</th></tr></thead>
          <tbody>
            <tr v-for="i in po.items" :key="i.id" data-testid="pd-item">
              <td>{{ i.line_no }}</td>
              <td>{{ i.item_name }}<small v-if="i.spec" class="muted"> {{ i.spec }}</small><small v-if="i.request_no" class="muted">　需求單 {{ i.request_no }}</small><small v-if="i.over_request_reason" class="muted">　超量原因：{{ i.over_request_reason }}</small></td>
              <td>{{ num(i.quantity) }} {{ i.unit }}</td><td>{{ po.price_mode === "INCL" && i.unit_price_gross != null ? money(i.unit_price_gross) : money(i.unit_price) }}<small v-if="po.price_mode === 'INCL'" class="muted" data-testid="pd-excl-price">　推算未稅 {{ money(i.unit_price) }}</small></td><td>{{ money(po.price_mode === "INCL" && i.line_gross != null ? i.line_gross : i.line_amount) }}</td>
              <td>{{ FULFIL_TEXT[i.fulfil_mode] }}<small v-if="i.target_store_name" class="muted">　送 {{ i.target_store_name }}</small></td>
              <td data-testid="pd-received">{{ num(i.received_qty) }}</td><td>{{ i.fulfil_mode === "STOCK" ? num(i.dispatched_qty) : "-" }}</td>
            </tr>
          </tbody>
        </table></div>
        <template v-if="po.adjustments?.length">
          <h3>調整列</h3>
          <p v-if="['PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status) && po.adjustments.some((x) => !x.receipt_no)" class="notice" role="status" data-testid="pd-adj-unassigned">還有調整列沒有併入任何進貨單（要有一張進貨單的品項金額大於折扣金額才會承接）。若已全部到貨仍沒有併入，這筆折扣不會進到請款金額，請總務確認。</p>
          <ul class="pd-list" data-testid="pd-adjustments">
            <li v-for="a in po.adjustments" :key="a.id" data-testid="pd-adj">
              <strong>{{ ADJ_KIND_LABELS[a.kind] }}</strong><span v-if="a.label && a.label !== ADJ_KIND_LABELS[a.kind]">　{{ a.label }}</span>　<span data-testid="pd-adj-amount">{{ signed(a.amount) }}</span>
              <small v-if="a.original_price != null" class="muted">　原價 {{ money(a.original_price) }}</small><small v-if="a.campaign_name" class="muted">　活動：{{ a.campaign_name }}</small><small v-if="a.note" class="muted">　{{ a.note }}</small>
              <small class="muted" data-testid="pd-adj-carry">　{{ a.receipt_no ? `已併入進貨單 ${a.receipt_no}` : "尚未併入進貨單（第一張有效進貨單會承接）" }}</small>
            </li>
          </ul>
        </template>

        <h3>進貨紀錄</h3>
        <ul class="pd-list" data-testid="pd-receipts">
          <li v-for="r in receiving?.receipts || []" :key="r.id" data-testid="pd-receipt">
            <strong :class="{ voided: r.voided_at }">{{ r.receipt_no }}</strong><span v-if="r.voided_at" class="st voided-tag" data-testid="receipt-voided">已作廢</span>　到貨日 {{ dateText(r.received_date) }}<span v-if="r.delivery_note_no">　送貨單 {{ r.delivery_note_no }}</span><span v-if="showPay && r.amount_total != null" class="muted" data-testid="pd-receipt-total">　含稅 {{ money(r.amount_total) }}</span><span v-if="r.adjustments?.length" class="muted" data-testid="pd-receipt-adj">（含調整列：{{ r.adjustments.map((a) => `${a.label} ${signed(a.amount)}`).join("、") }}）</span><span v-if="Number(r.prepay_offset) > 0" class="muted" data-testid="pd-receipt-offset">（已由預付款核銷 {{ money(r.prepay_offset) }}）</span><button v-if="voucherOpen(r)" type="button" class="link" :data-testid="'reg-voucher-' + r.receipt_no" @click="registerVoucher(r.id)">登錄憑證</button><button v-if="voidable(r)" type="button" class="link" :data-testid="'void-receipt-' + r.receipt_no" @click="startVoid(r)">作廢進貨</button><span class="muted">　{{ r.created_by_name }} {{ fmtTime(r.created_at) }}</span>
            <p v-if="r.voided_at" class="muted" data-testid="receipt-void-reason">作廢原因：{{ r.void_reason }}（{{ fmtTime(r.voided_at) }}；已不計入累計驗入與請款額度）</p>
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
        </div>
      </template>
      <div class="dialog-actions"><button type="button" data-testid="pd-close" @click="emit('close')">關閉</button></div>
    </div>
    <PoReceiptDialog v-if="panel === 'receipt' && po && receiving" :order="po" :receiving="receiving" @close="panel = ''" @done="onReceipt" />
    <Modal v-if="panel === 'voidReceipt' && voidTarget" :title="'作廢進貨 ' + voidTarget.receipt_no" :busy="busy" @cancel="panel = ''">
      <div class="pd-form" data-testid="void-receipt-form">
        <p class="muted">作廢後會把這張進貨單入的庫存沖回（留下反向庫存交易）、扣回採購單的已驗入數量並重算採購單狀態；原進貨紀錄保留不刪除。已被請款單使用、已配發成設備、連結有效發票、採購單已結案的進貨不能作廢。</p>
        <label>作廢原因（必填）<textarea v-model="voidReason" rows="3" maxlength="200" data-testid="f-void-reason" /></label>
        <p v-if="voidError" class="field-error" role="alert" data-testid="void-receipt-error">{{ voidError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" data-testid="void-receipt-cancel" @click="panel = ''">取消</button>
          <button type="button" class="primary" :disabled="busy" data-testid="void-receipt-submit" @click="submitVoid">{{ busy ? "處理中…" : "確定作廢進貨" }}</button>
        </div>
      </div>
    </Modal>
    <PrepayCreateDialog v-if="panel === 'prepay' && po" :po-id="po.id" :po-no="po.po_no" :total="Number(po.total_amount)" :tax-rate="Number(po.tax_rate)" :buyer-company-id="po.buyer_company_id" :expected-delivery-date="po.expected_delivery_date" @close="panel = ''" @created="onPrepayCreated" />
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
.pd-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--line); }
.pd-tabs button { border: 0; border-bottom: 3px solid transparent; background: transparent; min-height: 36px; padding: 0 12px; }
.pd-tabs button.on { border-bottom-color: var(--primary); font-weight: 700; }
.pd-detail { display: grid; gap: 10px; min-width: 0; }
.pd-prepay { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; min-width: 0; }
.pd-prepay h3 { margin: 0; }
.pd-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.pd-stats li { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; display: grid; gap: 2px; background: var(--surface); }
.pd-stats span { font-size: 12px; color: var(--muted); }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
strong.voided { text-decoration: line-through; color: var(--muted); }
.voided-tag { margin-left: 6px; background: #fbeaea; color: #9b1c1c; border-color: #e7b3b3; }
.pd-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pd-events li { border-left: 3px solid var(--line); padding-left: 10px; }
.pd-events p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 700px) { .pd-actions button, .dialog-actions button { min-height: 44px; } }
</style>
