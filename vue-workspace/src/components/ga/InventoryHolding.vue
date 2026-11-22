<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import InventoryPicker from "./InventoryPicker.vue";
import { useDebounced, useLatest } from "../../lib/ga";
import { fmtNum, fmtTime, locationText, partText, type BalanceRowView, type HoldingEventView } from "../../lib/ga-inventory-stock";
import { HOLDING_FILTERS, HOLDING_LABEL, holdingProblem } from "../../../../lib/workspace/general-affairs/inventory-stock-rules";

// G12 持有狀態（C4）：使用中／閒置可調撥／待確認。統計是全量（資料庫端精確加總，不是只算載入的那一頁）；
// 優先可調撥前 3 名；逐列調整時可填原因，並可看每筆的修改紀錄。調整需要「庫存交易管理」權限，其餘人唯讀（原因由伺服端遮蔽）。
const rows = ref<BalanceRowView[]>([]);
const top = ref<BalanceRowView[]>([]);
const total = ref(0);
const summary = ref({ total_qty: 0, in_use: 0, idle: 0, unclassified: 0 });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const locationId = ref("");
const filter = ref("");
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const canAdjust = ref(false);
const internal = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (locationId.value) q.set("locationId", locationId.value);
    if (filter.value) q.set("holding", filter.value);
    const res = await api<{ data: BalanceRowView[]; total: number; summary: typeof summary.value; top: BalanceRowView[]; permissions: { canAdjust: boolean; internal: boolean } }>("general-affairs/inventory/holding?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    top.value = res.top;
    total.value = res.total;
    summary.value = res.summary;
    canAdjust.value = res.permissions.canAdjust;
    internal.value = res.permissions.internal;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; top.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, locationId, filter], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
defineExpose({ reload: load });

// ---- 調整
const editing = ref<BalanceRowView | null>(null);
const draft = ref({ inUse: "", idle: "", reason: "" });
const saving = ref(false);
const editError = ref("");
const stale = ref(false);
function openEdit(r: BalanceRowView) {
  editing.value = r;
  draft.value = { inUse: String(r.holding?.in_use_quantity ?? 0), idle: String(r.holding?.idle_quantity ?? 0), reason: "" };
  editError.value = "";
  stale.value = false;
}
const draftProblem = computed(() => {
  if (!editing.value) return "";
  const a = Number(draft.value.inUse), b = Number(draft.value.idle);
  if (draft.value.inUse.trim() === "" || draft.value.idle.trim() === "" || !Number.isFinite(a) || !Number.isFinite(b)) return "請輸入使用中與閒置數量";
  return holdingProblem(a, b, Number(editing.value.quantity_base));
});
const draftUnclassified = computed(() => (editing.value ? Math.max(0, Number(editing.value.quantity_base) - Number(draft.value.inUse || 0) - Number(draft.value.idle || 0)) : 0));
async function saveEdit() {
  if (!editing.value || saving.value) return;
  if (draftProblem.value) { editError.value = draftProblem.value; return; }
  saving.value = true;
  editError.value = "";
  stale.value = false;
  try {
    await api(`general-affairs/inventory/holding/${editing.value.id}`, {
      method: "PATCH",
      body: JSON.stringify({ in_use_quantity: Number(draft.value.inUse), idle_quantity: Number(draft.value.idle), reason: draft.value.reason.trim() || undefined, expected_updated_at: editing.value.holding?.updated_at ?? null }),
    });
    notice.value = `已調整「${partText(editing.value.part)}」的持有狀態`;
    editing.value = null;
    await load();
  } catch (e) {
    editError.value = (e as Error).message;
    stale.value = e instanceof ApiError && e.data?.code === "STALE";
  } finally {
    saving.value = false;
  }
}
async function reloadEditing() {
  const id = editing.value?.id;
  await load();
  const fresh = rows.value.find((r) => r.id === id);
  if (fresh) openEdit(fresh);
  else editing.value = null;
}

// ---- 修改紀錄
const history = ref<{ row: BalanceRowView; events: HoldingEventView[]; total: number; page: number; loading: boolean; error: string } | null>(null);
async function openHistory(r: BalanceRowView, pageNo = 1) {
  history.value = { row: r, events: history.value?.row.id === r.id ? history.value.events : [], total: 0, page: pageNo, loading: true, error: "" };
  try {
    const res = await api<{ data: HoldingEventView[]; total: number }>(`general-affairs/inventory/holding/${r.id}/events?page=${pageNo}&pageSize=10`);
    if (history.value?.row.id === r.id) Object.assign(history.value, { events: res.data, total: res.total, page: pageNo });
  } catch (e) {
    if (history.value) history.value.error = (e as Error).message;
  } finally {
    if (history.value) history.value.loading = false;
  }
}
const historyPages = computed(() => Math.max(1, Math.ceil((history.value?.total || 0) / 10)));
const hv = (r: BalanceRowView) => r.holding || { in_use_quantity: 0, idle_quantity: 0, unclassified_quantity: Number(r.quantity_base), notes: null, updated_at: null };
</script>

