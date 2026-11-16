<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import ResourceAttachmentPanel from "./ResourceAttachmentPanel.vue";
import RequestStockIssue from "./RequestStockIssue.vue";
import RequestPurchaseReview from "./RequestPurchaseReview.vue";
import WorkOrderSummary from "./WorkOrderSummary.vue";
import { openGaPage } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { PO_STATUS_LABEL, money, num, storeText, targetText, type CommentView, type EventView, type LinkedOrder, type RequestAbilities, type RequestRow } from "../../lib/ga-requests";
import {
  REJECTION_LABEL, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, RESOURCE_LABEL, ROLE_LABEL, ROUTE_LABEL, SUPPLEMENT_LABEL, acceptConflict, fulfillmentLabel,
} from "../../../../lib/workspace/general-affairs/request-rules";

// 需求單詳情（G15 我的追蹤、G16 需求單工作台共用）：狀態與時間軸、留言（可改刪、標示已編輯／已刪除）、各種動作、關聯採購單與處理單。
// surface：STORE_TRACKING＝門市視角（不顯示內部資料）；GA_WORKBENCH＝總務工作台。可按哪些鈕由伺服端的 abilities 決定，資料庫函式會再驗一次。
const props = defineProps<{ requestId: string; surface: "STORE_TRACKING" | "GA_WORKBENCH" }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const row = ref<RequestRow | null>(null);
const events = ref<EventView[]>([]);
const comments = ref<CommentView[]>([]);
const abilities = ref<RequestAbilities | null>(null);
const orders = ref<LinkedOrder[]>([]);
const fulfillment = ref<any | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const stale = ref(false);

