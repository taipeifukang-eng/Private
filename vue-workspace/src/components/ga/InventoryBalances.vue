<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import InventoryPicker from "./InventoryPicker.vue";
import { useDebounced, useLatest } from "../../lib/ga";
import { downloadCsv, fmtNum, fmtTime, locationText, partText, type BalanceRowView, type BalanceStats } from "../../lib/ga-inventory-stock";
import { STOCK_LEVEL_LABEL } from "../../../../lib/workspace/general-affairs/inventory-stock-rules";

// G12 餘額表：分頁、含 0 選項、搜尋、位置／料件篩選；低庫存紅黃標與「只看需補貨」（C7）；匯出 CSV（C5，目前篩選條件下的全部資料）；統計卡是資料庫端精確筆數。
const emit = defineEmits<{ perms: [{ canPost: boolean; postProblem: string }] }>();
const rows = ref<BalanceRowView[]>([]);
const total = ref(0);
const stats = ref<BalanceStats>({ rows: 0, nonzero: 0, zero: 0, negative: 0, red: 0, yellow: 0, total_qty: 0, in_use: 0, idle: 0, unclassified: 0 });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const locationId = ref("");
const partId = ref("");
const includeZero = ref(false);
const lowOnly = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const internal = ref(false);
const exporting = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(search.value.trim() || locationId.value || partId.value || includeZero.value || lowOnly.value));

function query(extra: Record<string, string> = {}) {
  const q = new URLSearchParams(extra);
  if (debounced.value.trim()) q.set("search", debounced.value.trim());
  if (locationId.value) q.set("locationId", locationId.value);
  if (partId.value) q.set("partId", partId.value);
  if (includeZero.value) q.set("includeZero", "true");
  if (lowOnly.value) q.set("lowOnly", "true");
  return q;
}
async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: BalanceRowView[]; total: number; stats: BalanceStats; permissions: { internal: boolean; canPost: boolean; postProblem: string } }>(
      "general-affairs/inventory/balances?" + query({ page: String(page.value), pageSize: String(pageSize) }));
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    internal.value = res.permissions.internal;
    emit("perms", { canPost: res.permissions.canPost, postProblem: res.permissions.postProblem });
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, locationId, partId, includeZero, lowOnly], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
defineExpose({ reload: load });

async function exportCsv() {
  exporting.value = true;
  notice.value = "";
  error.value = "";
  const msg = await downloadCsv("general-affairs/inventory/balances/export", query());
  if (msg) error.value = msg;
  else notice.value = "已匯出目前篩選條件下的全部餘額。";
  exporting.value = false;
}
const levelText = (l: "red" | "yellow" | null) => (l ? STOCK_LEVEL_LABEL[l] : "");
</script>

<template>
  <section aria-label="庫存餘額">
    <ul class="stat-cards" aria-label="庫存餘額統計">
      <li><span>有庫存的項目</span><strong data-testid="stat-nonzero">{{ stats.nonzero }}</strong></li>
      <li :class="{ alert: stats.red > 0 }"><span>低於安全庫存</span><strong data-testid="stat-red">{{ stats.red }}</strong></li>
      <li :class="{ warn: stats.yellow > 0 }"><span>低於補貨點</span><strong data-testid="stat-yellow">{{ stats.yellow }}</strong></li>
      <li :class="{ alert: stats.negative > 0 }"><span>負庫存</span><strong data-testid="stat-negative">{{ stats.negative }}</strong></li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="位置、料件名稱、代碼、品牌、型號（可含逗號、括號）" /></label>
      <div class="filter-pick"><InventoryPicker v-model="locationId" kind="locations" label="位置" clearable placeholder="全部位置" /></div>
      <div class="filter-pick"><InventoryPicker v-model="partId" kind="parts" label="料件" clearable placeholder="全部料件" /></div>
    </div>
    <div class="checks-row">
      <label class="check"><input v-model="includeZero" type="checkbox" />含庫存為 0 的項目</label>
      <label class="check"><input v-model="lowOnly" type="checkbox" data-testid="low-only" />只看需補貨（低於補貨點或安全庫存）</label>
      <button type="button" :disabled="exporting || !total" data-testid="export-balances" @click="exportCsv">{{ exporting ? "匯出中…" : "匯出 CSV" }}</button>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="list-meta"><span data-testid="balance-total">共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll bal-table">
      <table>
        <thead><tr><th>位置</th><th>料件</th><th class="num">庫存</th><th>狀態</th><th class="num">安全／補貨點</th><th>最後異動</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="balance-row" :class="{ 'row-red': r.level === 'red', 'row-yellow': r.level === 'yellow' }">
            <td>{{ locationText(r.location, r.store) }}</td>
            <td>{{ partText(r.part) }}</td>
            <td class="num" :class="{ neg: Number(r.quantity_base) < 0 }"><strong>{{ fmtNum(r.quantity_base) }}</strong> {{ r.part?.base_unit }}</td>
            <td><span v-if="r.level" class="level" :class="'lv-' + r.level" :data-level="r.level">{{ levelText(r.level) }}</span><span v-else-if="Number(r.quantity_base) < 0" class="level lv-red">負庫存</span><span v-else class="muted">—</span></td>
            <td class="num">{{ fmtNum(r.safety_stock_qty) }} ／ {{ fmtNum(r.reorder_point_qty) }}</td>
            <td>{{ fmtTime(r.last_transaction_at) }}</td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="6" class="empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的庫存" : loaded ? "目前沒有庫存紀錄" : "" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="bal-cards" aria-label="庫存餘額清單">
      <li v-for="r in rows" :key="r.id" class="bal-card" :class="{ 'row-red': r.level === 'red', 'row-yellow': r.level === 'yellow' }" data-testid="balance-card">
        <div class="card-title"><strong>{{ partText(r.part) }}</strong><small>{{ locationText(r.location, r.store) }}</small></div>
        <p class="card-qty" :class="{ neg: Number(r.quantity_base) < 0 }"><strong>{{ fmtNum(r.quantity_base) }}</strong> {{ r.part?.base_unit }}
          <span v-if="r.level" class="level" :class="'lv-' + r.level" :data-level="r.level">{{ levelText(r.level) }}</span></p>
        <p class="card-line muted">安全 {{ fmtNum(r.safety_stock_qty) }}　補貨點 {{ fmtNum(r.reorder_point_qty) }}　最後異動 {{ fmtTime(r.last_transaction_at) }}</p>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的庫存" : loaded ? "目前沒有庫存紀錄" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </section>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards li.warn { border-color: #ecd391; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 22px; }
.filter-pick { min-width: 220px; flex: 1; }
.checks-row { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 4px 0 10px; }
.check { display: flex; align-items: center; gap: 8px; }
.check input { width: auto; }
.num { text-align: right; white-space: nowrap; }
.neg, .neg strong { color: var(--danger, #b3261e); }
.level { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.lv-red { background: #fde7e5; color: #8c1d18; border-color: #e5a9a5; }
.lv-yellow { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .lv-red { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
:root[data-theme="dark"] .lv-yellow { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.row-red td { background: color-mix(in srgb, #d9534f 8%, transparent); }
.row-yellow td { background: color-mix(in srgb, #e0a800 8%, transparent); }
.bal-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.bal-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.bal-card.row-red { border-color: #d9a3a0; }
.bal-card.row-yellow { border-color: #ecd391; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-qty { margin: 0; font-size: 16px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.card-line { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .bal-table { display: none; }
  .bal-cards { display: grid; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
