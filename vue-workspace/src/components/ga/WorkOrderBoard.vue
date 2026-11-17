<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import WorkOrderDetail from "./WorkOrderDetail.vue";
import WorkOrderCreate from "./WorkOrderCreate.vue";
import MaintenanceCategories from "./MaintenanceCategories.vue";
import { useDebounced, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { FOCUS_KEYS, FOCUS_LABEL, storeLabel, type WoCategory, type WoPageAbilities, type WoRow } from "../../lib/ga-work-orders";
import { WO_STATUS_LABELS } from "../../../../lib/workspace/general-affairs/work-order-rules";
import type { WorkTab } from "../../stores";

// G18 工單中心（variant=center）與 G19 跨部門「總務組」維修頁（variant=cross）共用的列表＋詳情：同一套工單元件（Q19、W6）。
// 列表一律伺服端搜尋、分頁、精確筆數；焦點卡數字由資料庫算全部（不是只算已載入的）。窄螢幕改成單欄：點列表進詳情，按「回到列表」返回。
const props = defineProps<{ tab: WorkTab; variant: "center" | "cross" }>();
const isCenter = computed(() => props.variant === "center");

const rows = ref<WoRow[]>([]);
const total = ref(0);
const counts = ref<Record<string, number>>({});
const perms = ref<WoPageAbilities | null>(null);
const stores = ref<Array<{ store_id: string; store_code: string; store_name: string; total: number }>>([]);
const categories = ref<WoCategory[]>([]);
const page = ref(1);
const pageSize = 20;
const q = ref("");
const debounced = useDebounced(q, 300);
// 從首頁或導覽徽章點進來（attention=store_rejected）：直接選「門市退回」焦點卡，與徽章同一個述詞（V9）
const focus = ref((props.tab.payload as { attention?: unknown } | undefined)?.attention === "store_rejected" ? "store_rejected" : "");
const status = ref("");
const storeId = ref("");
const source = ref("");
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const detailId = ref("");
const createOpen = ref(false);
const catOpen = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || focus.value || status.value || storeId.value || source.value));

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) qs.set("q", debounced.value.trim());
    if (focus.value) qs.set("focus", focus.value);
    if (status.value) qs.set("status", status.value);
    if (storeId.value) qs.set("store_id", storeId.value);
    if (source.value) qs.set("source", source.value);
    const res = await api<{ data: WoRow[]; total: number; focus_counts: Record<string, number>; permissions: WoPageAbilities }>("general-affairs/work-orders?" + qs);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    counts.value = res.focus_counts || {};
    perms.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
async function loadStores() {
  try { stores.value = (await api<{ data: typeof stores.value }>("general-affairs/work-orders/summary")).data; } catch { stores.value = []; }
}
async function loadCategories() {
  try { categories.value = (await api<{ data: WoCategory[] }>("general-affairs/maintenance-categories")).data; } catch { categories.value = []; }
}
async function reloadAll() { await Promise.all([load(), loadStores()]); }
watch([debounced, focus, status, storeId, source], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void reloadAll(); void loadCategories(); consumePayload(); });
useRefreshOnActivate(props.tab, () => { void reloadAll(); consumePayload(); });

// 從需求單「前往工單」開啟：payload.workOrderId。
function consumePayload() {
  const id = String((props.tab.payload as { workOrderId?: string } | undefined)?.workOrderId || "");
  if (/^[0-9a-f-]{36}$/i.test(id)) { detailId.value = id; props.tab.payload = {}; }
}
watch(() => props.tab.payload, consumePayload);

function pickCard(key: string) {
  focus.value = focus.value === key || key === "all" ? "" : key;
}
const activeCard = computed(() => focus.value || "all");
const cards = computed(() => [
  { id: "all", label: "全部", n: counts.value.all ?? 0 },
  ...FOCUS_KEYS.map((k) => ({ id: k, label: FOCUS_LABEL[k], n: counts.value[k] ?? 0 })),
]);
function afterDelete() { detailId.value = ""; notice.value = "工單已刪除。"; void reloadAll(); }
function afterCreated(no: string) { createOpen.value = false; notice.value = `已建立工單 ${no}。`; void reloadAll(); }
function closeDetail() { detailId.value = ""; }
const priorityMark = (r: WoRow) => (r.priority === "urgent" ? "緊急" : r.priority === "high" ? "高" : "");
</script>

