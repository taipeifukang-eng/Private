<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import QRCode from "qrcode";
import { Download, FileText, Smartphone, Trash2 } from "lucide-vue-next";
import { api } from "../../api";
import Modal from "../Modal.vue";
import UploadPicker from "../UploadPicker.vue";
import { checkTotalSize, formatBytes, isPreviewableImage, type PreparedFile } from "../../lib/upload";

// G01 附件面板：設備、設施、料件、維修回報、需求單、水電網費帳單共用。
// Q3：照片先縮小再傳、其他檔最大 4MB、刪除只標記（實體檔保留）。HEIC 多數電腦不能預覽，顯示檔名與下載連結。
// 簽名網址短效期：縮圖用列表給的 10 分鐘連結；點「開啟」每次重新簽發 5 分鐘連結。
const props = withDefaults(
  defineProps<{
    resourceType: string;
    resourceId: string;
    purpose?: string;
    title?: string;
    canUpload?: boolean;
    canDelete?: boolean;
    /** 只用於水電帳單：顯示「用手機拍照上傳」（QR code，手機掃描後直接傳到這張帳單）。 */
    phoneUpload?: boolean;
  }>(),
  { purpose: "GENERAL", title: "附件", canUpload: true, canDelete: true, phoneUpload: false },
);
const emit = defineEmits<{ changed: [count: number] }>();
type Attachment = { id: string; file_name: string; content_type: string; size_bytes: number; uploaded_at: string; signed_url: string | null };
const items = ref<Attachment[]>([]);
const loading = ref(false);
const error = ref("");
const notice = ref("");
const picked = ref<PreparedFile[]>([]);
const preparing = ref(false);
const uploading = ref(false);
const deleting = ref<Attachment | null>(null);
const reason = ref("");
const deleteBusy = ref(false);
const deleteError = ref("");

