<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { formatDate } from "../../lib/ga-assets";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G09 設備／設施維修紀錄（Q11）：改讀新版「報修類」需求單與其工單，伺服端分頁與精確筆數（舊版只載入前 100 筆再在瀏覽器過濾）。
// 兩個分頁：逐筆紀錄、每台修過幾次。總務看全部；店長只看自己門市，且看不到處理人姓名（由資料庫函式判斷）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const isFacility = computed(() => props.tab.kind === "ga-facility-history");
const noun = computed(() => (isFacility.value ? "設施" : "設備"));
const type = computed(() => (isFacility.value ? "facility" : "equipment"));

const MAIN_STATUS: Record<string, string> = {
  PENDING_INTAKE: "待受理", WAITING_STORE_SUPPLEMENT: "待門市補充", WAITING_GA_REVIEW: "待總務審核", ACCEPTED: "已受理", IN_PROGRESS: "處理中",
  WAITING_STORE_CONFIRMATION: "待門市確認", COMPLETED: "已完成", REJECTED: "已退回", CANCELED: "已取消",
};
const WO_STATUS: Record<string, string> = { UNACCEPTED: "未受理", ACCEPTED: "已受理", PROCESSING: "處理中", COMPLETED: "已完成" };
const CLOSED = new Set(["COMPLETED", "REJECTED", "CANCELED"]);
const tone = (s: string) => (s === "COMPLETED" ? "green" : CLOSED.has(s) ? "slate" : s === "PENDING_INTAKE" || s.startsWith("WAITING") ? "amber" : "blue");

type Rec = {
  id: string; request_no: string; title: string; main_status: string; public_progress: string | null; created_at: string; completed_at: string | null;
  asset_id: string; asset_name: string | null; asset_code: string | null; store_code: string | null; store_name: string | null;
  work_order: { id: string; status: string; progress_stage: string | null; assignee_name?: string | null } | null;
};
type Sum = { asset_id: string; asset_name: string | null; asset_code: string | null; store_code: string | null; store_name: string | null; repair_count: number; open_count: number; last_reported_at: string | null };

