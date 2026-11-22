<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import InventoryPicker from "./InventoryPicker.vue";
import { useDebounced, useLatest } from "../../lib/ga";
import { downloadCsv, fmtNum, fmtTime, locationText, partText, type TransactionRowView } from "../../lib/ga-inventory-stock";
import { POST_TYPES, POST_TYPE_LABEL, TRANSACTION_TYPE_LABEL, UNIT_TYPE_LABEL } from "../../../../lib/workspace/general-affairs/inventory-stock-rules";

// G12 流水表：分頁；類型、位置、料件、日期區間、記錄人、原因關鍵字、來源（手動／調撥／調撥退回來源庫存）篩選；顯示記錄人；匯出 CSV（C5）。
// 流水不可修改或刪除；記錯只能再補一筆調整。只憑門市名單身分的唯讀者看不到原因與備註（C12，由伺服端遮蔽）。
const emit = defineEmits<{ perms: [{ canPost: boolean; postProblem: string }] }>();
const rows = ref<TransactionRowView[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const type = ref("");
const locationId = ref("");
const partId = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const creator = ref("");
const reason = ref("");
const source = ref("");
const debCreator = useDebounced(creator, 300);
const debReason = useDebounced(reason, 300);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const internal = ref(false);
const exporting = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(type.value || locationId.value || partId.value || dateFrom.value || dateTo.value || creator.value.trim() || reason.value.trim() || source.value));
const dateOrderError = computed(() => (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value ? "起始日期不可晚於結束日期" : ""));

