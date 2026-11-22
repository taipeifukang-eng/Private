<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { FileText, Image as ImageIcon } from "lucide-vue-next";
import { api } from "../../api";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { formatDate, storeLabel, WARRANTY_CLAIM_METHODS, WARRANTY_FILTER_OPTIONS } from "../../lib/ga-assets";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G09 設備／設施保固管理（同一個頁面，依頁籤 kind 區分）：保固狀態、申請保固方式、保固文件（發票、單據、圖片、PDF）。
// 與舊版不同：伺服端分頁與精確筆數（舊版只載入前 100 筆）、保固到期用台北時間（到期日當天結束才算過期）、
// 保固文件一次查完（舊版每一台各送一次請求）、統計卡是整個查詢範圍的精確筆數；設施保固頁同樣可用。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const isFacility = computed(() => props.tab.kind === "ga-facility-warranties");
const noun = computed(() => (isFacility.value ? "設施" : "設備"));
const path = computed(() => (isFacility.value ? "facilities" : "equipment"));
const codeKey = computed(() => (isFacility.value ? "facility_code" : "asset_code"));
type Doc = { id: string; file_name: string; content_type: string; signed_url: string | null };
type Row = Record<string, any> & { id: string; name: string; warranty: { tone: string; label: string; state: string; end_date: string | null }; warranty_documents: Doc[] };

const rows = ref<Row[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const buckets = ref<Record<string, number>>({});
const search = ref("");
const debounced = useDebounced(search, 300);
const storeId = ref("");
const warranty = ref("");
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize), sortBy: "warranty_end_date", sortDir: "asc", withWarrantyDocs: "1", warrantyStats: "1" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (storeId.value) q.set("storeId", storeId.value);
    if (warranty.value) q.set("warranty", warranty.value);
    const res = await api<{ data: Row[]; total: number; stats: { warrantyBuckets?: Record<string, number> } }>(`general-affairs/${path.value}?` + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    buckets.value = res.stats.warrantyBuckets || {};
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      total.value = 0;
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, storeId, warranty], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

const claimLabel = (r: Row) => {
  const v = isFacility.value ? r.specs?.facility_warranty_claim_method : r.specs?.warranty_claim_method;
  return WARRANTY_CLAIM_METHODS.find((m) => m.value === (v || ""))?.label || "未設定";
};
const claimNotes = (r: Row) => String((isFacility.value ? r.specs?.facility_warranty_claim_notes : r.specs?.warranty_claim_notes) || "");
const assetInfo = (r: Row) => [r[codeKey.value], isFacility.value ? r.specs?.facility_brand : r.brand, isFacility.value ? r.specs?.facility_model : r.model].filter(Boolean).join(" / ") || "未填資產資訊";
const kpis = computed(() => [
  { id: "total", label: `${noun.value}總數`, value: Object.values(buckets.value).reduce((a, b) => a + b, 0), hint: "目前查詢範圍內" },
  { id: "active", label: "保固中", value: buckets.value.active ?? 0, hint: "保固日期超過 30 天" },
  { id: "expiring", label: "即將到期", value: buckets.value.expiring ?? 0, hint: "30 天內到期" },
  { id: "expired", label: "已過保", value: buckets.value.expired ?? 0, hint: "保固日期已過" },
]);
const emptyText = computed(() => (error.value ? "資料載入失敗" : "目前沒有符合條件的保固資料。"));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / {{ noun }}管理</p>
      <h1>{{ noun }}保固管理</h1>
      <p class="muted">彙整{{ noun }}主檔的保固狀態、申請保固方式，以及已上傳的發票、單據、圖片與 PDF 文件。保固到期以台北時間計算，到期日當天結束才算過期。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', `${noun}管理`, `${noun}保固管理`]">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <ul class="stat-cards" :aria-label="`${noun}保固統計`">
      <li v-for="k in kpis" :key="k.id"><span>{{ k.label }}</span><strong>{{ k.value }}</strong><small class="muted">{{ k.hint }}</small></li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" :placeholder="`搜尋${noun}、${isFacility ? '設施編號、區域、位置' : '品牌、型號、資產編號、序號'}（可含逗號、括號）`" /></label>
      <div class="filter-pick"><AssetSitePicker v-model="storeId" label="門市" /></div>
      <label>保固狀態<select v-model="warranty"><option v-for="o in WARRANTY_FILTER_OPTIONS" :key="o.value" :value="o.value">{{ o.value ? o.label : "全部保固狀態" }}</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll asset-table">
      <table>
        <thead><tr><th>{{ noun }}</th><th>門市</th><th>分類</th><th>申請保固方式</th><th>文件／單據</th><th>保固到期</th><th>保固狀態</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td><strong>{{ r.name }}</strong><small class="sub">{{ assetInfo(r) }}</small></td>
            <td>{{ storeLabel(r.store) }}</td>
            <td>{{ r.category?.name || "—" }}</td>
            <td>{{ claimLabel(r) }}<small v-if="claimNotes(r)" class="sub">{{ claimNotes(r) }}</small></td>
            <td>
              <span v-if="!r.warranty_documents.length" class="muted">尚無文件</span>
              <span v-else class="docs"><a v-for="d in r.warranty_documents" :key="d.id" :href="d.signed_url || undefined" target="_blank" rel="noreferrer" class="doc"><ImageIcon v-if="d.content_type.startsWith('image/')" :size="14" /><FileText v-else :size="14" />{{ d.file_name }}</a></span>
            </td>
            <td>{{ formatDate(r.warranty.end_date) }}</td>
            <td><span class="tag" :class="'tone-' + r.warranty.tone">{{ r.warranty.label }}</span></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ emptyText }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="asset-cards" :aria-label="`${noun}保固清單`">
      <li v-for="r in rows" :key="r.id" class="asset-card">
        <div class="card-title"><strong>{{ r.name }}</strong><small>{{ assetInfo(r) }}</small><small>{{ storeLabel(r.store) }} · 到期 {{ formatDate(r.warranty.end_date) }}</small></div>
        <div class="card-tags"><span class="tag" :class="'tone-' + r.warranty.tone">{{ r.warranty.label }}</span></div>
        <p class="claim">申請方式：{{ claimLabel(r) }}<template v-if="claimNotes(r)">（{{ claimNotes(r) }}）</template></p>
        <span v-if="!r.warranty_documents.length" class="muted">尚無文件</span>
        <span v-else class="docs"><a v-for="d in r.warranty_documents" :key="d.id" :href="d.signed_url || undefined" target="_blank" rel="noreferrer" class="doc"><ImageIcon v-if="d.content_type.startsWith('image/')" :size="14" /><FileText v-else :size="14" />{{ d.file_name }}</a></span>
      </li>
      <li v-if="!rows.length && !loading" class="empty">{{ emptyText }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 22px; }
.filter-pick { min-width: 220px; flex: 1; }
.sub { display: block; color: var(--muted); }
.docs { display: flex; flex-wrap: wrap; gap: 6px; }
.doc { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: 5px; padding: 2px 8px; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.tone-green { background: var(--soft); color: var(--primary); }
.tone-amber { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
.tone-red { background: #fde3df; color: var(--danger); border-color: #f0b6ae; }
.tone-slate { color: var(--muted); }
:root[data-theme="dark"] .tone-amber { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
:root[data-theme="dark"] .tone-red { background: #4d2420; color: #ffb4a9; border-color: #7a3a33; }
.asset-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.asset-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 8px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.claim { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .asset-table { display: none; }
  .asset-cards { display: grid; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
