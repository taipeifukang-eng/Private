<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Copy, Printer } from "lucide-vue-next";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import UploadPicker from "../UploadPicker.vue";
import InventoryPicker from "./InventoryPicker.vue";
import WorkOrderPrint from "./WorkOrderPrint.vue";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { openGaPage } from "../../lib/ga";
import { useSession } from "../../stores";
import { newKey } from "../../lib/ga-requests";
import type { PreparedFile } from "../../lib/upload";
import {
  EVENT_LABEL, PRIORITY_LABEL, QUICK_PROGRESS, SUPPLEMENT_LABEL, isStaleWo, selectableStages, storeLabel,
  type WoCategory, type WoDetail, type WoPageAbilities,
} from "../../lib/ga-work-orders";
import { WO_STAGES } from "../../../../lib/workspace/general-affairs/work-order-rules";
import { REQUEST_STATUS_LABEL } from "../../../../lib/workspace/general-affairs/request-rules";

// G18／G19 工單詳情（工單中心與跨部門維修頁共用同一套）：下一步引導、基本資料、時間軸、照片區（新舊合併）、用料清單、動作與 A4 列印。
// 可按哪些鈕由伺服端的 abilities（資料庫函式算出）決定，資料庫函式在寫入時還會再驗一次；不能按的鈕會在旁邊用白話說明缺什麼。
const props = defineProps<{ workOrderId: string; pageAbilities: WoPageAbilities | null; categories: WoCategory[]; backLabel?: string }>();
const emit = defineEmits<{ changed: []; close: []; deleted: [] }>();

const session = useSession();
const data = ref<WoDetail | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const stale = ref(false);
const busy = ref(false);

const wo = computed(() => data.value?.work_order || null);
const ab = computed(() => data.value?.abilities || null);
const linked = computed(() => !!wo.value?.ga_service_request_id);
const gaSide = computed(() => !!data.value?.ga_side);
const isReporter = computed(() => !!wo.value?.reported_by && wo.value.reported_by === session.data?.user.id);