async function load(keepNotice = false) {
  loading.value = true;
  error.value = "";
  if (!keepNotice) notice.value = "";
  try {
    const res = await api<any>(`general-affairs/requests/${props.requestId}?surface=${props.surface}`);
    row.value = res.data;
    events.value = res.events;
    comments.value = res.comments;
    abilities.value = res.abilities;
    orders.value = res.purchase_orders || [];
    fulfillment.value = res.fulfillment || null;
    stale.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

// ---- 動作面板
type ActionId = "accept" | "reject" | "request_supplement" | "update_progress" | "request_store_confirmation" | "assign" | "cancel" | "reopen" | "withdraw" | "submit_supplement" | "confirm_complete" | "report_problem";
const STORE_ACTIONS: ActionId[] = ["submit_supplement", "confirm_complete", "report_problem"];
const pending = ref<ActionId | "">("");
const form = reactive({ route: "", role: "GENERAL_AFFAIRS", assignee_name: "", internal_note: "", rejection_reason: "OUT_OF_SCOPE", supplement_type: "PHOTO_UNCLEAR", note: "" });
const formError = ref("");
const ACTION_TITLE: Record<string, string> = {
  accept: "受理需求", reject: "駁回需求", request_supplement: "請門市補資料", update_progress: "更新處理進度", request_store_confirmation: "送門市確認", assign: "轉派承辦角色",
  cancel: "取消需求單", reopen: "重新開啟", withdraw: "撤回需求", submit_supplement: "補充資料", confirm_complete: "確認完成", report_problem: "回報仍有問題",
};
const formEl = ref<HTMLFormElement | null>(null);
async function openAction(a: ActionId) {
  pending.value = a;
  formError.value = "";
  form.note = ""; form.internal_note = ""; form.assignee_name = "";
  form.route = row.value?.request_type === "REPAIR" ? "REPAIR_DISPATCH" : row.value?.resource_type === "PART" ? "STOCK_ISSUE" : "PURCHASE_REVIEW";
  // 表單展開後捲進可視範圍（手機的對話框裡表單常在畫面下方），並把焦點移到第一個輸入框。
  await nextTick();
  const el = formEl.value;
  if (!el) return;
  el.scrollIntoView({ block: "nearest" });
  el.querySelector<HTMLElement>("select:not([disabled]), input:not([disabled]), textarea:not([disabled])")?.focus();
}
// 工單摘要晚一步載入會把表單往下推，載入完再捲一次（表單已在畫面內時不會動）。
function keepFormInView() {
  formEl.value?.scrollIntoView({ block: "nearest" });
}
const routeOptions = computed(() => Object.keys(ROUTE_LABEL).map((k) => ({ id: k, label: ROUTE_LABEL[k], block: row.value ? acceptConflict(row.value, k) : null })));
const noteLabel = computed(() => (pending.value === "cancel" || pending.value === "reopen" ? "原因（必填）" : pending.value === "withdraw" ? "撤回原因（選填）" : pending.value === "confirm_complete" ? (abilities.value?.confirmIsProxy ? "代門市確認的說明（必填，例如：店長電話確認收到）" : "補充說明（選填）") : "說明（必填）"));

async function submitAction() {
  if (busy.value || !pending.value || !row.value) return;
  const a = pending.value;
  const note = form.note.trim();
  formError.value = "";
  if (["cancel", "reopen", "submit_supplement", "report_problem", "reject", "request_supplement"].includes(a) && !note) { formError.value = "請填寫說明或原因"; return; }
  if (a === "confirm_complete" && abilities.value?.confirmIsProxy && !note) { formError.value = "總務代門市確認必須填寫說明"; return; }
  busy.value = true;
  try {
    if (STORE_ACTIONS.includes(a)) {
      await api(`general-affairs/requests/${props.requestId}/store-actions`, { method: "POST", body: JSON.stringify({ action: a, note: note || undefined, expected_updated_at: row.value.updated_at }) });
    } else {
      const body: Record<string, unknown> = { action: a, expected_updated_at: row.value.updated_at, internal_note: form.internal_note.trim() || undefined };
      if (a === "accept") Object.assign(body, { intake_route: form.route, assignee_role: form.role, assignee_name: form.assignee_name.trim() || undefined });
      else if (a === "reject") Object.assign(body, { rejection_reason: form.rejection_reason, rejection_note: note });
      else if (a === "request_supplement") Object.assign(body, { supplement_type: form.supplement_type, supplement_note: note });
      else if (a === "assign") Object.assign(body, { assignee_role: form.role, assignee_name: form.assignee_name.trim() || undefined });
      else if (a === "cancel" || a === "reopen" || a === "withdraw") body.reason = note || undefined;
      await api(`general-affairs/requests/${props.requestId}`, { method: "PATCH", body: JSON.stringify(body) });
    }
    pending.value = "";
    notice.value = `${ACTION_TITLE[a]}完成。`;
    await load(true);
    emit("changed");
  } catch (e) {
    formError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") stale.value = true;
  } finally {
    busy.value = false;
  }
}

// ---- 留言
const commentBody = ref("");
const commentInternal = ref(false);
const editing = ref<{ id: string; body: string } | null>(null);
const commentError = ref("");
async function addComment() {
  const body = commentBody.value.trim();
  if (!body || busy.value) return;
  busy.value = true;
  commentError.value = "";
  try {
    await api(`general-affairs/requests/${props.requestId}/comments`, { method: "POST", body: JSON.stringify({ body, visibility: commentInternal.value ? "INTERNAL" : "PUBLIC", source_context: props.surface }) });
    commentBody.value = "";
    await load(true);
    emit("changed");
  } catch (e) { commentError.value = (e as Error).message; } finally { busy.value = false; }
}
async function saveEdit() {
  if (!editing.value || busy.value) return;
  busy.value = true;
  commentError.value = "";
  try {
    await api(`general-affairs/requests/${props.requestId}/comments/${editing.value.id}`, { method: "PATCH", body: JSON.stringify({ body: editing.value.body }) });
    editing.value = null;
    await load(true);
  } catch (e) { commentError.value = (e as Error).message; } finally { busy.value = false; }
}
async function removeComment(c: CommentView) {
  if (busy.value || !window.confirm("確定要刪除這則留言？刪除後門市只會看到「此留言已刪除」，總務仍看得到原文。")) return;
  busy.value = true;
  commentError.value = "";
  try {
    await api(`general-affairs/requests/${props.requestId}/comments/${c.id}`, { method: "DELETE" });
    await load(true);
  } catch (e) { commentError.value = (e as Error).message; } finally { busy.value = false; }
}
async function markRead(c: CommentView) {
  try {
    await api(`general-affairs/requests/${props.requestId}/comments/${c.id}/read`, { method: "POST", body: "{}" });
    await load(true);
    emit("changed");
  } catch (e) { commentError.value = (e as Error).message; }
}

// ---- 總務工作台的子流程
const stockOpen = ref(false);
const reviewOpen = ref(false);
function afterSub(msg: string) {
  stockOpen.value = false; reviewOpen.value = false;
  notice.value = msg;
  void load(true);
  emit("changed");
}
function openFulfillment() {
  if (fulfillment.value) openGaPage("ga-part-fulfillments", undefined, { fulfillmentId: fulfillment.value.id });
}
const showActions = computed(() => {
  const a = abilities.value;
  if (!a) return [] as ActionId[];
  const out: ActionId[] = [];
  if (props.surface === "GA_WORKBENCH") {
    if (a.accept) out.push("accept");
    if (a.updateProgress) out.push("update_progress");
    if (a.requestStoreConfirmation) out.push("request_store_confirmation");
    if (a.requestSupplement) out.push("request_supplement");
    if (a.assign) out.push("assign");
    if (a.reject) out.push("reject");
    if (a.cancel) out.push("cancel");
    if (a.reopen) out.push("reopen");
  }
  if (a.withdraw) out.push("withdraw");
  if (a.submitSupplement) out.push("submit_supplement");
  if (a.confirmComplete) out.push("confirm_complete");
  if (a.reportProblem) out.push("report_problem");
  return out;
});
const blockedHint = computed(() => {
  const a = abilities.value;
  const r = row.value;
  if (props.surface !== "GA_WORKBENCH" || !a || !r) return "";
  const out: string[] = [];
  if (!a.cancel && ["PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS"].includes(r.main_status)) out.push("已出庫、已有採購單（含草稿）、調撥單或進行中的工單時不能取消");
  if (!a.reject && ["PENDING_INTAKE", "WAITING_GA_REVIEW", "ACCEPTED"].includes(r.main_status)) out.push("已有進行中的工單或有效單據時不能駁回");
  if (!a.requestSupplement && ["PENDING_INTAKE", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS"].includes(r.main_status)) out.push("已有採購單（含草稿）或已出庫時不能請門市補資料，請改用留言");
  return out.join("；");
});
</script>

<template>
  <Modal :title="row ? `${row.request_no}　${row.title}` : '需求單詳情'" :busy="busy" wide @cancel="emit('close')">
    <div class="rd" data-testid="request-detail">
      <p v-if="loading" role="status">載入中…</p>
      <p v-if="error" class="notice error" role="alert" data-testid="detail-error">{{ error }}</p>
      <p v-if="notice" class="notice success" role="status" data-testid="detail-notice">{{ notice }}</p>
      <template v-if="row && abilities">
        <section class="rd-head">
          <span class="rd-status" :data-status="row.main_status" data-testid="detail-status">{{ REQUEST_STATUS_LABEL[row.main_status] }}</span>
          <span v-if="row.is_overdue_confirm" class="flag" data-testid="detail-overdue">逾期未確認</span>
          <span class="muted">{{ REQUEST_TYPE_LABEL[row.request_type] }}　{{ storeText(row.store) }}　提出 {{ fmtTime(row.created_at) }}{{ row.created_by_name ? "（" + row.created_by_name + "）" : "" }}</span>
        </section>
        <p v-if="row.public_progress" class="rd-progress" data-testid="detail-progress">{{ row.public_progress }}</p>
        <WorkOrderSummary v-if="row.maintenance_request_id" :key="row.maintenance_request_id + row.updated_at" :work-order-id="row.maintenance_request_id" @goto="emit('close')" @loaded="keepFormInView" />
        <dl class="rd-grid">
          <div><dt>標的</dt><dd>{{ (row.resource_type ? RESOURCE_LABEL[row.resource_type] + "：" : "") + (targetText(row) || "—") }}</dd></div>
          <div v-if="row.desired_quantity"><dt>希望數量</dt><dd>{{ num(row.desired_quantity) }} {{ row.desired_unit }}</dd></div>
          <div v-if="row.desired_spec"><dt>規格說明</dt><dd>{{ row.desired_spec }}</dd></div>
          <div v-if="row.contact_name || row.contact_phone"><dt>聯絡</dt><dd>{{ [row.contact_name, row.contact_phone].filter(Boolean).join(" ") }}</dd></div>
          <div v-if="row.intake_route"><dt>處理方式</dt><dd>{{ ROUTE_LABEL[row.intake_route] }}{{ row.assignee_role ? "（" + ROLE_LABEL[row.assignee_role] + (row.assignee_name ? " " + row.assignee_name : "") + "）" : "" }}</dd></div>
          <div v-if="row.rejection_reason"><dt>駁回</dt><dd>{{ REJECTION_LABEL[row.rejection_reason] }}：{{ row.rejection_note }}</dd></div>
          <div v-if="row.supplement_type && row.main_status === 'WAITING_STORE_SUPPLEMENT'"><dt>請補資料</dt><dd>{{ SUPPLEMENT_LABEL[row.supplement_type] }}：{{ row.supplement_note }}</dd></div>
          <div v-if="row.cancel_reason"><dt>取消原因</dt><dd>{{ row.cancel_reason }}</dd></div>
        </dl>
        <p class="rd-desc">{{ row.description }}</p>
        <p v-if="row.impact_description" class="muted">營運影響：{{ row.impact_description }}</p>
        <p v-if="row.temporary_workaround" class="muted">暫時處理：{{ row.temporary_workaround }}</p>
        <p v-if="surface === 'GA_WORKBENCH' && row.internal_note" class="rd-internal" data-testid="detail-internal-note">內部備註（門市看不到）：{{ row.internal_note }}</p>

        <section v-if="surface === 'GA_WORKBENCH' && (orders.length || fulfillment)" class="rd-block" data-testid="linked-orders">
          <h3>採購單與處理單</h3>
          <p v-if="fulfillment" class="rd-line">料件處理單 {{ fulfillment.fulfillment_no || "" }}：<strong>{{ fulfillmentLabel(fulfillment) }}</strong>（已處理 {{ num(fulfillment.fulfilled_quantity) }} / {{ num(fulfillment.requested_quantity) }} {{ fulfillment.unit }}）<button type="button" data-testid="open-fulfillment" @click="openFulfillment">開啟處理單</button></p>
          <ul class="rd-orders">
            <li v-for="o in orders" :key="o.id" data-testid="linked-order">
              <strong>{{ o.po_no }}</strong> <span class="po-status">{{ PO_STATUS_LABEL[o.status] || o.status }}</span>
              已驗入 {{ num(o.received_qty) }} / 訂購 {{ num(o.ordered_qty) }}
              <span v-if="o.vendor_name">　{{ o.vendor_name }}</span><span v-if="o.total_amount !== undefined">　含稅 {{ money(o.total_amount) }}</span>
            </li>
          </ul>
        </section>

        <section class="rd-block">
          <h3>處理動作</h3>
          <div class="rd-actions" data-testid="detail-actions">
            <button v-for="a in showActions" :key="a" type="button" :class="{ primary: ['accept', 'confirm_complete', 'submit_supplement'].includes(a) }" :data-testid="'act-' + a" @click="openAction(a)">{{ a === "confirm_complete" && abilities.confirmIsProxy ? "代門市確認完成" : ACTION_TITLE[a] }}</button>
            <button v-if="surface === 'GA_WORKBENCH' && abilities.stockIssue" type="button" class="primary" data-testid="act-stock-issue" @click="stockOpen = true">庫存出庫</button>
            <button v-if="surface === 'GA_WORKBENCH' && abilities.purchaseReview" type="button" class="primary" data-testid="act-purchase-review" @click="reviewOpen = true">採購評估</button>
            <span v-if="!showActions.length && !abilities.stockIssue && !abilities.purchaseReview" class="muted" data-testid="no-actions">目前沒有可執行的動作。</span>
          </div>
          <p v-if="blockedHint" class="muted" data-testid="blocked-hint">{{ blockedHint }}。</p>
          <form v-if="pending" ref="formEl" class="rd-form" novalidate data-testid="action-form" @submit.prevent="submitAction">
            <h4>{{ ACTION_TITLE[pending] }}</h4>
            <p v-if="pending === 'request_store_confirmation'" class="muted">確認後需求單會進入「待門市確認」。</p>
            <p v-if="pending === 'confirm_complete' && abilities.confirmIsProxy" class="notice" role="status" data-testid="proxy-hint">您不是這間門市的店長，這會記為「總務代門市操作」，必須說明原因。</p>
            <label v-if="pending === 'accept'">後續處理方式
              <select v-model="form.route" data-testid="f-route"><option v-for="o in routeOptions" :key="o.id" :value="o.id" :disabled="!!o.block">{{ o.label }}{{ o.block ? "（不可用）" : "" }}</option></select>
            </label>
            <p v-if="pending === 'accept' && routeOptions.find((o) => o.id === form.route)?.block" class="field-error" role="alert">{{ routeOptions.find((o) => o.id === form.route)?.block }}</p>
            <label v-if="pending === 'accept' || pending === 'assign'">承辦角色
              <select v-model="form.role" data-testid="f-role"><option v-for="(l, k) in ROLE_LABEL" :key="k" :value="k">{{ l }}</option></select>
            </label>
            <label v-if="pending === 'accept' || pending === 'assign'">承辦人（選填）<input v-model="form.assignee_name" maxlength="80" data-testid="f-assignee" /></label>
            <label v-if="pending === 'reject'">駁回原因類型
              <select v-model="form.rejection_reason" data-testid="f-reject-reason"><option v-for="(l, k) in REJECTION_LABEL" :key="k" :value="k">{{ l }}</option></select>
            </label>
            <label v-if="pending === 'request_supplement'">要補什麼
              <select v-model="form.supplement_type" data-testid="f-supplement-type"><option v-for="(l, k) in SUPPLEMENT_LABEL" :key="k" :value="k">{{ l }}</option></select>
            </label>
            <label v-if="!['accept', 'assign', 'update_progress', 'request_store_confirmation'].includes(pending)">{{ noteLabel }}<textarea v-model="form.note" rows="3" maxlength="1000" data-testid="f-note" /></label>
            <label v-if="surface === 'GA_WORKBENCH' && !STORE_ACTIONS.includes(pending as ActionId) && pending !== 'withdraw'">內部備註（門市看不到，選填）<textarea v-model="form.internal_note" rows="2" maxlength="1000" data-testid="f-internal" /></label>
            <p v-if="formError" class="field-error" role="alert" data-testid="action-error">{{ formError }}</p>
            <p v-if="stale" class="notice" role="alert"><button type="button" data-testid="reload-stale" @click="pending = ''; load()">重新載入最新內容</button></p>
            <div class="dialog-actions"><button type="button" :disabled="busy" @click="pending = ''">取消</button><button type="submit" class="primary" :disabled="busy" data-testid="action-submit">{{ busy ? "送出中…" : "確定" }}</button></div>
          </form>
        </section>

        <section class="rd-block">
          <h3>留言</h3>
          <ul class="rd-comments" data-testid="comment-list">
            <li v-for="c in comments" :key="c.id" :class="{ internal: c.visibility === 'INTERNAL', deleted: c.is_deleted }" data-testid="comment">
              <div class="c-head"><strong>{{ c.created_by_name || "—" }}</strong><span class="muted">{{ fmtTime(c.created_at) }}</span>
                <span v-if="c.visibility === 'INTERNAL'" class="flag soft">內部備註</span>
                <span v-if="c.is_edited" class="flag soft" data-testid="comment-edited">已編輯</span>
                <span v-if="c.is_deleted" class="flag soft" data-testid="comment-deleted">已刪除</span>
                <span v-if="c.read_at" class="muted">（{{ c.read_by_name }} 已讀）</span>
              </div>
              <template v-if="editing && editing.id === c.id">
                <textarea v-model="editing.body" rows="3" maxlength="2000" aria-label="編輯留言" data-testid="comment-edit-input" />
                <div class="dialog-actions"><button type="button" @click="editing = null">取消</button><button type="button" class="primary" :disabled="busy" data-testid="comment-edit-save" @click="saveEdit">儲存</button></div>
              </template>
              <template v-else>
                <p class="c-body">{{ c.body }}</p>
                <p v-if="surface === 'GA_WORKBENCH' && c.original_body && (c.is_edited || c.is_deleted)" class="c-original" data-testid="comment-original">原文：{{ c.original_body }}</p>
                <p class="c-tools">
                  <button v-if="c.can_edit" type="button" data-testid="comment-edit" @click="editing = { id: c.id, body: c.body }">編輯</button>
                  <button v-if="c.can_delete" type="button" data-testid="comment-delete" @click="removeComment(c)">刪除</button>
                  <button v-if="surface === 'GA_WORKBENCH' && abilities.internalComment && c.source_context === 'STORE_TRACKING' && !c.read_at && !c.is_deleted" type="button" data-testid="comment-read" @click="markRead(c)">標記已讀</button>
                </p>
              </template>
            </li>
            <li v-if="!comments.length" class="muted">還沒有留言。</li>
          </ul>
          <form v-if="abilities.comment" class="rd-comment-form" novalidate @submit.prevent="addComment">
            <textarea v-model="commentBody" rows="2" maxlength="2000" placeholder="寫下想告訴對方的話" aria-label="新增留言" data-testid="comment-input" />
            <label v-if="surface === 'GA_WORKBENCH' && abilities.internalComment" class="inline"><input v-model="commentInternal" type="checkbox" data-testid="comment-internal" />內部備註（門市看不到）</label>
            <button type="submit" class="primary" :disabled="busy || !commentBody.trim()" data-testid="comment-add">送出留言</button>
          </form>
          <p v-if="commentError" class="field-error" role="alert" data-testid="comment-error">{{ commentError }}</p>
        </section>

        <section class="rd-block">
          <h3>處理紀錄</h3>
          <ol class="rd-timeline" data-testid="timeline">
            <li v-for="e in events" :key="e.id" data-testid="timeline-item" :class="{ proxy: e.proxy_for_store }">
              <strong>{{ e.title }}</strong><span v-if="e.proxy_for_store" class="flag" data-testid="proxy-flag">總務代門市操作</span>
              <span v-if="e.visibility === 'INTERNAL'" class="flag soft">內部</span>
              <span class="muted">　{{ fmtTime(e.created_at) }}　{{ e.created_by_name || "" }}</span>
              <p v-if="e.description" class="t-desc">{{ e.description }}</p>
            </li>
          </ol>
        </section>
        <section class="rd-block">
          <ResourceAttachmentPanel resource-type="SERVICE_REQUEST" :resource-id="row.id" title="需求單附件" :can-upload="abilities.comment" :can-delete="surface === 'GA_WORKBENCH'" />
        </section>
      </template>
      <div class="dialog-actions"><button type="button" data-testid="detail-close" @click="emit('close')">關閉</button></div>
    </div>
    <RequestStockIssue v-if="stockOpen && row" :request="row" @close="stockOpen = false" @done="afterSub('庫存出庫完成。')" />
    <RequestPurchaseReview v-if="reviewOpen && row" :request="row" @close="reviewOpen = false" @done="afterSub('採購評估已儲存。')" />
  </Modal>
</template>

<style scoped>
.rd { display: grid; gap: 12px; min-width: 0; }
.rd-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rd-status { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); }
.rd-progress { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--soft); }
.rd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 16px; margin: 0; }
.rd-grid dt { font-size: 12px; color: var(--muted); }
.rd-grid dd { margin: 0; overflow-wrap: anywhere; }
.rd-desc { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.rd-internal { margin: 0; padding: 8px 12px; border-radius: 8px; background: #fff3d6; color: #5b3d00; }
:root[data-theme="dark"] .rd-internal { background: #4a3d16; color: #f4d98a; }
.rd-block { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 10px; min-width: 0; }
.rd-block h3 { margin: 0; font-size: 15px; }
.rd-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.rd-form { scroll-margin-bottom: 96px; display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.rd-form h4 { margin: 0; }
.rd-form label { display: grid; gap: 4px; }
.rd-orders { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.rd-line { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.po-status { display: inline-block; border-radius: 10px; padding: 0 8px; font-size: 12px; border: 1px solid var(--line); }
.rd-comments, .rd-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rd-comments li { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.rd-comments li.internal { background: #fff8e6; }
:root[data-theme="dark"] .rd-comments li.internal { background: #3a3114; }
.rd-comments li.deleted { opacity: 0.8; }
.c-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.c-body { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.c-original { margin: 0; font-size: 13px; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.c-tools { margin: 4px 0 0; display: flex; gap: 8px; }
.rd-comment-form { display: grid; gap: 8px; }
.inline { display: flex; gap: 6px; align-items: center; }
.rd-timeline li { border-left: 3px solid var(--line); padding-left: 10px; }
.rd-timeline li.proxy { border-left-color: #c77d00; }
.t-desc { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.flag { display: inline-block; margin-left: 6px; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; background: #fde7e5; color: #8c1d18; border: 1px solid #e5a9a5; }
.flag.soft { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .flag { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
:root[data-theme="dark"] .flag.soft { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
</style>
