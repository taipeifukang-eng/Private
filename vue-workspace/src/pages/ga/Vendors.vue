<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Printer } from "lucide-vue-next";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import VendorDetail from "../../components/ga/VendorDetail.vue";
import VendorForm from "../../components/ga/VendorForm.vue";
import VendorPrintDialog from "../../components/ga/VendorPrintDialog.vue";
import { useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { VENDOR_TYPE_LABELS, VENDOR_STATUS_LABELS, dateText, describeWarning, errorText, statusLabel, type TreeRow, type VendorAbilities, type VendorDetailData, type VendorRow, type VendorStats, type VendorWarning } from "../../lib/ga-vendors";
import type { WorkTab } from "../../stores";

// G21 廠商資料：列表（伺服端搜尋與分頁、精確筆數）、統計卡、篩選（狀態、類型、分類、區域、合約即將到期）、詳情、新增與編輯、停用／啟用、廠商填寫表列印。
// 統編與帳務欄位只有廠商檢視／管理權限者看得到（伺服端遮蔽）；沒有權限的人進不了這一頁。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const rows = ref<VendorRow[]>([]);
const total = ref(0);
const stats = ref<VendorStats>({ total: 0, active: 0, paused: 0, inactive: 0, contract_due: 0 });
const abilities = ref<VendorAbilities | null>(null);
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const vendorType = ref("");
const categoryId = ref("");
const regionId = ref("");
const contractDue = ref(!!(props.tab.payload as any)?.contract_due);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const latest = useLatest();
const categories = ref<TreeRow[]>([]);
const regions = ref<TreeRow[]>([]);
const detailId = ref("");
const editing = ref<VendorDetailData | null>(null);
const creating = ref(false);
const printing = ref(false);
const saved = ref<{ name: string; warnings: VendorWarning[] } | null>(null);
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canManage = computed(() => !!abilities.value?.canManage);
const billing = computed(() => !!abilities.value?.billingVisible);
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || vendorType.value || categoryId.value || regionId.value || contractDue.value));
const catName = (id: string) => categories.value.find((c) => c.id === id)?.name || "";

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (vendorType.value) q.set("vendorType", vendorType.value);
    if (categoryId.value) q.set("categoryId", categoryId.value);
    if (regionId.value) q.set("regionId", regionId.value);
    if (contractDue.value) q.set("contract_due", "1");
    const res = await api<{ data: VendorRow[]; total: number; stats: VendorStats; permissions: VendorAbilities }>("general-affairs/vendors?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    abilities.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
async function loadOptions() {
  if (!allowed.value) return;
  try {
    const [c, r] = await Promise.all([api<{ data: TreeRow[] }>("general-affairs/service-categories?options=1"), api<{ data: TreeRow[] }>("general-affairs/service-regions?options=1")]);
    categories.value = c.data;
    regions.value = r.data;
  } catch (e) {
    // 下拉載入失敗不擋列表，但要讓人知道篩選與表單的選項不完整。
    error.value = "服務分類或區域載入失敗：" + errorText(e);
  }
}
watch([debounced, status, vendorType, categoryId, regionId, contractDue], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void load(); void loadOptions(); });
useRefreshOnActivate(props.tab, () => { void load(); void loadOptions(); });

const cardDefs = [
  { id: "all", label: "全部" }, { id: "active", label: "合作中" }, { id: "paused", label: "暫停" }, { id: "inactive", label: "停用" }, { id: "contract_due", label: "合約即將到期" },
];
const countOf = (id: string) => (id === "all" ? stats.value.total : (stats.value as any)[id] ?? 0);
const activeCard = computed(() => (contractDue.value ? "contract_due" : status.value || "all"));
function pickCard(id: string) {
  const same = activeCard.value === id;
  status.value = "";
  contractDue.value = false;
  if (same || id === "all") return;
  if (id === "contract_due") contractDue.value = true;
  else status.value = id;
}
function clearFilters() { search.value = ""; status.value = ""; vendorType.value = ""; categoryId.value = ""; regionId.value = ""; contractDue.value = false; }

