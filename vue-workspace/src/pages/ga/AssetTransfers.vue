<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../../components/Modal.vue";
import UploadPicker from "../../components/UploadPicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import TransferCreateDialog from "../../components/ga/TransferCreateDialog.vue";
import { assetNoun, formatDateTime, TRANSFER_EVENT_LABEL, TRANSFER_STATUS_LABEL, TRANSFER_STATUS_SHORT, type TransferDetail, type TransferRow } from "../../lib/ga-transfers";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import { checkTotalSize, type PreparedFile } from "../../lib/upload";
import type { WorkTab } from "../../stores";

// Q28 設備／設施轉移單：總務發起 → 轉出門市店長確認交出 → 轉入門市店長確認收到（可拍照）才正式換店；QR 標籤沿用。
// 店長在手機看到「待我處理」一張一卡、大按鈕；總務在桌機看表格、可發起與取消。全程寫入異動紀錄，這裡的時間軸就是該單的歷程。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);

const TABS = [
  { key: "todo", label: "待我處理", query: { mine: "1" } },
  { key: "open", label: "進行中", query: { status: "PENDING_HANDOVER,PENDING_RECEIVE" } },
  { key: "done", label: "已完成", query: { status: "COMPLETED" } },
  { key: "cancelled", label: "已取消", query: { status: "CANCELLED" } },
  { key: "all", label: "全部", query: {} },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const rows = ref<TransferRow[]>([]);
const total = ref(0);
const todoCount = ref(0);
const perms = ref({ create: false, createEquipment: false, createFacility: false, isStoreManager: false });
const view = ref<TabKey>(String(props.tab.payload?.view || "") as TabKey || "open");
const type = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const tabs = computed(() => TABS.filter((t) => t.key !== "todo" || perms.value.isStoreManager));
let firstLoad = true;

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize), ...TABS.find((t) => t.key === view.value)!.query });
    if (type.value) q.set("assetType", type.value);
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: TransferRow[]; total: number; todoCount: number; permissions: typeof perms.value }>("general-affairs/transfers?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    todoCount.value = res.todoCount;
    perms.value = res.permissions;
    // 店長第一次進來：有待辦就直接停在「待我處理」，手機上一眼看到要做的事。
    if (firstLoad) {
      firstLoad = false;
      if (res.permissions.isStoreManager && !props.tab.payload?.view && view.value === "open") view.value = res.todoCount > 0 ? "todo" : "open";
    }
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([view, type, debounced], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

// ------------------------------------------------------------------------------------------ 發起
const creating = ref(false);
function created(info: { transfer_no: string; open_count: number }) {
  creating.value = false;
  notice.value = `已發起轉移單 ${info.transfer_no}，等轉出門市店長確認交出` + (info.open_count ? `（還有 ${info.open_count} 張未結案單，換店後仍屬原門市）` : "");
  view.value = "open";
  load();
}

// ------------------------------------------------------------------------------------------ 詳情與處理
type Mode = "view" | "handover" | "receive" | "cancel";
const current = ref<TransferDetail | null>(null);
const mode = ref<Mode>("view");
const detailBusy = ref(false);
const detailError = ref("");
const note = ref("");
const reason = ref("");
const photos = ref<PreparedFile[]>([]);
const pickerBusy = ref(false);
const actionBusy = ref(false);

let openSeq = 0;
async function open(row: TransferRow, m: Mode = "view") {
  const seq = ++openSeq;
  current.value = { ...row, events: [], photos: [] };
  mode.value = m;
  note.value = "";
  reason.value = "";
  photos.value = [];
  detailError.value = "";
  detailBusy.value = true;
  try {
    const fresh = (await api<{ data: TransferDetail }>(`general-affairs/transfers/${row.id}`)).data;
    // 詳情回來前使用者可能已經送出或關掉視窗：不能讓晚到的回應把視窗又打開。
    if (seq === openSeq && current.value?.id === row.id) current.value = fresh;
  } catch (e) {
    if (seq === openSeq) detailError.value = (e as Error).message;
  } finally {
    if (seq === openSeq) detailBusy.value = false;
  }
}
function close() {
  if (actionBusy.value) return;
  openSeq++;
  current.value = null;
}
const stepPhotos = (t: TransferDetail, step: "HANDOVER" | "RECEIVE") => t.photos.filter((p) => p.step === step);

async function confirmStep() {
  const t = current.value;
  if (!t || actionBusy.value || (mode.value !== "handover" && mode.value !== "receive")) return;
  const total = checkTotalSize(photos.value.map((p) => p.file.size));
  if (!total.ok) { detailError.value = total.message; return; }
  actionBusy.value = true;
  detailError.value = "";
  try {
    const fd = new FormData();
    if (note.value.trim()) fd.set("note", note.value.trim());
    for (const p of photos.value) fd.append("files", p.file);
    await api(`general-affairs/transfers/${t.id}/${mode.value}`, { method: "POST", body: fd });
    notice.value = mode.value === "handover"
      ? `已確認交出「${t.asset_name}」，等 ${t.to_store_name} 店長確認收到`
      : `已確認收到「${t.asset_name}」，這${assetNoun(t.asset_type)}現在屬於 ${t.to_store_name}，原 QR 標籤繼續可用`;
    openSeq++;
    current.value = null;
    await load();
  } catch (e) {
    detailError.value = (e as Error).message;
    // 資料已被別人改過（例如總務剛取消）：重新載入，畫面才不會停在舊狀態。
    if ((e as { status?: number }).status === 409) await load();
  } finally {
    actionBusy.value = false;
  }
}
async function confirmCancel() {
  const t = current.value;
  if (!t || actionBusy.value) return;
  if (!reason.value.trim()) { detailError.value = "請輸入取消原因"; return; }
  actionBusy.value = true;
  detailError.value = "";
  try {
    await api(`general-affairs/transfers/${t.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.value.trim() }) });
    notice.value = `已取消轉移單 ${t.transfer_no}，${assetNoun(t.asset_type)}仍屬於 ${t.from_store_name}`;
    openSeq++;
    current.value = null;
    await load();
  } catch (e) {
    detailError.value = (e as Error).message;
    if ((e as { status?: number }).status === 409) await load();
  } finally {
    actionBusy.value = false;
  }
}
const emptyText = computed(() => (error.value ? "資料載入失敗" : view.value === "todo" ? "目前沒有需要你處理的轉移單" : "沒有符合的轉移單"));
const route = (t: TransferRow) => `${t.from_store_name || "—"} → ${t.to_store_name || "—"}`;
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 設備與設施</p>
      <h1>設備轉移單</h1>
      <p class="muted">設備或設施要換門市，請走轉移單：總務發起 → 轉出門市店長確認交出 → 轉入門市店長確認收到（可拍照）後才正式換店，QR 標籤沿用，全程留紀錄。</p>
    </div>
    <button v-if="perms.create" type="button" class="primary" @click="creating = true">發起轉移單</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '設備與設施', '轉移單']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="tabs" role="tablist" aria-label="轉移單分類">
      <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-selected="view === t.key" :class="{ on: view === t.key }" @click="view = t.key">
        {{ t.label }}<span v-if="t.key === 'todo' && todoCount" class="count" data-testid="todo-count">{{ todoCount }}</span>
      </button>
    </div>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="轉移單號、名稱或編號" aria-label="搜尋轉移單" /></label>
      <label>類型<select v-model="type" aria-label="資產類型"><option value="">設備與設施</option><option value="EQUIPMENT">只看設備</option><option value="FACILITY">只看設施</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-wrap transfer-table">
      <table class="grid-table">
        <caption class="sr-only">轉移單清單</caption>
        <thead><tr><th>轉移單號</th><th>資產</th><th>轉出 → 轉入</th><th>狀態</th><th>發起</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id" data-testid="transfer-row">
            <td>{{ t.transfer_no }}</td>
            <td><strong>{{ t.asset_name }}</strong> <span class="badge">{{ assetNoun(t.asset_type) }}</span><br /><small class="muted">{{ t.asset_code || "尚無編號" }}</small></td>
            <td>{{ route(t) }}</td>
            <td><span class="state" :class="'s-' + t.status">{{ TRANSFER_STATUS_LABEL[t.status] }}</span></td>
            <td>{{ formatDateTime(t.requested_at) }}<br /><small class="muted">{{ t.requested_by_name }}</small></td>
            <td class="ops">
              <button v-if="t.canHandover" type="button" class="primary" @click="open(t, 'handover')">確認交出</button>
              <button v-if="t.canReceive" type="button" class="primary" @click="open(t, 'receive')">確認收到</button>
              <button type="button" @click="open(t)">查看</button>
              <button v-if="t.canCancel" type="button" class="danger" @click="open(t, 'cancel')">取消</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="6" class="empty">{{ emptyText }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="transfer-cards" aria-label="轉移單清單（卡片）">
      <li v-for="t in rows" :key="t.id" class="transfer-card" data-testid="transfer-card">
        <div class="card-head"><strong>{{ t.asset_name }}</strong><span class="badge">{{ assetNoun(t.asset_type) }}</span></div>
        <p class="line muted">{{ t.transfer_no }} · {{ t.asset_code || "尚無編號" }}</p>
        <p class="route">{{ route(t) }}</p>
        <p><span class="state" :class="'s-' + t.status">{{ TRANSFER_STATUS_SHORT[t.status] }}</span> <span class="muted">{{ TRANSFER_STATUS_LABEL[t.status] }}</span></p>
        <p v-if="t.open_request_count && (t.status === 'PENDING_HANDOVER' || t.status === 'PENDING_RECEIVE')" class="notice" role="note">還有 {{ t.open_request_count }} 張未結案單，換店後仍屬原門市。</p>
        <button v-if="t.canHandover" type="button" class="primary big" @click="open(t, 'handover')">確認交出</button>
        <button v-if="t.canReceive" type="button" class="primary big" @click="open(t, 'receive')">確認收到</button>
        <button type="button" class="big" @click="open(t)">查看詳情</button>
        <button v-if="t.canCancel" type="button" class="big danger" @click="open(t, 'cancel')">取消轉移單</button>
      </li>
      <li v-if="!rows.length && !loading" class="empty">{{ emptyText }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <TransferCreateDialog v-if="creating" :can-equipment="perms.createEquipment" :can-facility="perms.createFacility" @close="creating = false" @created="created" />

    <Modal v-if="current" :title="mode === 'handover' ? '確認交出' : mode === 'receive' ? '確認收到' : mode === 'cancel' ? '取消轉移單' : '轉移單詳情'" :busy="actionBusy" @cancel="close">
      <p v-if="detailBusy" class="muted" role="status">載入中…</p>
      <p v-if="detailError" class="notice error" role="alert">{{ detailError }}</p>
      <dl class="info">
        <div><dt>轉移單號</dt><dd>{{ current.transfer_no }}</dd></div>
        <div><dt>狀態</dt><dd>{{ TRANSFER_STATUS_LABEL[current.status] }}</dd></div>
        <div><dt>{{ assetNoun(current.asset_type) }}</dt><dd>{{ current.asset_name }}（{{ current.asset_code || "尚無編號" }}）</dd></div>
        <div><dt>轉出 → 轉入</dt><dd>{{ route(current) }}</dd></div>
        <div class="wide"><dt>轉移原因</dt><dd>{{ current.reason }}<template v-if="current.note">（{{ current.note }}）</template></dd></div>
      </dl>
      <p v-if="current.open_request_count && (current.status === 'PENDING_HANDOVER' || current.status === 'PENDING_RECEIVE')" class="notice" role="note">發起時還有 {{ current.open_request_count }} 張未結案單；換店後這些單子仍屬原門市（{{ current.from_store_name }}）。</p>

      <template v-if="mode === 'handover' || mode === 'receive'">
        <p class="notice" role="note">{{ mode === "handover" ? "確認後，這" + assetNoun(current.asset_type) + "會等 " + current.to_store_name + " 店長確認收到才換店。" : "確認後，這" + assetNoun(current.asset_type) + "會立刻改屬於 " + current.to_store_name + "，QR 標籤沿用。" }}</p>
        <label>備註（選填）<textarea v-model="note" rows="2" maxlength="500" aria-label="備註" /></label>
        <UploadPicker v-model="photos" :max="3" images-only :disabled="actionBusy" label="拍照／選擇照片（最多 3 張）" @busy="(b: boolean) => (pickerBusy = b)" />
        <div class="dialog-actions">
          <button type="button" :disabled="actionBusy" @click="close">返回</button>
          <button type="button" class="primary big" :disabled="actionBusy || pickerBusy" @click="confirmStep">{{ actionBusy ? "處理中…" : mode === "handover" ? "確認交出" : "確認收到" }}</button>
        </div>
      </template>
      <template v-else-if="mode === 'cancel'">
        <p class="notice" role="note">取消後{{ assetNoun(current.asset_type) }}仍屬於 {{ current.from_store_name }}，不會換店。</p>
        <label>取消原因（必填）<input v-model="reason" maxlength="200" aria-label="取消原因" /></label>
        <div class="dialog-actions">
          <button type="button" :disabled="actionBusy" @click="close">返回</button>
          <button type="button" class="danger" :disabled="actionBusy" @click="confirmCancel">{{ actionBusy ? "處理中…" : "確認取消轉移單" }}</button>
        </div>
      </template>
      <template v-else>
        <section class="timeline">
          <h4>歷程</h4>
          <ol v-if="current.events.length" aria-label="轉移歷程">
            <li v-for="e in current.events" :key="e.id" data-testid="transfer-event">
              <strong>{{ TRANSFER_EVENT_LABEL[e.event_type] || e.event_type }}</strong> {{ formatDateTime(e.created_at) }} · {{ e.actor_name || "—" }}
              <template v-if="e.reason">　原因：{{ e.reason }}</template><template v-if="e.note">　備註：{{ e.note }}</template>
            </li>
          </ol>
          <p v-else-if="!detailBusy" class="muted">沒有歷程資料。</p>
          <p v-if="current.status === 'CANCELLED'" class="muted">已取消：{{ current.cancel_reason }}</p>
        </section>
        <section v-for="s in (['HANDOVER', 'RECEIVE'] as const)" :key="s">
          <template v-if="stepPhotos(current, s).length">
            <h4>{{ s === "HANDOVER" ? "交出時的照片" : "收到時的照片" }}</h4>
            <div class="shots">
              <figure v-for="p in stepPhotos(current, s)" :key="p.id"><img v-if="p.url" :src="p.url" :alt="p.file_name" /><span v-else class="muted">{{ p.file_name }}</span></figure>
            </div>
          </template>
        </section>
        <div class="dialog-actions">
          <button v-if="current.canCancel" type="button" class="danger" @click="mode = 'cancel'">取消轉移單</button>
          <button v-if="current.canHandover" type="button" class="primary" @click="mode = 'handover'">確認交出</button>
          <button v-if="current.canReceive" type="button" class="primary" @click="mode = 'receive'">確認收到</button>
          <button type="button" @click="close">關閉</button>
        </div>
      </template>
    </Modal>
  </GaShell>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tabs button { min-height: 44px; padding: 6px 14px; display: inline-flex; align-items: center; gap: 6px; }
.tabs button.on { background: var(--soft); border-color: var(--primary); color: var(--primary); font-weight: 700; }
.count { background: var(--danger); color: #fff; border-radius: 10px; padding: 0 7px; font-size: 12px; font-weight: 700; }
.badge { border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; font-size: 12px; background: var(--soft); }
.state { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.s-PENDING_HANDOVER, .s-PENDING_RECEIVE { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
.s-COMPLETED { background: var(--soft); color: var(--primary); }
.s-CANCELLED { color: var(--muted); }
:root[data-theme="dark"] .s-PENDING_HANDOVER, :root[data-theme="dark"] .s-PENDING_RECEIVE { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.ops { display: flex; gap: 6px; flex-wrap: wrap; }
.ops button { min-height: 32px; padding: 3px 12px; font-size: 13px; }
.transfer-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.transfer-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px; display: grid; gap: 8px; min-width: 0; }
.transfer-card p { margin: 0; }
.card-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.card-head strong { overflow-wrap: anywhere; }
.route { font-weight: 600; overflow-wrap: anywhere; }
.big { min-height: 46px; width: 100%; font-weight: 700; }
.info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; margin: 12px 0; }
.info div { display: grid; gap: 2px; min-width: 0; }
.info .wide { grid-column: 1 / -1; }
.info dt { font-size: 12px; color: var(--muted); }
.info dd { margin: 0; overflow-wrap: anywhere; }
.timeline ol { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; font-size: 14px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.shots figure { margin: 0; }
.shots img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
textarea { width: 100%; }
.empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .transfer-table { display: none; }
  .transfer-cards { display: grid; }
  .info { grid-template-columns: 1fr; }
}
</style>