<template>
  <section aria-label="持有狀態">
    <p class="muted">「持有狀態」說明庫存裡有多少正在使用、多少閒置可以調撥、多少還沒確認。它不影響帳面庫存，也不會產生流水。</p>
    <ul class="sum-cards" aria-label="持有狀態統計（全部）">
      <li><span>實際持有</span><strong data-testid="sum-total">{{ fmtNum(summary.total_qty) }}</strong></li>
      <li><span>使用中</span><strong data-testid="sum-in-use">{{ fmtNum(summary.in_use) }}</strong></li>
      <li class="idle"><span>閒置可調撥</span><strong data-testid="sum-idle">{{ fmtNum(summary.idle) }}</strong></li>
      <li><span>待確認</span><strong data-testid="sum-unclassified">{{ fmtNum(summary.unclassified) }}</strong></li>
    </ul>
    <div class="top-box" data-testid="top-box">
      <strong>優先可調撥料件（閒置最多的前 3 名）</strong>
      <p v-if="!top.length" class="muted">目前沒有閒置可調撥的庫存。</p>
      <ol v-else class="top-list">
        <li v-for="r in top" :key="r.id" data-testid="top-row"><span>{{ partText(r.part) }}　<small class="muted">{{ locationText(r.location, r.store) }}</small></span><strong>{{ fmtNum(r.holding?.idle_quantity) }} {{ r.part?.base_unit }}</strong></li>
      </ol>
    </div>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="位置、料件名稱、代碼" /></label>
      <div class="filter-pick"><InventoryPicker v-model="locationId" kind="locations" label="位置" clearable placeholder="全部位置" /></div>
      <label>狀態<select v-model="filter" aria-label="持有狀態篩選"><option value="">全部有庫存的項目</option><option v-for="f in HOLDING_FILTERS" :key="f" :value="f">{{ HOLDING_LABEL[f] }}</option></select></label>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="loaded && !canAdjust" class="notice" role="status" data-testid="holding-readonly">您目前是唯讀檢視，不能調整持有狀態<template v-if="!internal">（調整原因也不顯示）</template>。</p>
    <div class="list-meta"><span data-testid="holding-total">共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll hold-table">
      <table>
        <thead><tr><th>位置</th><th>料件</th><th class="num">持有</th><th class="num">使用中</th><th class="num">閒置可調撥</th><th class="num">待確認</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="holding-row">
            <td>{{ locationText(r.location, r.store) }}</td>
            <td>{{ partText(r.part) }}</td>
            <td class="num"><strong>{{ fmtNum(r.quantity_base) }}</strong> {{ r.part?.base_unit }}</td>
            <td class="num">{{ fmtNum(hv(r).in_use_quantity) }}</td>
            <td class="num">{{ fmtNum(hv(r).idle_quantity) }}</td>
            <td class="num">{{ fmtNum(hv(r).unclassified_quantity) }}</td>
            <td><div class="actions">
              <button v-if="canAdjust" type="button" :aria-label="`調整 ${partText(r.part)}`" @click="openEdit(r)">調整</button>
              <button type="button" :aria-label="`修改紀錄 ${partText(r.part)}`" @click="openHistory(r)">修改紀錄</button>
            </div></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ error ? "資料載入失敗" : loaded ? "沒有符合的持有庫存" : "" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="hold-cards" aria-label="持有狀態清單">
      <li v-for="r in rows" :key="r.id" class="hold-card" data-testid="holding-card">
        <div class="card-title"><strong>{{ partText(r.part) }}</strong><small>{{ locationText(r.location, r.store) }}</small></div>
        <p class="card-line">持有 <strong>{{ fmtNum(r.quantity_base) }}</strong> {{ r.part?.base_unit }}　使用中 {{ fmtNum(hv(r).in_use_quantity) }}　閒置 {{ fmtNum(hv(r).idle_quantity) }}　待確認 {{ fmtNum(hv(r).unclassified_quantity) }}</p>
        <div class="card-actions" :class="{ one: !canAdjust }">
          <button v-if="canAdjust" type="button" @click="openEdit(r)">調整</button>
          <button type="button" @click="openHistory(r)">修改紀錄</button>
        </div>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : loaded ? "沒有符合的持有庫存" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="editing" title="調整持有狀態" :busy="saving" @cancel="editing = null">
      <form class="edit-form" novalidate @submit.prevent="saveEdit">
        <p><strong>{{ partText(editing.part) }}</strong><br /><small class="muted">{{ locationText(editing.location, editing.store) }}　實際持有 {{ fmtNum(editing.quantity_base) }} {{ editing.part?.base_unit }}</small></p>
        <label>使用中<input v-model="draft.inUse" inputmode="decimal" :disabled="saving" aria-label="使用中數量" /></label>
        <label>閒置可調撥<input v-model="draft.idle" inputmode="decimal" :disabled="saving" aria-label="閒置數量" /></label>
        <p class="muted" data-testid="draft-unclassified">待確認（自動計算）：{{ fmtNum(draftUnclassified) }}</p>
        <label>調整原因（選填，會記在修改紀錄）<input v-model="draft.reason" maxlength="500" :disabled="saving" aria-label="調整原因" placeholder="例如：盤點後確認 3 件閒置" /></label>
        <p v-if="draftProblem && (draft.inUse !== '' || draft.idle !== '')" class="field-error" role="alert">{{ draftProblem }}</p>
        <p v-if="editError" class="field-error" role="alert">{{ editError }}</p>
        <p v-if="stale" class="field-error"><button type="button" @click="reloadEditing">重新載入這筆</button></p>
        <div class="dialog-actions"><button type="button" :disabled="saving" @click="editing = null">取消</button><button type="submit" class="primary" :disabled="saving || !!draftProblem">{{ saving ? "儲存中…" : "儲存" }}</button></div>
      </form>
    </Modal>

    <Modal v-if="history" title="持有狀態修改紀錄" wide @cancel="history = null">
      <p><strong>{{ partText(history.row.part) }}</strong> <small class="muted">{{ locationText(history.row.location, history.row.store) }}</small></p>
      <p v-if="history.loading" class="muted" role="status">載入中…</p>
      <p v-if="history.error" class="field-error" role="alert">{{ history.error }}</p>
      <ul v-if="history.events.length" class="events" data-testid="history-list">
        <li v-for="e in history.events" :key="e.id" data-testid="history-row">
          <span class="muted">{{ fmtTime(e.created_at) }}　{{ e.creator_name || "—" }}</span>
          <span>使用中 {{ fmtNum(e.before_in_use_quantity) }} → <strong>{{ fmtNum(e.after_in_use_quantity) }}</strong>　閒置 {{ fmtNum(e.before_idle_quantity) }} → <strong>{{ fmtNum(e.after_idle_quantity) }}</strong></span>
          <span v-if="e.notes" class="note">原因：{{ e.notes }}</span>
        </li>
      </ul>
      <p v-else-if="!history.loading && !history.error" class="muted">還沒有修改紀錄。</p>
      <footer v-if="history.total > 10" class="pagination">
        <span>第 {{ history.page }} / {{ historyPages }} 頁</span>
        <button type="button" :disabled="history.page <= 1 || history.loading" @click="openHistory(history.row, history.page - 1)">上一頁</button>
        <button type="button" :disabled="history.page >= historyPages || history.loading" @click="openHistory(history.row, history.page + 1)">下一頁</button>
      </footer>
      <div class="dialog-actions"><button type="button" class="primary" @click="history = null">關閉</button></div>
    </Modal>
  </section>
</template>

<style scoped>
.sum-cards { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.sum-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.sum-cards li.idle { border-color: var(--primary); }
.sum-cards span { font-size: 12px; color: var(--muted); }
.sum-cards strong { font-size: 22px; }
.top-box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: grid; gap: 6px; }
.top-box p { margin: 0; }
.top-list { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
.top-list li { padding-left: 4px; }
.top-list li span { margin-right: 10px; overflow-wrap: anywhere; }
.filter-pick { min-width: 220px; flex: 1; }
.num { text-align: right; white-space: nowrap; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.edit-form { display: grid; gap: 10px; }
.edit-form label { display: grid; gap: 4px; }
.events { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 8px; }
.events li { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: grid; gap: 2px; overflow-wrap: anywhere; }
.note { color: var(--text); }
.hold-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.hold-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-line { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.card-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.card-actions.one { grid-template-columns: 1fr; }
.card-actions button { min-height: 44px; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .hold-table { display: none; }
  .hold-cards { display: grid; }
  .sum-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