async function startEdit(d: VendorDetailData) {
  // 編輯用最新資料（詳情剛載入，直接帶進表單；版本號在 updated_at）。
  detailId.value = "";
  editing.value = d;
}
async function openNew() { await loadOptions(); creating.value = true; }
async function onSaved(d: VendorDetailData, warnings: VendorWarning[]) {
  creating.value = false;
  editing.value = null;
  saved.value = { name: d.name, warnings };
  await load();
}
const similarText = (w: VendorWarning) => describeWarning(w) + (w.vendors?.length ? "：" + w.vendors.map((v) => v.name).join("、") : "");
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 合作廠商</p>
      <h1>廠商資料</h1>
      <p class="muted">維護合作廠商的基本資料、服務範圍、聯絡人與合作帳務。統一編號與帳務欄位只有你這類有廠商權限的人看得到。廠商不能刪除，不合作請改為停用。</p>
    </div>
    <div class="head-actions">
      <button type="button" data-testid="open-print" @click="printing = true"><Printer :size="14" /> 廠商填寫表</button>
      <button v-if="canManage" type="button" class="primary" data-testid="new-vendor" @click="openNew">新增廠商</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '合作廠商', '廠商資料']">
    <p v-if="saved" class="notice success" role="status" data-testid="vendor-saved">已儲存「{{ saved.name }}」。</p>
    <p v-for="(w, i) in saved?.warnings || []" :key="i" class="notice" role="status" data-testid="vendor-warning">{{ similarText(w) }}</p>
    <ul class="stat-cards" aria-label="廠商統計">
      <li v-for="c in cardDefs" :key="c.id" :class="{ on: activeCard === c.id, alert: c.id === 'contract_due' && countOf(c.id) > 0 }">
        <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ countOf(c.id) }}</strong></button>
      </li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱、別名、聯絡人、電話、Email、標籤、統編" data-testid="vendor-search" /></label>
      <label>狀態<select v-model="status" data-testid="filter-status"><option value="">全部</option><option v-for="(l, k) in VENDOR_STATUS_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
      <label>類型<select v-model="vendorType" data-testid="filter-type"><option value="">全部</option><option v-for="(l, k) in VENDOR_TYPE_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
      <label>服務分類<select v-model="categoryId" data-testid="filter-category"><option value="">全部</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}{{ c.status !== "active" ? "（停用）" : "" }}</option></select></label>
      <label>服務區域<select v-model="regionId" data-testid="filter-region"><option value="">全部</option><option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}{{ r.status !== "active" ? "（停用）" : "" }}</option></select></label>
    </div>
    <p v-if="contractDue" class="notice" role="status" data-testid="due-filter">目前只列「需簽合約、合作中、30 天內到期或已過期」的廠商。<button type="button" @click="contractDue = false">取消篩選</button></p>
    <p v-if="error" class="notice error" role="alert" data-testid="vendor-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <div class="list-meta"><span data-testid="vendor-total">共 {{ total }} 家</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="vendor-list" aria-label="廠商清單">
      <li v-for="r in rows" :key="r.id" class="vendor-card" :class="{ due: r.contract_due }" data-testid="vendor-card">
        <div class="card-head"><strong data-testid="vendor-name">{{ r.name }}</strong><span class="st" :data-status="r.status" data-testid="vendor-status">{{ statusLabel(r.status) }}</span></div>
        <p v-if="r.alias" class="card-line muted">{{ r.alias }}</p>
        <p class="card-line">{{ (VENDOR_TYPE_LABELS as any)[r.vendor_type] || r.vendor_type }}<template v-if="billing && r.tax_id">　統編 {{ r.tax_id }}</template></p>
        <p class="card-line muted">{{ r.contact_name || "（未填聯絡人）" }}　{{ r.contact_phone || r.phone || "" }}</p>
        <p v-if="r.service_category_ids.length" class="card-line muted">{{ r.service_category_ids.slice(0, 3).map(catName).filter(Boolean).join("、") }}<template v-if="r.service_category_ids.length > 3">等 {{ r.service_category_ids.length }} 類</template></p>
        <p v-if="r.contract_due" class="due-tag" data-testid="vendor-due">合約到期日 {{ dateText(r.contract_end_date) }}（30 天內到期或已過期）</p>
        <button type="button" data-testid="open-detail" @click="detailId = r.id">查看詳情</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的廠商" : loaded ? "目前還沒有廠商資料" : "" }}<button v-if="hasFilter" type="button" @click="clearFilters">清除篩選</button></li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <VendorDetail v-if="detailId" :id="detailId" :can-manage="canManage" @close="detailId = ''" @edit="startEdit" @changed="load" />
    <VendorForm v-if="creating" :vendor="null" :categories="categories" :regions="regions" :billing="billing" @close="creating = false" @saved="onSaved" />
    <VendorForm v-if="editing" :key="editing.id + editing.updated_at" :vendor="editing" :categories="categories" :regions="regions" :billing="billing" @close="editing = null" @saved="onSaved" />
    <VendorPrintDialog v-if="printing" @close="printing = false" />
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 12px; min-height: 60px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.vendor-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.vendor-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; align-content: start; }
.vendor-card.due { border-color: #d9a3a0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.due-tag { margin: 0; color: #b3261e; font-weight: 600; font-size: 13px; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
@media (max-width: 700px) {
  .vendor-card button, .head-actions button { min-height: 44px; }
  .vendor-list { grid-template-columns: minmax(0, 1fr); }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