async function load(keepNotice = false) {
  loading.value = true;
  error.value = "";
  if (!keepNotice) notice.value = "";
  try {
    const res = await api<{ data: WoDetail }>(`general-affairs/work-orders/${props.workOrderId}`);
    data.value = res.data;
    stale.value = false;
  } catch (e) {
    data.value = null;
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());
watch(() => props.workOrderId, () => void load());

// ---------------------------------------------------------------- 下一步引導
const nextStep = computed(() => {
  const w = wo.value;
  const a = ab.value;
  if (!w || !a) return "";
  if (w.status === "COMPLETED") return `已完成（${w.completion_method_label || "已結案"}）。${a.reopen_note || ""}`;
  if (w.status === "UNACCEPTED") return a.read_only ? "尚未受理，等總務處理。" : "還沒受理。請先「更新進度」，系統會自動受理；不需要處理時，沒有連需求單的單可以直接刪除。";
  if (w.progress_stage === "WAITING_STORE_CONFIRMATION") {
    if (a.can_store_confirm || a.can_report_unresolved) return "處理完成了，請確認問題是否解決：按「確認完成」結案，或按「仍有問題」說明原因。";
    if (a.store_use_request) return "處理完成了，請到「我的追蹤」確認完成或回報問題。";
    return "已送門市確認，等門市回覆（確認完成或回報仍有問題）。";
  }
  if (w.progress_stage === "WAITING_STORE_INFO") {
    if (a.can_reply_supplement) return "總務請您補充資料，請按「回覆補資料」說明。";
    if (a.reply_supplement_use_request) return "總務請門市補資料，請到「我的追蹤」回覆。";
    return "已請門市補資料，等門市回覆後再繼續處理。";
  }
  if (w.progress_stage === "REOPENED") return a.read_only ? "門市反映仍有問題，等總務重新處理。" : "門市反映仍有問題。請重新處理，更新進度後再按「送門市確認」。";
  return a.read_only ? "處理中，進度會顯示在下方時間軸。" : "處理中。隨時「更新進度」；處理完成請按「送門市確認」。";
});

const copied = ref(false);
async function copyNo() {
  if (!wo.value) return;
  try { await navigator.clipboard.writeText(wo.value.wo_no); copied.value = true; setTimeout(() => (copied.value = false), 2000); } catch { notice.value = `工單編號：${wo.value.wo_no}`; }
}
function gotoRequest() { if (wo.value?.ga_service_request_id) openGaPage("ga-requests", undefined, { focusId: wo.value.ga_service_request_id }); }

// ---------------------------------------------------------------- 動作表單
type ActionId = "progress" | "completion" | "force_close" | "supplement" | "issue_part" | "delete" | "category" | "store_confirm" | "unresolved" | "reply_supplement";
const pending = ref<ActionId | "">("");
const formError = ref("");
const form = reactive({ notes: "", stage: "", visibility: "PUBLIC", date: "", assignee: "", method: "", reason: "", suppType: "PHOTO_UNCLEAR", categoryId: "", qty: "", unit: "BASE", reasonShort: "" });
const progressPhotos = ref<PreparedFile[]>([]);
const photosBusy = ref(false);
const locationId = ref("");
const partId = ref("");
const pickedPart = ref<any | null>(null);
let partKey = newKey();
watch([locationId, partId, () => form.qty, () => form.unit, () => form.reasonShort, () => form.notes], () => { partKey = newKey(); });
const TITLES: Record<ActionId, string> = {
  progress: "更新進度", completion: "送門市確認", force_close: "不處理，強制結案", supplement: "請門市補資料", issue_part: "領用料件", delete: "刪除工單",
  category: "更換維修分類", store_confirm: "確認完成", unresolved: "仍有問題", reply_supplement: "回覆補資料",
};
function open(a: ActionId) {
  pending.value = a;
  formError.value = "";
  Object.assign(form, { notes: "", stage: wo.value?.status === "UNACCEPTED" ? "INITIAL_REVIEW" : wo.value?.progress_stage && wo.value.progress_stage !== "WAITING_STORE_CONFIRMATION" ? wo.value.progress_stage : "", visibility: "PUBLIC", date: "", assignee: "", method: "", reason: "", suppType: "PHOTO_UNCLEAR", categoryId: wo.value?.category_id || "", qty: "", unit: "BASE", reasonShort: "" });
  progressPhotos.value = [];
  locationId.value = ""; partId.value = ""; pickedPart.value = null; partKey = newKey();
}
function quick(q: (typeof QUICK_PROGRESS)[number]) { form.stage = q.stage; form.notes = q.note; }
function close() { if (!busy.value) pending.value = ""; }
const expected = () => wo.value?.updated_at;
const base = () => `general-affairs/work-orders/${props.workOrderId}`;

async function afterWrite(msg: string) {
  pending.value = "";
  notice.value = msg;
  await load(true);
  emit("changed");
}
function onError(e: unknown) {
  formError.value = (e as Error).message;
  if (isStaleWo(e)) stale.value = true;
}
async function uploadPhotos(updateId: string | null) {
  if (!progressPhotos.value.length) return;
  const fd = new FormData();
  for (const p of progressPhotos.value) fd.append("files", p.file, p.file.name);
  if (updateId) fd.append("update_id", updateId);
  await api(`${base()}/attachments`, { method: "POST", body: fd });
}

async function submit() {
  if (busy.value || !pending.value || !wo.value) return;
  const a = pending.value;
  const notes = form.notes.trim();
  formError.value = "";
  try {
    busy.value = true;
    if (a === "progress") {
      if (!notes) { formError.value = "請填寫處理說明"; return; }
      const body: Record<string, unknown> = { notes, visibility: form.visibility, expected_updated_at: expected() };
      if (form.stage) body.progress_stage = form.stage;
      if (form.date) body.progress_date = form.date;
      if (form.assignee.trim()) body.assignee_name = form.assignee.trim();
      if (form.method.trim()) body.handling_method = form.method.trim();
      await api(`${base()}/progress`, { method: "POST", body: JSON.stringify(body) });
      let msg = "進度已更新。";
      if (progressPhotos.value.length) {
        const fresh = await api<{ data: WoDetail }>(base());
        const mine = [...fresh.data.timeline].reverse().find((t) => t.kind === "update" && t.text === notes);
        if (mine) { await uploadPhotos(mine.id); msg = "進度與照片都已儲存。"; } else msg = "進度已更新，但照片沒有綁定到這筆進度，請到照片區重新上傳。";
      }
      await afterWrite(msg);
    } else if (a === "completion") {
      await api(`${base()}/request-completion`, { method: "POST", body: JSON.stringify({ notes: notes || undefined, expected_updated_at: expected() }) });
      await afterWrite("已送門市確認。");
    } else if (a === "force_close") {
      if (!notes) { formError.value = "請填寫強制結案的原因（只有總務看得到，門市只會看到「總務已結案」）"; return; }
      await api(`${base()}/force-close`, { method: "POST", body: JSON.stringify({ force_close_reason: notes, expected_updated_at: expected() }) });
      await afterWrite("已強制結案。");
    } else if (a === "supplement") {
      if (!notes) { formError.value = "請說明需要門市補什麼"; return; }
      await api(`${base()}/request-supplement`, { method: "POST", body: JSON.stringify({ supplement_type: form.suppType, supplement_note: notes, expected_updated_at: expected() }) });
      await afterWrite(linked.value ? "已請門市補資料，工單與需求單都進入「待門市補資料」。" : "已請門市補資料。");
    } else if (a === "store_confirm") {
      await api(`${base()}/store-confirm`, { method: "POST", body: JSON.stringify({ note: notes || undefined, expected_updated_at: expected() }) });
      await afterWrite("已確認完成，工單結案。");
    } else if (a === "unresolved") {
      if (!notes) { formError.value = "請說明還有什麼問題"; return; }
      await api(`${base()}/report-unresolved`, { method: "POST", body: JSON.stringify({ reason: notes, expected_updated_at: expected() }) });
      await afterWrite("已回報仍有問題，總務會重新處理。");
    } else if (a === "reply_supplement") {
      if (!notes) { formError.value = "請填寫補充說明"; return; }
      await api(`${base()}/reply-supplement`, { method: "POST", body: JSON.stringify({ note: notes, expected_updated_at: expected() }) });
      await afterWrite("已回覆補資料。");
    } else if (a === "category") {
      await api(`${base()}/category`, { method: "PATCH", body: JSON.stringify({ category_id: form.categoryId || null, expected_updated_at: expected() }) });
      await afterWrite("分類已更新。");
    } else if (a === "delete") {
      await api(`${base()}?expected_updated_at=${encodeURIComponent(String(expected()))}`, { method: "DELETE" });
      pending.value = "";
      emit("deleted");
    } else if (a === "issue_part") {
      const q = Number(form.qty);
      if (!locationId.value) { formError.value = "請選擇領用位置"; return; }
      if (!partId.value) { formError.value = "請選擇料件"; return; }
      if (!Number.isFinite(q) || q <= 0) { formError.value = "數量必須大於 0"; return; }
      await api(`${base()}/issue-part`, { method: "POST", body: JSON.stringify({ location_id: locationId.value, part_id: partId.value, quantity: q, input_unit_type: form.unit, reason: form.reasonShort.trim() || undefined, notes: notes || undefined, idempotency_key: partKey, expected_updated_at: expected() }) });
      partKey = newKey();
      await afterWrite("已領用料件，庫存已扣除，流水記在這張工單。");
    }
  } catch (e) {
    onError(e);
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- 照片上傳（新照片走共用附件）
const picked = ref<PreparedFile[]>([]);
const uploading = ref(false);
const uploadError = ref("");
// 可修改工單者、或回報人本人（未完成前）可以加照片；其他人伺服端會擋。
const canUpload = computed(() => !!wo.value && !!ab.value && (!ab.value.read_only || (wo.value.status !== "COMPLETED" && !!wo.value.reported_by && wo.value.reported_by === session.data?.user.id)));
async function upload() {
  if (!picked.value.length || uploading.value) return;
  uploading.value = true;
  uploadError.value = "";
  try {
    const fd = new FormData();
    for (const p of picked.value) fd.append("files", p.file, p.file.name);
    await api(`${base()}/attachments`, { method: "POST", body: fd });
    picked.value = [];
    notice.value = "照片已上傳。";
    await load(true);
  } catch (e) { uploadError.value = (e as Error).message; } finally { uploading.value = false; }
}

// ---------------------------------------------------------------- 列印
const printOpen = ref(false);
const stageOptions = computed(() => selectableStages(linked.value));
void WO_STAGES;
const timelineText = (t: { kind: string; event_type?: string; text: string | null }) => (t.kind === "event" ? EVENT_LABEL[t.event_type || ""] || t.event_type || "" : "");
const requestStatusText = computed(() => (wo.value?.request_status ? REQUEST_STATUS_LABEL[wo.value.request_status as keyof typeof REQUEST_STATUS_LABEL] || wo.value.request_status : ""));
</script>

<template>
  <section class="wod" data-testid="wo-detail" :aria-busy="loading">
    <p v-if="loading && !data" role="status">載入工單…</p>
    <p v-if="error" class="notice error" role="alert" data-testid="wo-detail-error">{{ error }}</p>
    <template v-if="wo && ab">
      <header class="wod-head">
        <button type="button" class="wod-back" data-testid="wo-back" @click="emit('close')">← {{ backLabel || "回到列表" }}</button>
        <div class="wod-title">
          <h2 data-testid="wo-title">{{ wo.title }}</h2>
          <p class="wod-badges">
            <strong data-testid="wo-no">{{ wo.wo_no }}</strong>
            <button type="button" class="icon-button" :aria-label="'複製工單編號 ' + wo.wo_no" data-testid="wo-copy" @click="copyNo"><Copy :size="14" /></button>
            <span v-if="copied" class="muted" role="status">已複製</span>
            <span class="st" :data-status="wo.status" data-testid="wo-status">{{ wo.status_label }}</span>
            <span v-if="wo.stage_label" class="st soft" data-testid="wo-stage">{{ wo.stage_label }}</span>
            <span v-if="wo.completion_method_label" class="st done" data-testid="wo-completion-method">結案方式：{{ wo.completion_method_label }}</span>
            <span class="st soft">{{ linked ? "需求單轉出" : "舊式回報" }}</span>
          </p>
        </div>
      </header>

      <p v-if="notice" class="notice success" role="status" data-testid="wo-notice">{{ notice }}</p>
      <p v-if="stale" class="notice" role="alert" data-testid="wo-stale">這張工單剛被其他人更新過。<button type="button" data-testid="wo-reload" @click="pending = ''; load()">重新載入最新內容</button></p>
      <p v-if="ab.read_only && ab.read_only_reason" class="notice" role="status" data-testid="wo-readonly">{{ ab.read_only_reason }}</p>
      <p class="wod-next" data-testid="wo-next-step"><strong>下一步</strong>　{{ nextStep }}</p>

      <dl class="wod-grid">
        <div><dt>門市</dt><dd>{{ storeLabel(wo) }}</dd></div>
        <div><dt>回報人</dt><dd>{{ wo.reporter_name || "—" }}　{{ fmtTime(wo.reported_at) }}</dd></div>
        <div><dt>聯絡窗口</dt><dd>{{ [wo.contact_name, wo.contact_phone].filter(Boolean).join(" ") || "—" }}</dd></div>
        <div><dt>優先順序</dt><dd>{{ PRIORITY_LABEL[wo.priority] || wo.priority }}</dd></div>
        <div><dt>問題類型／分類</dt><dd>{{ [wo.issue_type, wo.category_name].filter(Boolean).join(" / ") || "—" }}</dd></div>
        <div v-if="wo.equipment_name || wo.facility_name"><dt>設備／設施</dt><dd>{{ wo.equipment_name || wo.facility_name }}</dd></div>
        <div v-if="linked"><dt>需求單</dt><dd><span data-testid="wo-request-no">{{ wo.request_no }}</span>（{{ requestStatusText }}）<button v-if="gaSide" type="button" data-testid="wo-goto-request" @click="gotoRequest">前往需求單</button></dd></div>
        <div v-if="gaSide"><dt>處理人</dt><dd data-testid="wo-assignee">{{ wo.assignee_name || "—" }}</dd></div>
        <div v-if="gaSide"><dt>處理方式</dt><dd>{{ wo.handling_method || "—" }}</dd></div>
        <div v-if="wo.unresolved_reason"><dt>門市反映的問題</dt><dd>{{ wo.unresolved_reason }}</dd></div>
      </dl>
      <p class="wod-desc">{{ wo.description || "（沒有說明）" }}</p>
      <p v-if="linked && wo.request_public_progress" class="wod-public" data-testid="wo-request-progress">需求單公開進度：{{ wo.request_public_progress }}</p>

      <section class="wod-block" data-testid="wo-actions-block">
        <h3>處理動作</h3>
        <div class="wod-actions">
          <button v-if="ab.can_save_progress" type="button" class="primary" data-testid="act-progress" @click="open('progress')">更新進度</button>
          <button v-if="ab.can_request_completion" type="button" data-testid="act-completion" @click="open('completion')">送門市確認</button>
          <button v-if="ab.can_request_supplement" type="button" data-testid="act-supplement" @click="open('supplement')">補資料</button>
          <button v-if="ab.can_issue_part" type="button" data-testid="act-issue-part" @click="open('issue_part')">領用料件</button>
          <button v-if="ab.can_change_category" type="button" data-testid="act-category" @click="open('category')">更換分類</button>
          <button v-if="ab.can_store_confirm" type="button" class="primary" data-testid="act-store-confirm" @click="open('store_confirm')">確認完成</button>
          <button v-if="ab.can_report_unresolved" type="button" data-testid="act-unresolved" @click="open('unresolved')">仍有問題</button>
          <button v-if="ab.can_reply_supplement" type="button" class="primary" data-testid="act-reply-supplement" @click="open('reply_supplement')">回覆補資料</button>
          <button v-if="ab.can_force_close" type="button" class="danger" data-testid="act-force-close" @click="open('force_close')">不處理，強制結案</button>
          <button v-if="ab.can_delete" type="button" class="danger" data-testid="act-delete" @click="open('delete')">刪除</button>
          <button type="button" data-testid="act-print" @click="printOpen = true"><Printer :size="14" /> 列印工單表單</button>
        </div>
        <ul class="wod-reasons" data-testid="wo-reasons">
          <li v-if="!ab.read_only && !ab.can_save_progress && ab.save_progress_reason" data-testid="reason-progress">不能更新進度：{{ ab.save_progress_reason }}</li>
          <li v-if="!ab.read_only && !ab.can_request_supplement && ab.request_supplement_reason && wo.status !== 'COMPLETED'" data-testid="reason-supplement">不能補資料：{{ ab.request_supplement_reason }}</li>
          <li v-if="!ab.can_issue_part && ab.issue_part_reason && (gaSide || !ab.read_only)" data-testid="reason-issue-part">不能領用料件：{{ ab.issue_part_reason }}</li>
          <li v-if="ab.force_close_missing" data-testid="reason-force-close">不能強制結案：缺少「{{ ab.force_close_missing }}」權限，請洽管理員授權</li>
          <li v-if="!ab.can_delete && ab.delete_reason && (gaSide || !ab.read_only || isReporter)" data-testid="reason-delete">不能刪除：{{ ab.delete_reason }}</li>
        </ul>
      </section>

      <section class="wod-block">
        <h3>照片</h3>
        <ul v-if="data?.photos.length" class="wod-photos" data-testid="wo-photos">
          <li v-for="p in data.photos" :key="p.source + p.id" data-testid="wo-photo">
            <a v-if="p.signed_url" :href="p.signed_url" target="_blank" rel="noopener"><img :src="p.signed_url" :alt="p.file_name" loading="lazy" /></a>
            <span v-else class="wod-nophoto muted">照片暫時無法顯示</span>
            <small>{{ p.file_name }}</small>
            <span v-if="p.legacy" class="st soft" data-testid="photo-legacy">舊版照片</span>
            <span v-else-if="p.label" class="st soft">{{ p.label }}</span>
          </li>
        </ul>
        <p v-else class="muted" data-testid="wo-photos-empty">還沒有照片。</p>
        <div v-if="canUpload" class="wod-upload">
          <UploadPicker v-model="picked" images-only :max="5" label="選擇照片" :disabled="uploading" @error="uploadError = $event" />
          <button v-if="picked.length" type="button" class="primary" :disabled="uploading" data-testid="wo-upload" @click="upload">{{ uploading ? "上傳中…" : `上傳 ${picked.length} 張照片` }}</button>
          <p v-if="uploadError" class="field-error" role="alert" data-testid="wo-upload-error">{{ uploadError }}</p>
        </div>
      </section>

      <section v-if="gaSide" class="wod-block" data-testid="wo-parts-block">
        <h3>用料清單</h3>
        <div v-if="data?.parts.length" class="table-scroll">
          <table data-testid="wo-parts">
            <thead><tr><th>時間</th><th>料件</th><th>位置</th><th>數量</th><th>流水號</th><th>領用人</th></tr></thead>
            <tbody>
              <tr v-for="p in data.parts" :key="p.event_id" data-testid="wo-part-row">
                <td>{{ fmtTime(p.at) }}</td><td>{{ [p.part_code, p.part_name].filter(Boolean).join(" ") }}</td><td>{{ p.location_name }}</td>
                <td>{{ p.quantity }} {{ p.unit }}</td><td>{{ p.transaction_no }}</td><td>{{ p.by_name }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted" data-testid="wo-parts-empty">還沒有領用料件。</p>
      </section>

      <section class="wod-block">
        <h3>處理紀錄</h3>
        <ol class="wod-timeline" data-testid="wo-timeline">
          <li v-for="t in data?.timeline" :key="t.kind + t.id" :class="{ internal: t.visibility === 'INTERNAL' }" data-testid="wo-timeline-item">
            <strong>{{ t.kind === "update" ? t.stage_label || "進度更新" : timelineText(t) }}</strong>
            <span v-if="t.visibility === 'INTERNAL'" class="st soft" data-testid="tl-internal">內部</span>
            <span class="muted">　{{ fmtTime(t.at) }}<template v-if="t.by_name">　{{ t.by_name }}</template></span>
            <p v-if="t.text" class="wod-tl-text">{{ t.text }}</p>
          </li>
          <li v-if="!data?.timeline.length" class="muted">還沒有處理紀錄。</li>
        </ol>
      </section>
    </template>

    <Modal v-if="pending && wo" :title="TITLES[pending]" :busy="busy" @cancel="close">
      <form class="wod-form" novalidate :data-testid="'wo-form-' + pending" @submit.prevent="submit">
        <template v-if="pending === 'progress'">
          <div class="wod-quick" aria-label="快捷動作"><button v-for="q in QUICK_PROGRESS" :key="q.id" type="button" :data-testid="'quick-' + q.id" @click="quick(q)">{{ q.label }}</button></div>
          <label>階段<select v-model="form.stage" data-testid="f-stage"><option value="">（不變）</option><option v-for="s in stageOptions" :key="s.code" :value="s.code">{{ s.label }}</option></select></label>
          <label>處理說明（必填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
          <label>公開範圍<select v-model="form.visibility" data-testid="f-visibility"><option value="PUBLIC">公開（門市看得到）</option><option value="INTERNAL">內部（只有總務看得到）</option></select></label>
          <label>進度日期（選填）<input v-model="form.date" type="date" data-testid="f-date" /></label>
          <label>承辦人（選填，留白＝不修改{{ wo.assignee_name ? "；目前：" + wo.assignee_name : "" }}）<input v-model="form.assignee" maxlength="100" data-testid="f-assignee" /></label>
          <label>處理方式（選填，留白＝不修改{{ wo.handling_method ? "；目前：" + wo.handling_method : "" }}）<input v-model="form.method" maxlength="500" data-testid="f-method" /></label>
          <UploadPicker v-model="progressPhotos" images-only :max="5" label="附進度照片（選填）" :disabled="busy" @busy="photosBusy = $event" />
        </template>
        <template v-else-if="pending === 'completion'">
          <p class="muted">送出後工單進入「處理完成待門市確認」，門市確認後才會結案。</p>
          <label>給門市的說明（選填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <template v-else-if="pending === 'force_close'">
          <p class="muted">這張工單不處理了，直接結案。<strong>原因只有總務看得到</strong>，門市只會看到「總務已結案」。</p>
          <label>原因（必填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <template v-else-if="pending === 'supplement'">
          <p v-if="linked" class="muted">送出後，工單與需求單會同時進入「待門市補資料」，店長在「我的追蹤」回覆。</p>
          <label>要補什麼<select v-model="form.suppType" data-testid="f-supp-type"><option v-for="(l, k) in SUPPLEMENT_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
          <label>說明（必填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <template v-else-if="pending === 'issue_part'">
          <p class="muted">會在同一筆交易扣除庫存，庫存流水記這張工單的編號（{{ wo.wo_no }}）。數量不能超過庫存。</p>
          <InventoryPicker v-model="locationId" kind="locations" label="領用位置" required :disabled="busy" />
          <InventoryPicker v-model="partId" kind="location-parts" label="料件" required :location-id="locationId" :disabled="busy || !locationId" :initial="pickedPart" placeholder="先選位置，再搜尋這個位置設定過的料件" @pick="pickedPart = $event" />
          <label>數量<input v-model="form.qty" inputmode="decimal" aria-label="領用數量" data-testid="f-qty" /></label>
          <label>單位<select v-model="form.unit" data-testid="f-unit"><option value="BASE">基本單位</option><option value="PURCHASE">採購單位</option></select></label>
          <label>領用原因（選填）<input v-model="form.reasonShort" maxlength="200" data-testid="f-part-reason" /></label>
          <label>備註（選填）<textarea v-model="form.notes" rows="2" maxlength="500" /></label>
        </template>
        <template v-else-if="pending === 'category'">
          <label>維修分類<select v-model="form.categoryId" data-testid="f-category"><option value="">（不分類）</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        </template>
        <template v-else-if="pending === 'delete'">
          <p>確定要刪除「{{ wo.title }}」（{{ wo.wo_no }}）嗎？只有尚未受理、也沒連需求單的單可以刪；附件照片只會標記為已刪除。</p>
        </template>
        <template v-else-if="pending === 'store_confirm'">
          <p class="muted">確認問題已解決後，工單會結案。</p>
          <label>補充說明（選填）<textarea v-model="form.notes" rows="2" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <template v-else-if="pending === 'unresolved'">
          <label>還有什麼問題（必填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <template v-else-if="pending === 'reply_supplement'">
          <label>補充說明（必填）<textarea v-model="form.notes" rows="3" maxlength="2000" data-testid="f-notes" /></label>
        </template>
        <p v-if="formError" class="field-error" role="alert" data-testid="wo-form-error">{{ formError }}</p>
        <p v-if="stale" class="notice" role="alert"><button type="button" data-testid="wo-reload-form" @click="pending = ''; load()">重新載入最新內容</button></p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" data-testid="wo-form-cancel" @click="close">取消</button>
          <button type="submit" :class="pending === 'delete' || pending === 'force_close' ? 'danger' : 'primary'" :disabled="busy || photosBusy" data-testid="wo-submit">{{ busy ? "送出中…" : pending === "delete" ? "確定刪除" : pending === "force_close" ? "確定強制結案" : "確定" }}</button>
        </div>
      </form>
    </Modal>
    <WorkOrderPrint v-if="printOpen && wo" :work-order-id="wo.id" :can-internal="!!ab?.can_print_internal" @close="printOpen = false" />
  </section>
</template>

<style scoped>
.wod { display: grid; gap: 12px; min-width: 0; }
.wod-head { display: grid; gap: 8px; }
.wod-back { justify-self: start; display: none; }
.wod-title h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.wod-badges { margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.st.soft { background: transparent; font-weight: 500; }
.st.done { background: #e4f4e6; color: #1f5f2b; border-color: #a9d3af; }
:root[data-theme="dark"] .st.done { background: #1c3a22; color: #b6e3be; border-color: #2f5a39; }
.wod-next { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--soft); overflow-wrap: anywhere; }
.wod-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 16px; margin: 0; }
.wod-grid dt { font-size: 12px; color: var(--muted); }
.wod-grid dd { margin: 0; overflow-wrap: anywhere; }
.wod-desc { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wod-public { margin: 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.wod-block { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 10px; min-width: 0; }
.wod-block h3 { margin: 0; font-size: 15px; }
.wod-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.wod-actions button { display: inline-flex; align-items: center; gap: 4px; }
.danger { color: #8c1d18; border-color: #e5a9a5; }
:root[data-theme="dark"] .danger { color: #f6b8b3; border-color: #7a3531; }
button.danger[type="submit"] { background: #b3261e; color: #fff; border-color: #b3261e; }
.wod-reasons { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; display: grid; gap: 2px; }
.wod-photos { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.wod-photos li { display: grid; gap: 2px; min-width: 0; }
.wod-photos img { width: 100%; height: 100px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
.wod-photos small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.wod-nophoto { display: grid; place-items: center; height: 100px; border: 1px dashed var(--line); border-radius: 6px; font-size: 12px; }
.wod-upload { display: grid; gap: 8px; }
.wod-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.wod-timeline li { border-left: 3px solid var(--line); padding-left: 10px; min-width: 0; }
.wod-timeline li.internal { border-left-color: #c77d00; }
.wod-tl-text { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wod-form { display: grid; gap: 10px; min-width: 0; }
.wod-form label { display: grid; gap: 4px; }
.wod-quick { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 900px) { .wod-back { display: inline-flex; } }
</style>
