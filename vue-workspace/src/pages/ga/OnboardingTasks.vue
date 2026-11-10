<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import UploadPicker from "../../components/UploadPicker.vue";
import AssetOnboardingBar from "../../components/ga/AssetOnboardingBar.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { ONBOARDING_LABEL } from "../../lib/ga-assets";
import { useDebounced, useGaGuard, useRefreshOnActivate, useLatest } from "../../lib/ga";
import type { PreparedFile } from "../../lib/upload";
import type { WorkTab } from "../../stores";

// 建檔貼標待辦（店長手機優先）：一台一張卡，先上傳設備／設施照片，再上傳貼標位置照片，之後等總務複核。
// 總務退回時要填原因，設備／設施照片與貼標位置照片兩項都要重新上傳（解讀 (f)）。設備與設施共用同一套流程（解讀 (b)）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Task = {
  asset_type: "EQUIPMENT" | "FACILITY"; id: string; store_code: string; store_name: string; name: string; code: string | null; area: string | null; location_detail: string | null;
  onboarding_status: string; requires_primary_photo: boolean; requires_label_photo: boolean; review_note: string | null;
  photos: { primary: { url: string | null; file_name: string } | null; label: { url: string | null; file_name: string } | null };
};
const TABS = [
  { key: "todo", label: "待我處理", statuses: "NEEDS_EQUIPMENT_PHOTO,NEEDS_LABEL_PHOTO" },
  { key: "review", label: "等總務複核", statuses: "PENDING_GA_REVIEW" },
  { key: "done", label: "已完成", statuses: "COMPLETED" },
] as const;
const view = ref<(typeof TABS)[number]["key"]>("todo");
const type = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const rows = ref<Task[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const picked = reactive<Record<string, PreparedFile[]>>({});
const busyKey = ref("");
const rowError = reactive<Record<string, string>>({});
const key = (t: Task) => `${t.asset_type}:${t.id}`;
const noun = (t: Task) => (t.asset_type === "FACILITY" ? "設施" : "設備");

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize), statuses: TABS.find((t) => t.key === view.value)!.statuses });
    if (type.value) q.set("assetType", type.value);
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: Task[]; total: number }>("general-affairs/onboarding/tasks?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
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
useRefreshOnActivate(props.tab, load);

const purposeOf = (t: Task) => (t.onboarding_status === "NEEDS_EQUIPMENT_PHOTO" ? "PRIMARY_IMAGE" : t.onboarding_status === "NEEDS_LABEL_PHOTO" ? "LABEL_POSITION_IMAGE" : "");
const stepText = (t: Task) => (t.onboarding_status === "NEEDS_EQUIPMENT_PHOTO" ? `第 1 步：拍${noun(t)}照片` : t.onboarding_status === "NEEDS_LABEL_PHOTO" ? "第 2 步：拍貼標位置照片（標籤貼好後拍）" : "");
const returned = (t: Task) => t.onboarding_status === "NEEDS_EQUIPMENT_PHOTO" && !!t.review_note && (t.requires_primary_photo || t.requires_label_photo);

async function upload(t: Task) {
  const k = key(t);
  const files = picked[k] || [];
  const purpose = purposeOf(t);
  if (!files.length || !purpose || busyKey.value) return;
  busyKey.value = k;
  rowError[k] = "";
  notice.value = "";
  try {
    const fd = new FormData();
    fd.set("assetType", t.asset_type);
    fd.set("assetId", t.id);
    fd.set("purpose", purpose);
    fd.set("file", files[0].file);
    await api("general-affairs/onboarding/photo", { method: "POST", body: fd });
    picked[k] = [];
    notice.value = purpose === "PRIMARY_IMAGE" ? `已上傳「${t.name}」的${noun(t)}照片，接著請上傳貼標位置照片` : `已上傳「${t.name}」的貼標位置照片，等總務複核`;
    await load();
  } catch (e) {
    rowError[k] = (e as Error).message;
    // 資料已被改過（例如總務剛複核）就重新載入，畫面才不會停在舊狀態。
    if ((e as { status?: number }).status === 409) await load();
  } finally {
    busyKey.value = "";
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 建檔貼標</p>
      <h1>貼標待辦</h1>
      <p class="muted">新建檔的設備與設施，請先拍照片、貼上 QR 標籤後再拍貼標位置照片，送總務複核。總務退回時，兩張照片都要重拍。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '建檔貼標', '貼標待辦']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="tabs" role="tablist" aria-label="待辦分類">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="view === t.key" :class="{ on: view === t.key }" @click="view = t.key">{{ t.label }}</button>
    </div>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱或編號" /></label>
      <label>類型<select v-model="type"><option value="">設備與設施</option><option value="EQUIPMENT">只看設備</option><option value="FACILITY">只看設施</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="task-list" aria-label="貼標待辦清單">
      <li v-for="t in rows" :key="key(t)" class="task" data-testid="onb-card">
        <div class="task-head">
          <strong>{{ t.name }}</strong>
          <span class="badge">{{ noun(t) }}</span>
        </div>
        <p class="muted line">{{ t.code || "尚無編號" }} · {{ t.store_code }} {{ t.store_name }}<template v-if="t.area || t.location_detail"> · {{ [t.area, t.location_detail].filter(Boolean).join(" / ") }}</template></p>
        <AssetOnboardingBar :status="t.onboarding_status" :type="t.asset_type === 'FACILITY' ? 'facility' : 'equipment'" />
        <p v-if="returned(t)" class="notice error" role="alert">總務退回：{{ t.review_note }}。請重新上傳{{ noun(t) }}照片與貼標位置照片（兩張都要）。</p>
        <div v-if="t.photos.primary || t.photos.label" class="shots">
          <figure v-if="t.photos.primary"><img v-if="t.photos.primary.url" :src="t.photos.primary.url" :alt="`${noun(t)}照片`" /><span v-else class="muted">{{ t.photos.primary.file_name }}</span><figcaption>{{ noun(t) }}照片</figcaption></figure>
          <figure v-if="t.photos.label"><img v-if="t.photos.label.url" :src="t.photos.label.url" alt="貼標位置照片" /><span v-else class="muted">{{ t.photos.label.file_name }}</span><figcaption>貼標位置照片</figcaption></figure>
        </div>
        <template v-if="purposeOf(t)">
          <p class="step"><strong>{{ stepText(t) }}</strong></p>
          <UploadPicker :model-value="picked[key(t)] || []" :max="1" @update:model-value="(v: PreparedFile[]) => (picked[key(t)] = v)" images-only :disabled="busyKey === key(t)" :label="purposeOf(t) === 'PRIMARY_IMAGE' ? `拍攝／選擇${noun(t)}照片` : '拍攝／選擇貼標位置照片'" />
          <p v-if="rowError[key(t)]" class="field-error" role="alert">{{ rowError[key(t)] }}</p>
          <button type="button" class="primary big" :disabled="!(picked[key(t)] || []).length || busyKey === key(t)" @click="upload(t)">{{ busyKey === key(t) ? "上傳中…" : "上傳照片" }}</button>
        </template>
        <p v-else-if="t.onboarding_status === 'PENDING_GA_REVIEW'" class="muted">兩張照片都已上傳，等總務複核。</p>
        <p v-else class="muted">這一筆已完成貼標。</p>
      </li>
      <li v-if="!rows.length && !loading" class="empty">{{ error ? "資料載入失敗" : view === "todo" ? "目前沒有需要你處理的貼標待辦" : "沒有符合的項目" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </GaShell>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tabs button { min-height: 40px; padding: 6px 14px; }
.tabs button.on { background: var(--soft); border-color: var(--primary); color: var(--primary); font-weight: 700; }
.task-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
.task { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.task-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.task-head strong { overflow-wrap: anywhere; }
.badge { flex: none; border: 1px solid var(--line); border-radius: 10px; padding: 0 9px; font-size: 12px; background: var(--soft); }
.line { margin: 0; overflow-wrap: anywhere; font-size: 13px; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.shots figure { margin: 0; display: grid; gap: 4px; }
.shots img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
.shots figcaption { font-size: 12px; color: var(--muted); }
.step { margin: 0; }
.big { min-height: 46px; width: 100%; font-weight: 700; }
.empty { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 24px; }
@media (max-width: 700px) { .task-list { grid-template-columns: 1fr; } }
</style>
