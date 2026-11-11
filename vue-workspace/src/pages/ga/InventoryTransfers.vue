<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import InventoryTransferCreate from "../../components/ga/InventoryTransferCreate.vue";
import InventoryTransferDetail from "../../components/ga/InventoryTransferDetail.vue";
import TransferStatusBadge from "../../components/ga/TransferStatusBadge.vue";
import { useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { itemText, placeText, type TransferStats, type TransferView } from "../../lib/ga-inventory-transfers";
import { PREFILL_KEYS, STATUS_LABEL, TRANSFER_STATUSES, reportSummary } from "../../../../lib/workspace/general-affairs/inventory-transfer-rules";
import type { WorkTab } from "../../stores";

// G13 庫存調撥單（料件庫存從一個位置搬到另一個位置；不是設備轉移單）。
// 狀態：待來源確認交出 → 來源已交出（扣來源庫存）→ 運送中 → 已收貨（增加目的庫存）；未收貨前可取消（可勾「退回來源庫存」）。「未收」只是註記，單子仍待收貨（C9）。
// 逾期（已交出超過 N 天還沒收貨）標紅並可篩選（C11）；目的門市名單上的店長、督導、區經理可回報問題（C10）；唯讀名單身分（店長、督導、區經理）看不到內部備註（C12）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);

const rows = ref<TransferView[]>([]);
const total = ref(0);
const stats = ref<TransferStats>({ all: 0, overdue: 0, reported: 0, REQUESTED: 0, SOURCE_CONFIRMED: 0, IN_TRANSIT: 0, RECEIVED: 0, CANCELED: 0 });
const settings = ref<{ overdue_days: number; updated_at: string | null }>({ overdue_days: 3, updated_at: null });
const perms = ref({ internal: false, canCreate: false, canSetOverdue: false, canReport: false, problem: "" });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const overdueOnly = ref(false);
const reportedOnly = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || overdueOnly.value || reportedOnly.value));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (overdueOnly.value) q.set("overdue", "true");
    if (reportedOnly.value) q.set("reported", "true");
    const res = await api<{ data: TransferView[]; total: number; stats: TransferStats; settings: typeof settings.value; permissions: typeof perms.value }>("general-affairs/inventory/transfers?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    settings.value = res.settings;
    perms.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, status, overdueOnly, reportedOnly], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void load(); void consumePrefill(); });
useRefreshOnActivate(props.tab, load);

// 卡片點選＝套用篩選（狀態、逾期、門市回報互斥，切換時清掉其他）。
function pickCard(kind: string) {
  const same = (kind === "overdue" && overdueOnly.value) || (kind === "reported" && reportedOnly.value) || status.value === kind;
  status.value = "";
  overdueOnly.value = false;
  reportedOnly.value = false;
  if (same || kind === "all") return;
  if (kind === "overdue") overdueOnly.value = true;
  else if (kind === "reported") reportedOnly.value = true;
  else status.value = kind;
}
const activeCard = computed(() => (overdueOnly.value ? "overdue" : reportedOnly.value ? "reported" : status.value || "all"));

// ---- 建單（含網址帶入）
const creating = ref(false);
const prefill = ref<any | null>(null);
const prefillError = ref("");
async function consumePrefill() {
  const p = (props.tab.payload as { prefill?: Record<string, string> } | undefined)?.prefill;
  if (!p || !allowed.value) return;
  props.tab.payload = {};
  const q = new URLSearchParams();
  for (const k of PREFILL_KEYS) if (p[k]) q.set(k, p[k]);
  prefillError.value = "";
  try {
    prefill.value = await api("general-affairs/inventory/transfers/prefill?" + q);
    creating.value = true;
  } catch (e) {
    // 沒有建單權限等情況：說明原因，不開建單視窗。
    prefillError.value = (e as Error).message;
  }
}
watch(() => (props.tab.payload as { prefill?: unknown } | undefined)?.prefill, (v) => { if (v) void consumePrefill(); });
function openCreate() {
  prefill.value = null;
  creating.value = true;
}
function onCreated() {
  notice.value = "調撥單已建立。";
  void load();
}
function closeCreate() {
  creating.value = false;
  prefill.value = null;
}

// ---- 詳情
const detailId = ref("");
function onChanged() { void load(); }