const view = ref<"history" | "summary">("history");
const search = ref("");
const debounced = useDebounced(search, 300);
const storeId = ref("");
const status = ref("");
const from = ref("");
const to = ref("");
const assetId = ref("");
const assetLabel = ref("");
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const records = ref<Rec[]>([]);
const summary = ref<Sum[]>([]);
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const showAssignee = ref(false);

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ type: type.value, page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("q", debounced.value.trim());
    if (storeId.value) q.set("storeId", storeId.value);
    if (view.value === "history") {
      if (status.value) q.set("status", status.value);
      if (from.value) q.set("from", from.value);
      if (to.value) q.set("to", to.value);
      if (assetId.value) q.set("assetId", assetId.value);
    }
    const res = await api<{ data: any[]; total: number; permissions: { seeAssignee: boolean } }>(`general-affairs/asset-maintenance/${view.value}?` + q);
    if (!latest.isLatest(n)) return;
    if (view.value === "history") records.value = res.data;
    else summary.value = res.data;
    total.value = res.total;
    showAssignee.value = res.permissions.seeAssignee;
  } catch (e) {
    if (latest.isLatest(n)) {
      records.value = [];
      summary.value = [];
      total.value = 0;
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, storeId, status, from, to, assetId, view], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

function showAssetHistory(s: Sum) {
  assetId.value = s.asset_id;
  assetLabel.value = `${s.asset_name || ""}${s.asset_code ? `（${s.asset_code}）` : ""}`;
  view.value = "history";
}
const storeText = (code: string | null, name: string | null) => [code, name].filter(Boolean).join(" ") || "—";
const emptyText = computed(() => (error.value ? "資料載入失敗" : `目前沒有已連結${noun.value}的維修紀錄。`));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / {{ noun }}管理</p>
      <h1>{{ noun }}維修紀錄</h1>
      <p class="muted">讀取報修類需求單與其工單，不另外建立一套{{ noun }}維修資料。總務看全部門市；門市負責人只看自己門市。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', `${noun}管理`, `${noun}維修紀錄`]">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div class="tabs" role="tablist" :aria-label="`${noun}維修紀錄檢視`">
      <button role="tab" :aria-selected="view === 'history'" :class="{ on: view === 'history' }" @click="view = 'history'">逐筆紀錄</button>
      <button role="tab" :aria-selected="view === 'summary'" :class="{ on: view === 'summary' }" @click="view = 'summary'">每台修過幾次</button>
    </div>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" :placeholder="view === 'history' ? `單號、標題、${noun}名稱或編號（可含逗號、括號）` : `${noun}名稱或編號`" /></label>
      <div class="filter-pick"><AssetSitePicker v-model="storeId" label="門市" /></div>
      <template v-if="view === 'history'">
        <label>狀態
          <select v-model="status" aria-label="狀態">
            <option value="">全部狀態</option><option value="OPEN">未結案</option><option value="CLOSED">已結案</option>
            <option v-for="(label, value) in MAIN_STATUS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>報修日期（起）<input v-model="from" type="date" /></label>
        <label>報修日期（迄）<input v-model="to" type="date" /></label>
      </template>
    </div>
    <p v-if="assetId && view === 'history'" class="chip" role="status">只看：{{ assetLabel || "指定" + noun }}<button type="button" @click="assetId = ''">清除</button></p>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <template v-if="view === 'history'">
      <div class="table-scroll asset-table">
        <table>
          <thead><tr><th>報修單</th><th>{{ noun }}</th><th>門市</th><th>需求單狀態</th><th>工單</th><th v-if="showAssignee">處理人</th><th>報修時間</th></tr></thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td><strong>{{ r.title }}</strong><small class="sub">{{ r.request_no }}</small></td>
              <td>{{ r.asset_name || "—" }}<small class="sub">{{ r.asset_code || "尚無編號" }}</small></td>
              <td>{{ storeText(r.store_code, r.store_name) }}</td>
              <td><span class="tag" :class="'tone-' + tone(r.main_status)">{{ MAIN_STATUS[r.main_status] || r.main_status }}</span></td>
              <td>{{ r.work_order ? (WO_STATUS[r.work_order.status] || r.work_order.status) : "尚未派工" }}<small v-if="r.work_order?.progress_stage" class="sub">{{ r.work_order.progress_stage }}</small></td>
              <td v-if="showAssignee">{{ r.work_order?.assignee_name || "—" }}</td>
              <td>{{ formatDate(r.created_at) }}</td>
            </tr>
            <tr v-if="!records.length && !loading"><td :colspan="showAssignee ? 7 : 6" class="empty">{{ emptyText }}</td></tr>
          </tbody>
        </table>
      </div>
      <ul class="asset-cards" :aria-label="`${noun}維修紀錄清單`">
        <li v-for="r in records" :key="r.id" class="asset-card">
          <div class="card-title"><strong>{{ r.title }}</strong><small>{{ r.request_no }}</small><small>{{ r.asset_name || "—" }}（{{ r.asset_code || "尚無編號" }}）</small><small>{{ storeText(r.store_code, r.store_name) }} · {{ formatDate(r.created_at) }}</small></div>
          <div class="card-tags"><span class="tag" :class="'tone-' + tone(r.main_status)">{{ MAIN_STATUS[r.main_status] || r.main_status }}</span><span class="muted">工單：{{ r.work_order ? (WO_STATUS[r.work_order.status] || r.work_order.status) : "尚未派工" }}</span></div>
          <small v-if="r.work_order?.assignee_name" class="muted">處理人：{{ r.work_order.assignee_name }}</small>
        </li>
        <li v-if="!records.length && !loading" class="empty">{{ emptyText }}</li>
      </ul>
    </template>
    <template v-else>
      <div class="table-scroll asset-table">
        <table>
          <thead><tr><th>{{ noun }}</th><th>門市</th><th>報修次數</th><th>未結案</th><th>最近報修</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="s in summary" :key="s.asset_id">
              <td><strong>{{ s.asset_name || "（已刪除）" }}</strong><small class="sub">{{ s.asset_code || "尚無編號" }}</small></td>
              <td>{{ storeText(s.store_code, s.store_name) }}</td>
              <td>{{ s.repair_count }}</td>
              <td>{{ s.open_count }}</td>
              <td>{{ formatDate(s.last_reported_at) }}</td>
              <td><button type="button" class="row-btn" @click="showAssetHistory(s)">看紀錄</button></td>
            </tr>
            <tr v-if="!summary.length && !loading"><td colspan="6" class="empty">{{ emptyText }}</td></tr>
          </tbody>
        </table>
      </div>
      <ul class="asset-cards" :aria-label="`${noun}報修次數清單`">
        <li v-for="s in summary" :key="s.asset_id" class="asset-card">
          <div class="card-title"><strong>{{ s.asset_name || "（已刪除）" }}</strong><small>{{ s.asset_code || "尚無編號" }}</small><small>{{ storeText(s.store_code, s.store_name) }}</small></div>
          <div class="card-tags"><span class="tag tone-blue">修過 {{ s.repair_count }} 次</span><span class="tag" :class="s.open_count ? 'tone-amber' : 'tone-slate'">未結案 {{ s.open_count }}</span></div>
          <button type="button" class="card-btn" :aria-label="`看 ${s.asset_name || ''} 的維修紀錄`" @click="showAssetHistory(s)">看紀錄</button>
        </li>
        <li v-if="!summary.length && !loading" class="empty">{{ emptyText }}</li>
      </ul>
    </template>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </GaShell>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tabs button { min-height: 40px; }
.tabs button.on { background: var(--soft); border-color: var(--primary); color: var(--primary); font-weight: 700; }
.filter-pick { min-width: 220px; flex: 1; }
.sub { display: block; color: var(--muted); }
.row-btn { min-height: 30px; padding: 3px 12px; font-size: 12px; }
.chip { display: inline-flex; align-items: center; gap: 10px; margin: 0 0 10px; padding: 4px 10px; border-radius: 14px; background: var(--soft); font-size: 13px; }
.chip button { min-height: 28px; padding: 2px 10px; font-size: 12px; }
.tag { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.tone-green { background: var(--soft); color: var(--primary); }
.tone-blue { background: #e4eefc; color: #1f4f9a; border-color: #b8cdee; }
.tone-amber { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
.tone-slate { color: var(--muted); }
:root[data-theme="dark"] .tone-amber { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
:root[data-theme="dark"] .tone-blue { background: #1d2f4d; color: #b8d0f5; border-color: #35507d; }
.asset-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.asset-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 8px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.card-btn { min-height: 44px; width: 100%; font-weight: 600; }
.empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .asset-table { display: none; }
  .asset-cards { display: grid; }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