<template>
  <div class="wob" :class="{ 'has-detail': !!detailId }" :data-variant="variant">
    <section class="wob-list" aria-label="工單列表">
      <p v-if="notice" class="notice success" role="status" data-testid="wob-notice">{{ notice }}</p>
      <p v-if="perms?.readOnly && perms.readOnlyReason" class="notice" role="status" data-testid="wob-readonly">{{ perms.readOnlyReason }}</p>
      <ul v-if="isCenter" class="wob-cards" aria-label="工單焦點">
        <li v-for="c in cards" :key="c.id" :class="{ on: activeCard === c.id }">
          <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ c.n }}</strong></button>
        </li>
      </ul>
      <div class="filter-bar">
        <label class="grow">搜尋<input v-model="q" type="search" placeholder="工單編號、標題、說明、門市（可含逗號、括號）" data-testid="wob-search" /></label>
        <label>門市<select v-model="storeId" data-testid="wob-store"><option value="">全部門市</option><option v-for="s in stores" :key="s.store_id" :value="s.store_id">{{ s.store_code }} {{ s.store_name }}（{{ s.total }}）</option></select></label>
        <label>狀態<select v-model="status" data-testid="wob-status"><option value="">全部狀態</option><option v-for="(l, k) in WO_STATUS_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="isCenter">來源<select v-model="source" data-testid="wob-source"><option value="">全部來源</option><option value="REQUEST">需求單轉出</option><option value="LEGACY">舊式回報</option></select></label>
        <div class="wob-tools">
          <button v-if="!isCenter && perms?.canCreateLegacy" type="button" class="primary" data-testid="wob-create" @click="createOpen = true">新增回報</button>
          <button v-if="!isCenter && perms?.canEditCategories" type="button" data-testid="wob-categories" @click="catOpen = true">維修分類管理</button>
        </div>
      </div>
      <p v-if="error" class="notice error" role="alert" data-testid="wob-error">{{ error }}</p>
      <div class="list-meta"><span data-testid="wob-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>

      <ul class="wob-cardlist" aria-label="工單清單">
        <li v-for="r in rows" :key="r.id" class="wob-card" :class="{ cur: detailId === r.id }" data-testid="wob-card">
          <div class="mc-head"><strong data-testid="wob-card-no">{{ r.wo_no }}</strong><span class="st" :data-status="r.status">{{ r.status_label }}</span><span v-if="priorityMark(r)" class="flag">{{ priorityMark(r) }}</span></div>
          <p class="mc-title">{{ r.title }}</p>
          <p class="mc-line muted">{{ storeLabel(r) }}　{{ r.stage_label || "" }}</p>
          <p v-if="r.completion_method_label" class="mc-line" data-testid="row-completion">結案方式：{{ r.completion_method_label }}</p>
          <p class="mc-line muted">{{ r.source === "REQUEST" ? "需求單 " + (r.request_no || "") : "舊式回報" }}　{{ fmtTime(r.reported_at) }}</p>
          <button type="button" data-testid="wob-open" @click="detailId = r.id">查看與處理</button>
        </li>
        <li v-if="!rows.length && !loading" class="mc-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的工單" : loaded ? "目前沒有工單" : "" }}</li>
      </ul>
      <footer class="pagination">
        <span>第 {{ page }} / {{ pages }} 頁</span>
        <button type="button" :disabled="page <= 1 || loading" data-testid="wob-prev" @click="page--">上一頁</button>
        <button type="button" :disabled="page >= pages || loading" data-testid="wob-next" @click="page++">下一頁</button>
      </footer>
    </section>

    <section class="wob-detail" aria-label="工單詳情">
      <WorkOrderDetail v-if="detailId" :key="detailId" :work-order-id="detailId" :page-abilities="perms" :categories="categories" @changed="reloadAll" @close="closeDetail" @deleted="afterDelete" />
      <p v-else class="muted wob-hint" data-testid="wob-hint">從左邊選一張工單，這裡會顯示詳情與可以做的動作。</p>
    </section>

    <WorkOrderCreate v-if="createOpen" :categories="categories" :all-stores="!!perms?.gaSide" @close="createOpen = false" @created="afterCreated" />
    <MaintenanceCategories v-if="catOpen" @close="catOpen = false; loadCategories()" />
  </div>
</template>

<style scoped>
.wob { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; min-width: 0; }
.wob-list, .wob-detail { min-width: 0; }
.wob-detail { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--surface); position: sticky; top: 8px; max-height: calc(100vh - 24px); overflow: auto; }
.wob-hint { margin: 0; padding: 20px; text-align: center; }
.wob-cards { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.wob-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.wob-cards li.on { border-color: var(--primary); background: var(--soft); }
.wob-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; min-height: 56px; }
.wob-cards span { font-size: 12px; color: var(--muted); }
.wob-cards strong { font-size: 20px; }
.wob-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.flag { display: inline-block; margin-left: 6px; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; background: #fde7e5; color: #8c1d18; border: 1px solid #e5a9a5; }
:root[data-theme="dark"] .flag { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
.wob-cardlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.wob-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.wob-card.cur { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 6%, var(--surface)); }
.mc-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mc-title { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.mc-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.mc-empty { text-align: center; color: var(--muted); padding: 20px; list-style: none; }
.wob-card button { justify-self: start; min-height: 44px; }
@media (max-width: 1100px) {
  .wob { grid-template-columns: minmax(0, 1fr); }
  .wob-detail { position: static; max-height: none; overflow: visible; }
  .wob.has-detail .wob-list { display: none; }
  .wob:not(.has-detail) .wob-detail { display: none; }
}
@media (max-width: 700px) {
  .wob-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
