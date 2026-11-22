<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../../components/Modal.vue";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { useDebounced, useGaGuard, useRefreshOnActivate, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// 貼標複核（總務，桌機）：設備／設施照片與貼標位置照片並排，通過或退回。退回必須填原因，且兩張照片都要店長重傳（解讀 (f)）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Item = {
  asset_type: "EQUIPMENT" | "FACILITY"; id: string; store_code: string; store_name: string; name: string; code: string | null; area: string | null; location_detail: string | null;
  updated_at: string; photos: { primary: { url: string | null; file_name: string } | null; label: { url: string | null; file_name: string } | null };
};
const rows = ref<Item[]>([]);
const total = ref(0);
const canReview = ref(false);
const page = ref(1);
const pageSize = 20;
const type = ref("");
const storeId = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const loading = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const noun = (t: Item) => (t.asset_type === "FACILITY" ? "設施" : "設備");
const key = (t: Item) => `${t.asset_type}:${t.id}`;

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (type.value) q.set("assetType", type.value);
    if (storeId.value) q.set("storeId", storeId.value);
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    const res = await api<{ data: Item[]; total: number; permissions: { review: boolean } }>("general-affairs/onboarding/review?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    canReview.value = res.permissions.review;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([type, storeId, debounced], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);
useRefreshOnActivate(props.tab, load);

const zoom = ref<{ url: string; name: string } | null>(null);
const acting = ref<{ item: Item; action: "approve" | "reject" } | null>(null);
const note = ref("");
const actError = ref("");
const busy = ref(false);
function ask(item: Item, action: "approve" | "reject") { acting.value = { item, action }; note.value = ""; actError.value = ""; }
async function confirm() {
  if (!acting.value || busy.value) return;
  const { item, action } = acting.value;
  if (action === "reject" && !note.value.trim()) { actError.value = "退回重拍時必須填寫原因"; return; }
  busy.value = true;
  actError.value = "";
  try {
    await api("general-affairs/onboarding/review", { method: "POST", body: JSON.stringify({ assetType: item.asset_type, assetId: item.id, action, note: note.value.trim() }) });
    notice.value = action === "approve" ? `已通過「${item.name}」的貼標複核` : `已退回「${item.name}」，店長需要重新上傳${noun(item)}照片與貼標位置照片`;
    acting.value = null;
    await load();
  } catch (e) {
    actError.value = (e as Error).message;
    if ((e as { status?: number }).status === 409) await load();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 建檔貼標</p>
      <h1>貼標複核</h1>
      <p class="muted">店長上傳完設備／設施照片與貼標位置照片後，在這裡檢查。退回時兩張照片都要重拍，請寫清楚原因。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '建檔貼標', '貼標複核']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱或編號" /></label>
      <div class="filter-pick"><AssetSitePicker v-model="storeId" label="門市" /></div>
      <label>類型<select v-model="type"><option value="">設備與設施</option><option value="EQUIPMENT">只看設備</option><option value="FACILITY">只看設施</option></select></label>
    </div>
    <div class="list-meta"><span>待複核 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="review-list" aria-label="待複核清單">
      <li v-for="t in rows" :key="key(t)" class="review" data-testid="review-card">
        <div class="meta">
          <strong>{{ t.name }}</strong> <span class="badge">{{ noun(t) }}</span>
          <p class="muted">{{ t.code || "尚無編號" }} · {{ t.store_code }} {{ t.store_name }}<template v-if="t.area || t.location_detail"> · {{ [t.area, t.location_detail].filter(Boolean).join(" / ") }}</template></p>
        </div>
        <div class="shots">
          <figure><button v-if="t.photos.primary?.url" type="button" class="zoom" :aria-label="`放大${noun(t)}照片`" @click="zoom = { url: t.photos.primary.url, name: `${noun(t)}照片` }"><img :src="t.photos.primary.url" :alt="`${noun(t)}照片`" /></button><span v-else class="muted">{{ t.photos.primary ? t.photos.primary.file_name : "沒有照片" }}</span><figcaption>{{ noun(t) }}照片</figcaption></figure>
          <figure><button v-if="t.photos.label?.url" type="button" class="zoom" aria-label="放大貼標位置照片" @click="zoom = { url: t.photos.label.url, name: '貼標位置照片' }"><img :src="t.photos.label.url" alt="貼標位置照片" /></button><span v-else class="muted">{{ t.photos.label ? t.photos.label.file_name : "沒有照片" }}</span><figcaption>貼標位置照片</figcaption></figure>
        </div>
        <div v-if="canReview" class="actions">
          <button type="button" class="primary" @click="ask(t, 'approve')">通過</button>
          <button type="button" class="danger" @click="ask(t, 'reject')">退回重拍</button>
        </div>
      </li>
      <li v-if="!rows.length && !loading" class="empty">{{ error ? "資料載入失敗" : "目前沒有待複核的項目" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="zoom" :title="zoom.name" wide @cancel="zoom = null">
      <img class="zoomed" :src="zoom.url" :alt="zoom.name" />
      <div class="dialog-actions"><button type="button" class="primary" @click="zoom = null">關閉</button></div>
    </Modal>

    <Modal v-if="acting" :title="acting.action === 'approve' ? '通過貼標複核' : '退回重拍'" :busy="busy" @cancel="acting = null">
      <p><strong>{{ acting.item.name }}</strong>（{{ acting.item.code || "尚無編號" }}）</p>
      <p v-if="acting.action === 'reject'" class="muted">退回後，店長需要重新上傳{{ noun(acting.item) }}照片與貼標位置照片（兩張都要），並會看到你寫的原因。</p>
      <label>{{ acting.action === "reject" ? "退回原因（必填）" : "複核說明（選填）" }}<input v-model="note" maxlength="500" :aria-label="acting.action === 'reject' ? '退回原因' : '複核說明'" /></label>
      <p v-if="actError" class="field-error" role="alert">{{ actError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" @click="acting = null">取消</button>
        <button type="button" class="primary" :class="{ danger: acting.action === 'reject' }" :disabled="busy" @click="confirm">{{ busy ? "處理中…" : acting.action === "approve" ? "確認通過" : "確認退回" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.filter-pick { min-width: 220px; flex: 1; }
.review-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.review { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px; display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 2fr) auto; gap: 16px; align-items: center; }
.meta p { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.badge { border: 1px solid var(--line); border-radius: 10px; padding: 0 9px; font-size: 12px; background: var(--soft); }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.shots figure { margin: 0; display: grid; gap: 4px; }
.shots .zoom { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; min-height: 0; }
.shots img { display: block; width: 100%; height: 240px; object-fit: contain; background: var(--soft); border-radius: 6px; border: 1px solid var(--line); }
.zoomed { display: block; max-width: 100%; max-height: 70dvh; margin: 0 auto; object-fit: contain; }
.shots figcaption { font-size: 12px; color: var(--muted); }
.actions { display: grid; gap: 8px; }
.empty { text-align: center; color: var(--muted); padding: 24px; }
@media (max-width: 900px) { .review { grid-template-columns: 1fr; } .actions { grid-template-columns: 1fr 1fr; } .filter-pick { min-width: 0; flex-basis: 100%; } }
</style>