function query(extra: Record<string, string> = {}) {
  const q = new URLSearchParams(extra);
  if (type.value) q.set("transactionType", type.value);
  if (locationId.value) q.set("locationId", locationId.value);
  if (partId.value) q.set("partId", partId.value);
  if (dateFrom.value) q.set("dateFrom", dateFrom.value);
  if (dateTo.value) q.set("dateTo", dateTo.value);
  if (debCreator.value.trim()) q.set("creator", debCreator.value.trim());
  if (debReason.value.trim() && internal.value) q.set("reason", debReason.value.trim());
  if (source.value) q.set("source", source.value);
  return q;
}
async function load() {
  if (dateOrderError.value) { rows.value = []; total.value = 0; return; }
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: TransactionRowView[]; total: number; permissions: { internal: boolean; canPost: boolean; postProblem: string } }>(
      "general-affairs/inventory/transactions?" + query({ page: String(page.value), pageSize: String(pageSize) }));
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    internal.value = res.permissions.internal;
    emit("perms", { canPost: res.permissions.canPost, postProblem: res.permissions.postProblem });
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([type, locationId, partId, dateFrom, dateTo, debCreator, debReason, source], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
defineExpose({ reload: load });

async function exportCsv() {
  if (dateOrderError.value) return;
  exporting.value = true;
  notice.value = "";
  error.value = "";
  const msg = await downloadCsv("general-affairs/inventory/transactions/export", query());
  if (msg) error.value = msg;
  else notice.value = "已匯出目前篩選條件下的全部流水。";
  exporting.value = false;
}
const typeText = (t: string) => TRANSACTION_TYPE_LABEL[t] || t;
const signed = (n: number) => (Number(n) > 0 ? "+" : "") + fmtNum(n);
</script>

<template>
  <section aria-label="庫存流水">
    <p class="muted">流水是每一次庫存變動的紀錄，不能修改或刪除；記錯了請再補一筆「調增」或「調減」。</p>
    <div class="filter-bar">
      <label>類型<select v-model="type" aria-label="交易類型"><option value="">全部類型</option><option v-for="t in POST_TYPES" :key="t" :value="t">{{ POST_TYPE_LABEL[t] }}</option></select></label>
      <label>來源<select v-model="source" aria-label="來源"><option value="">全部來源</option><option value="manual">手動過帳</option><option value="transfer">調撥</option><option value="return_stock">調撥退回來源庫存</option></select></label>
      <label>起始日期<input v-model="dateFrom" type="date" aria-label="起始日期" /></label>
      <label>結束日期<input v-model="dateTo" type="date" aria-label="結束日期" /></label>
      <label>記錄人<input v-model="creator" type="search" placeholder="姓名" aria-label="記錄人" /></label>
      <label v-if="internal">原因關鍵字<input v-model="reason" type="search" placeholder="例如：盤點" aria-label="原因關鍵字" /></label>
    </div>
    <div class="filter-bar">
      <div class="filter-pick"><InventoryPicker v-model="locationId" kind="locations" label="位置" clearable placeholder="全部位置" /></div>
      <div class="filter-pick"><InventoryPicker v-model="partId" kind="parts" label="料件" clearable placeholder="全部料件" /></div>
      <div class="export-cell"><button type="button" :disabled="exporting || !total || !!dateOrderError" data-testid="export-transactions" @click="exportCsv">{{ exporting ? "匯出中…" : "匯出 CSV" }}</button></div>
    </div>
    <p v-if="dateOrderError" class="field-error" role="alert">{{ dateOrderError }}</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="loaded && !internal" class="notice" role="status" data-testid="masked-note">您目前是唯讀檢視：只會看到自己門市的流水，交易原因與備註不顯示。</p>
    <div class="list-meta"><span data-testid="txn-total">共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll txn-table">
      <table>
        <thead><tr><th>時間</th><th>單號</th><th>類型</th><th>位置</th><th>料件</th><th class="num">異動</th><th class="num">異動前 → 後</th><th>來源</th><th>記錄人</th><th>原因</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="txn-row">
            <td>{{ fmtTime(r.occurred_at) }}</td>
            <td>{{ r.transaction_no }}</td>
            <td><span class="ttype" :class="Number(r.quantity_base) > 0 ? 'in' : 'out'">{{ typeText(r.transaction_type) }}</span></td>
            <td>{{ locationText(r.location, r.location?.store) }}</td>
            <td>{{ partText(r.part) }}</td>
            <td class="num"><strong>{{ signed(r.quantity_base) }}</strong> {{ r.part?.base_unit }}<small v-if="r.input_unit_type === 'PURCHASE'" class="sub">輸入 {{ fmtNum(r.quantity_input) }}（{{ UNIT_TYPE_LABEL[r.input_unit_type] }}）</small></td>
            <td class="num">{{ fmtNum(r.balance_before) }} → {{ fmtNum(r.balance_after) }}</td>
            <td><span :class="{ 'back-tag': r.return_stock }" data-testid="txn-source">{{ r.source_label }}</span></td>
            <td>{{ r.creator_name || "—" }}</td>
            <td>{{ r.reason || "—" }}<small v-if="r.notes" class="sub">{{ r.notes }}</small></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="10" class="empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的流水" : loaded ? "目前沒有流水紀錄" : "" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="txn-cards" aria-label="庫存流水清單">
      <li v-for="r in rows" :key="r.id" class="txn-card" data-testid="txn-card">
        <div class="card-title"><strong>{{ partText(r.part) }}</strong><small>{{ locationText(r.location, r.location?.store) }}</small></div>
        <p class="card-qty"><span class="ttype" :class="Number(r.quantity_base) > 0 ? 'in' : 'out'">{{ typeText(r.transaction_type) }}</span> <strong>{{ signed(r.quantity_base) }}</strong> {{ r.part?.base_unit }}　{{ fmtNum(r.balance_before) }} → {{ fmtNum(r.balance_after) }}</p>
        <p class="card-line muted">{{ fmtTime(r.occurred_at) }}　{{ r.transaction_no }}</p>
        <p class="card-line muted">{{ r.source_label }}　記錄人 {{ r.creator_name || "—" }}</p>
        <p v-if="r.reason" class="card-line">{{ r.reason }}</p>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的流水" : loaded ? "目前沒有流水紀錄" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
  </section>
</template>

<style scoped>
.filter-pick { min-width: 220px; flex: 1; }
.export-cell { align-self: end; }
.num { text-align: right; white-space: nowrap; }
.sub { display: block; color: var(--muted); }
.ttype { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.ttype.in { background: var(--soft); color: var(--primary); }
.ttype.out { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .ttype.out { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.back-tag { font-weight: 600; color: var(--primary); }
.txn-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.txn-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-qty { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.card-line { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .txn-table { display: none; }
  .txn-cards { display: grid; }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