// ---- 逾期天數設定（C11）
const settingOpen = ref(false);
const days = ref("3");
const settingBusy = ref(false);
const settingError = ref("");
const settingStale = ref(false);
function openSetting() { days.value = String(settings.value.overdue_days); settingError.value = ""; settingStale.value = false; settingOpen.value = true; }
async function saveSetting() {
  if (settingBusy.value) return;
  settingBusy.value = true;
  settingError.value = "";
  try {
    const n = Number(days.value);
    if (!Number.isInteger(n) || n < 1 || n > 90) { settingError.value = "逾期天數必須是 1 到 90 的整數"; return; }
    await api("general-affairs/inventory/transfers/settings", { method: "PATCH", body: JSON.stringify({ overdue_days: n, expected_updated_at: settings.value.updated_at }) });
    settingOpen.value = false;
    notice.value = `逾期天數已改為 ${n} 天。`;
    await load();
  } catch (e) {
    settingError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") settingStale.value = true;
  } finally {
    settingBusy.value = false;
  }
}
async function reloadSetting() { await load(); days.value = String(settings.value.overdue_days); settingStale.value = false; settingError.value = ""; }

const cards = computed(() => [
  { id: "all", label: "全部", n: stats.value.all, cls: "" },
  { id: "REQUESTED", label: "待確認交出", n: stats.value.REQUESTED, cls: "" },
  { id: "SOURCE_CONFIRMED", label: "已交出", n: stats.value.SOURCE_CONFIRMED, cls: "" },
  { id: "IN_TRANSIT", label: "運送中", n: stats.value.IN_TRANSIT, cls: "" },
  { id: "overdue", label: `逾期未收（超過 ${settings.value.overdue_days} 天）`, n: stats.value.overdue, cls: stats.value.overdue > 0 ? "alert" : "" },
  { id: "reported", label: "門市回報有問題", n: stats.value.reported, cls: stats.value.reported > 0 ? "alert" : "" },
  { id: "RECEIVED", label: "已收貨", n: stats.value.RECEIVED, cls: "" },
  { id: "CANCELED", label: "已取消", n: stats.value.CANCELED, cls: "" },
]);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 庫存管理</p>
      <h1>庫存調撥單</h1>
      <p class="muted">把料件庫存從一個位置搬到另一個位置：來源確認交出時扣來源庫存，目的位置確認收貨時才增加目的庫存。這裡是「料件庫存調撥單」，不是設備轉移單。</p>
    </div>
    <div class="head-actions">
      <button v-if="perms.canSetOverdue" type="button" data-testid="open-setting" @click="openSetting">逾期天數設定</button>
      <button v-if="perms.canCreate" class="primary" type="button" data-testid="open-create" @click="openCreate">建立調撥單</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '庫存管理', '調撥與收貨']">
    <p v-if="prefillError" class="notice error" role="alert" data-testid="prefill-error">網址帶入的內容沒有開啟建單視窗：{{ prefillError }}</p>
    <p v-if="!perms.canCreate && loaded && !perms.internal" class="notice" role="status" data-testid="readonly-note">您目前是唯讀檢視：只會看到跟自己門市有關的調撥單，內部備註不顯示。目的門市名單上的店長、督導、區經理可以在已交出的調撥單上「回報問題」。</p>
    <p v-else-if="!perms.canCreate && loaded && perms.problem" class="notice" role="status" data-testid="readonly-note">您不能建立或處理調撥單。{{ perms.problem }}</p>
    <p v-if="notice" class="notice success" role="status" data-testid="tr-notice">{{ notice }}</p>

    <ul class="stat-cards" aria-label="調撥單統計">
      <li v-for="c in cards" :key="c.id" :class="[c.cls, { on: activeCard === c.id }]">
        <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ c.n }}</strong></button>
      </li>
    </ul>

    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="調撥單號、調撥原因（可含逗號、括號）" /></label>
      <label>狀態<select v-model="status" aria-label="狀態" @change="overdueOnly = false; reportedOnly = false"><option value="">全部狀態</option><option v-for="s in TRANSFER_STATUSES" :key="s" :value="s">{{ STATUS_LABEL[s] }}</option></select></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="tr-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="tr-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll tr-table">
      <table>
        <thead><tr><th>單號</th><th>狀態</th><th>來源 → 目的</th><th>料件</th><th>原因</th><th>建立／交出</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="tr-row" :class="{ 'row-red': r.is_overdue || r.has_store_report }">
            <td><strong>{{ r.transfer_no }}</strong></td>
            <td>
              <TransferStatusBadge :status="r.status" />
              <span v-if="r.is_overdue" class="flag" data-testid="row-overdue">逾期 {{ r.days_since_issued }} 天</span>
              <span v-if="r.has_store_report" class="flag" data-testid="row-reported" :title="reportSummary(r.store_report_type, r.store_report_note)">門市回報問題</span>
              <span v-if="r.unreceived_marked_at" class="flag soft" data-testid="row-unreceived">已註記未收</span>
            </td>
            <td>{{ placeText(r.source_location) }} → {{ placeText(r.destination_location) }}</td>
            <td><span v-for="i in r.items" :key="i.id">{{ itemText(i) }}</span></td>
            <td>{{ r.reason }}</td>
            <td>{{ fmtTime(r.created_at) }}<br /><span class="muted">{{ r.source_confirmed_at ? "交出 " + fmtTime(r.source_confirmed_at) : "尚未交出" }}</span></td>
            <td><button type="button" data-testid="open-detail" @click="detailId = r.id">查看與處理</button></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的調撥單" : loaded ? "目前沒有調撥單" : "" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="tr-cards" aria-label="調撥單清單">
      <li v-for="r in rows" :key="r.id" class="tr-card" :class="{ 'row-red': r.is_overdue || r.has_store_report }" data-testid="tr-card">
        <div class="card-head"><strong>{{ r.transfer_no }}</strong><TransferStatusBadge :status="r.status" /></div>
        <p class="card-flags"><span v-if="r.is_overdue" class="flag" data-testid="row-overdue">逾期 {{ r.days_since_issued }} 天</span><span v-if="r.has_store_report" class="flag" data-testid="row-reported">門市回報問題</span><span v-if="r.unreceived_marked_at" class="flag soft" data-testid="row-unreceived">已註記未收</span></p>
        <p class="card-line">{{ placeText(r.source_location) }} → {{ placeText(r.destination_location) }}</p>
        <p class="card-line"><span v-for="i in r.items" :key="i.id">{{ itemText(i) }}</span></p>
        <p class="card-line muted">{{ r.reason }}</p>
        <p class="card-line muted">建立 {{ fmtTime(r.created_at) }}　{{ r.source_confirmed_at ? "交出 " + fmtTime(r.source_confirmed_at) : "尚未交出" }}</p>
        <button type="button" data-testid="open-detail" @click="detailId = r.id">查看與處理</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的調撥單" : loaded ? "目前沒有調撥單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <InventoryTransferCreate v-if="creating" :key="prefill ? 'p' : 'n'" :prefill="prefill" :problem="perms.problem" @close="closeCreate" @created="onCreated" />
    <InventoryTransferDetail v-if="detailId" :transfer-id="detailId" :overdue-days="settings.overdue_days" @close="detailId = ''" @changed="onChanged" />
    <Modal v-if="settingOpen" title="逾期天數設定" :busy="settingBusy" @cancel="settingOpen = false">
      <form class="setting" novalidate @submit.prevent="saveSetting">
        <p>已交出的調撥單超過幾天還沒收貨，就在清單標紅並可篩選。預設 3 天。</p>
        <label>逾期天數（1 到 90）<input v-model="days" inputmode="numeric" aria-label="逾期天數" data-testid="overdue-days" /></label>
        <p v-if="settingError" class="field-error" role="alert" data-testid="setting-error">{{ settingError }}</p>
        <p v-if="settingStale" class="notice" role="alert"><button type="button" @click="reloadSetting">重新載入最新設定</button></p>
        <div class="dialog-actions"><button type="button" :disabled="settingBusy" @click="settingOpen = false">取消</button><button type="submit" class="primary" :disabled="settingBusy" data-testid="setting-save">{{ settingBusy ? "儲存中…" : "儲存" }}</button></div>
      </form>
    </Modal>
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards li.alert strong { color: var(--danger, #b3261e); }
.stat-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 10px 14px; min-height: 64px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 22px; }
.flag { display: inline-block; margin-left: 6px; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; background: #fde7e5; color: #8c1d18; border: 1px solid #e5a9a5; white-space: nowrap; }
.flag.soft { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .flag { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
:root[data-theme="dark"] .flag.soft { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.row-red td { background: color-mix(in srgb, #d9534f 8%, transparent); }
td span + span::before { content: "、"; }
.tr-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.tr-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.tr-card.row-red { border-color: #d9a3a0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-flags { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.card-flags .flag { margin-left: 0; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; }
.setting { display: grid; gap: 12px; }
.setting label { display: grid; gap: 4px; }
@media (max-width: 700px) {
  .tr-table { display: none; }
  .tr-cards { display: grid; }
  .tr-card button { min-height: 44px; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