async function load(silent = false) {
  if (!props.resourceId) return;
  if (!silent) loading.value = true;
  if (!silent) error.value = "";
  try {
    const q = new URLSearchParams({ resourceType: props.resourceType, resourceId: props.resourceId, purpose: props.purpose });
    const res = await api<{ data: Attachment[] }>("general-affairs/attachments?" + q);
    items.value = res.data;
    emit("changed", res.data.length);
  } catch (e) {
    if (!silent) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
// ---- 用手機拍照上傳：桌機產生 15 分鐘有效的 QR；對話框開著時每 3 秒重新讀附件，手機傳上來的檔案自動出現 ----
const POLL_MS = 3000;
const phone = ref(false);
const phoneBusy = ref(false);
const phoneError = ref("");
const qrImage = ref("");
const qrUrl = ref("");
const qrExpires = ref(0);
const qrLeft = ref(0);
const baseCount = ref(0);
const phoneAdded = ref(0);
let pollTimer: ReturnType<typeof setInterval> | undefined;
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}
async function openPhone() {
  phone.value = true;
  await newQr();
}
async function newQr() {
  phoneBusy.value = true;
  phoneError.value = "";
  qrImage.value = "";
  stopPoll();
  try {
    const res = await api<{ data: { url: string; expires_at: string } }>(`general-affairs/utility-bills/${props.resourceId}/scan-token`, { method: "POST", body: "{}" });
    qrUrl.value = res.data.url;
    qrExpires.value = new Date(res.data.expires_at).getTime();
    qrImage.value = await QRCode.toDataURL(res.data.url, { width: 280, margin: 2, errorCorrectionLevel: "M" });
    baseCount.value = items.value.length;
    phoneAdded.value = 0;
    tick();
    pollTimer = setInterval(tick, POLL_MS);
  } catch (e) {
    phoneError.value = (e as Error).message;
  } finally {
    phoneBusy.value = false;
  }
}
async function tick() {
  qrLeft.value = Math.max(0, Math.round((qrExpires.value - Date.now()) / 1000));
  await load(true);
  phoneAdded.value = Math.max(0, items.value.length - baseCount.value);
  if (qrLeft.value <= 0) stopPoll(); // QR 過期後不必再輪詢
}
function closePhone() {
  stopPoll();
  // 關閉視窗時把這張帳單還有效的 QR 作廢（失敗不影響關閉）
  if (qrUrl.value) api(`general-affairs/utility-bills/${props.resourceId}/scan-token-revoke`, { method: "POST", body: "{}" }).catch(() => undefined);
  phone.value = false;
  qrImage.value = "";
  qrUrl.value = "";
}
onBeforeUnmount(stopPoll);
const leftText = () => `${Math.floor(qrLeft.value / 60)}:${String(qrLeft.value % 60).padStart(2, "0")}`;

async function upload() {
  if (!picked.value.length || uploading.value) return;
  uploading.value = true;
  error.value = "";
  notice.value = "";
  try {
    const total = checkTotalSize(picked.value.map((p) => p.file.size));
    if (!total.ok) throw new Error(total.message);
    const form = new FormData();
    form.set("resource_type", props.resourceType);
    form.set("resource_id", props.resourceId);
    form.set("purpose", props.purpose);
    for (const p of picked.value) form.append("files", p.file, p.file.name);
    await api("general-affairs/attachments", { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
    notice.value = `已上傳 ${picked.value.length} 個檔案`;
    picked.value = [];
    await load();
  } catch (e) {
    // 全成或全不變：失敗時已選的檔案保留，可直接重試。
    error.value = (e as Error).message;
  } finally {
    uploading.value = false;
  }
}
async function open(a: Attachment) {
  error.value = "";
  try {
    const res = await api<{ url: string }>(`general-affairs/attachments/${a.id}/url`);
    window.open(res.url, "_blank", "noopener");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function askDelete(a: Attachment) {
  deleting.value = a;
  reason.value = "";
  deleteError.value = "";
}
async function confirmDelete() {
  if (!deleting.value) return;
  if (!reason.value.trim()) {
    deleteError.value = "請輸入刪除原因";
    return;
  }
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api(`general-affairs/attachments/${deleting.value.id}`, { method: "DELETE", body: JSON.stringify({ deletion_reason: reason.value.trim() }) });
    deleting.value = null;
    notice.value = "附件已標記刪除（原檔仍保留於儲存空間）";
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
  } finally {
    deleteBusy.value = false;
  }
}
onMounted(() => load());
watch(() => [props.resourceType, props.resourceId, props.purpose], () => load());
</script>

<template>
  <section class="attachment-panel" :aria-label="title">
    <header>
      <h3>{{ title }} <small class="muted">（{{ items.length }}）</small></h3>
    </header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="loading" class="muted" role="status">載入中…</p>
    <p v-else-if="!items.length" class="muted">目前沒有附件。</p>
    <ul v-else class="attachment-grid">
      <li v-for="a in items" :key="a.id">
        <button v-if="isPreviewableImage(a.content_type) && a.signed_url" type="button" class="thumb" :aria-label="'開啟 ' + a.file_name" @click="open(a)">
          <img :src="a.signed_url" :alt="a.file_name" loading="lazy" />
        </button>
        <span v-else class="thumb file"><FileText :size="28" /></span>
        <span class="meta"><strong :title="a.file_name">{{ a.file_name }}</strong><small>{{ formatBytes(a.size_bytes) }}</small></span>
        <span class="row-actions">
          <button type="button" :aria-label="'下載或開啟 ' + a.file_name" @click="open(a)"><Download :size="15" /> 開啟</button>
          <button v-if="canDelete" type="button" class="danger" :aria-label="'刪除 ' + a.file_name" @click="askDelete(a)"><Trash2 :size="15" /></button>
        </span>
      </li>
    </ul>
    <div v-if="canUpload && phoneUpload" class="phone-row">
      <button type="button" data-testid="phone-upload-open" @click="openPhone"><Smartphone :size="16" /> 用手機拍照上傳</button>
    </div>
    <Modal v-if="phone" title="用手機拍照上傳" @cancel="closePhone">
      <p class="muted">用手機相機或掃 QR 的 App 掃描下面的 QR code，在手機上拍照或選照片上傳；上傳後這個畫面會自動出現新檔，不用重新整理。</p>
      <p v-if="phoneBusy" role="status">產生 QR 中…</p>
      <p v-if="phoneError" class="notice error" role="alert" data-testid="phone-error">{{ phoneError }}</p>
      <div v-if="qrImage" class="qr-box">
        <img :src="qrImage" alt="手機上傳 QR code" width="280" height="280" data-testid="phone-qr" />
        <p v-if="qrLeft > 0" data-testid="phone-left">有效時間剩 {{ leftText() }}（一次最多 10 張，只能傳到這張帳單）</p>
        <p v-else class="notice error" role="alert" data-testid="phone-expired">QR 已過期，請重新產生。</p>
        <p v-if="phoneAdded" class="notice success" role="status" data-testid="phone-added">手機已上傳 {{ phoneAdded }} 張，下方附件清單已更新。</p>
        <input :value="qrUrl" readonly class="qr-url" aria-label="上傳網址" data-testid="phone-url" @focus="($event.target as HTMLInputElement).select()" />
      </div>
      <div class="dialog-actions">
        <button type="button" :disabled="phoneBusy" data-testid="phone-renew" @click="newQr">重新產生 QR</button>
        <button type="button" class="primary" data-testid="phone-close" @click="closePhone">完成</button>
      </div>
    </Modal>
    <div v-if="canUpload" class="upload-area">
      <UploadPicker v-model="picked" :disabled="uploading" @busy="preparing = $event" />
      <button v-if="picked.length" type="button" class="primary" :disabled="uploading || preparing" @click="upload">
        {{ uploading ? "上傳中…" : `上傳 ${picked.length} 個檔案` }}
      </button>
    </div>
    <Modal v-if="deleting" title="刪除附件" :busy="deleteBusy" @cancel="deleting = null">
      <p>確定刪除「{{ deleting.file_name }}」？畫面上會不再顯示，但原始檔案仍保留在儲存空間，需要時可請工程師找回。</p>
      <label>刪除原因<input v-model="reason" maxlength="200" aria-label="刪除原因" /></label>
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="deleteBusy" @click="deleting = null">取消</button>
        <button type="button" class="primary" :disabled="deleteBusy" @click="confirmDelete">{{ deleteBusy ? "處理中…" : "確認刪除" }}</button>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.attachment-panel { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); }
.attachment-panel h3 { margin: 0 0 12px; font-size: 14px; }
.attachment-grid { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.attachment-grid li { display: grid; grid-template-columns: 64px 1fr; gap: 4px 12px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
.thumb { width: 64px; height: 64px; padding: 0; border-radius: 6px; overflow: hidden; display: grid; place-items: center; background: var(--soft); color: var(--muted); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb.file { border: 1px solid var(--line); }
.meta { min-width: 0; }
.meta strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.meta small { color: var(--muted); }
.row-actions { grid-column: 1 / -1; display: flex; gap: 8px; }
.row-actions button { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 4px 10px; font-size: 12px; }
.phone-row { margin: 0 0 12px; }
.qr-box { display: grid; justify-items: center; gap: 8px; margin: 12px 0; }
.qr-url { width: 100%; font-size: 12px; }
.upload-area { display: grid; gap: 10px; justify-items: start; }
</style>
