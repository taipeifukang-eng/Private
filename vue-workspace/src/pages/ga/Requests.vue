<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import RequestDetail from "../../components/ga/RequestDetail.vue";
import { useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { storeText, targetText, type RequestPerms, type RequestRow, type RequestStats } from "../../lib/ga-requests";
import { REQUEST_STATUSES, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, ROUTE_LABEL } from "../../../../lib/workspace/general-affairs/request-rules";
import type { WorkTab } from "../../stores";

// G16 總務需求工作台：受理、駁回、補資料、取消、重新開啟、庫存出庫、採購評估（選進入採購時自動產生草稿採購單）、關聯採購單進度、逾期未確認標示與一鍵篩選。
// 狀態流轉由資料庫強制（不合法回 409 與白話原因）；內部備註只給總務看。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);

const rows = ref<RequestRow[]>([]);
const total = ref(0);
const stats = ref<RequestStats>({});
const settings = ref<{ overdue_days: number; updated_at: string | null }>({ overdue_days: 7, updated_at: null });
const perms = ref<RequestPerms>({ manage: false, create: false, purchaseManage: false, purchaseView: false, stockIssue: false, commentOwn: false, confirmOwn: false, stores: [] });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const type = ref("");
const overdueOnly = ref(false);
// 從首頁或導覽徽章點進來：只看「待受理」（與徽章同一組條件，V9）
const attention = ref(!!(props.tab.payload as { attention?: unknown } | undefined)?.attention);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const detailId = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || type.value || overdueOnly.value || attention.value));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (type.value) q.set("type", type.value);
    if (overdueOnly.value) q.set("overdue", "true");
    if (attention.value) q.set("attention", "1");
    const res = await api<{ data: RequestRow[]; total: number; stats: RequestStats; settings: typeof settings.value; permissions: RequestPerms }>("general-affairs/requests?" + q);
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
watch([debounced, status, type, overdueOnly, attention], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => { void load(); });
useRefreshOnActivate(props.tab, load);

function pickCard(kind: string) {
  const same = (kind === "overdue" && overdueOnly.value) || status.value === kind;
  status.value = "";
  overdueOnly.value = false;
  if (same || kind === "all") return;
  if (kind === "overdue") overdueOnly.value = true;
  else status.value = kind;
}
const activeCard = computed(() => (overdueOnly.value ? "overdue" : status.value || "all"));
const cards = computed(() => [
  { id: "all", label: "全部", n: stats.value.all ?? 0, cls: "" },
  ...(["PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS", "WAITING_STORE_CONFIRMATION"] as const).map((s) => ({ id: s, label: REQUEST_STATUS_LABEL[s], n: stats.value[s] ?? 0, cls: "" })),
  ...(perms.value.manage ? [{ id: "overdue", label: `逾期未確認（超過 ${settings.value.overdue_days} 天）`, n: stats.value.overdue ?? 0, cls: (stats.value.overdue ?? 0) > 0 ? "alert" : "" }] : []),
  ...(["COMPLETED", "REJECTED", "CANCELED"] as const).map((s) => ({ id: s, label: REQUEST_STATUS_LABEL[s], n: stats.value[s] ?? 0, cls: "" })),
]);

// ---- 逾期天數設定（D5）
const settingOpen = ref(false);
const days = ref("7");
const settingBusy = ref(false);
const settingError = ref("");
function openSetting() { days.value = String(settings.value.overdue_days); settingError.value = ""; settingOpen.value = true; }
async function saveSetting() {
  if (settingBusy.value) return;
  const n = Number(days.value);
  if (!Number.isInteger(n) || n < 1 || n > 90) { settingError.value = "逾期天數必須是 1 到 90 的整數"; return; }
  settingBusy.value = true;
  settingError.value = "";
  try {
    await api("general-affairs/requests/settings", { method: "PATCH", body: JSON.stringify({ overdue_days: n, expected_updated_at: settings.value.updated_at }) });
    settingOpen.value = false;
    notice.value = `逾期天數已改為 ${n} 天。`;
    await load();
  } catch (e) {
    settingError.value = e instanceof ApiError && e.data?.code === "STALE" ? "設定剛被其他人修改，請關閉後重新開啟。" : (e as Error).message;
  } finally {
    settingBusy.value = false;
  }
}
void REQUEST_STATUSES;
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>總務需求工作台</h1>
      <p class="muted">門市送來的維修與添購需求在這裡受理與處理。狀態流轉有規則：已完成或已駁回的單要「重新開啟」；已有採購單、已出庫的單不能取消或駁回。</p>
    </div>
    <div class="head-actions"><button v-if="perms.manage" type="button" data-testid="open-setting" @click="openSetting">逾期天數設定</button></div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', '總務需求工作台']">
    <p v-if="notice" class="notice success" role="status" data-testid="rq-notice">{{ notice }}</p>
    <ul class="stat-cards" aria-label="需求單統計">
      <li v-for="c in cards" :key="c.id" :class="[c.cls, { on: activeCard === c.id }]">
        <button type="button" :data-testid="'card-' + c.id" :aria-pressed="activeCard === c.id" @click="pickCard(c.id)"><span>{{ c.label }}</span><strong :data-testid="'stat-' + c.id">{{ c.n }}</strong></button>
      </li>
    </ul>
    <p v-if="attention" class="notice" role="status" data-testid="attention-chip">只顯示「待我處理」的項目，筆數與導覽數字一致。<button type="button" data-testid="attention-clear" @click="attention = false">看全部</button></p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="需求單號、標題、說明（可含逗號、括號）" /></label>
      <label>類型<select v-model="type" aria-label="類型"><option value="">全部類型</option><option v-for="(l, k) in REQUEST_TYPE_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="rq-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="rq-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll rq-table">
      <table>
        <thead><tr><th>單號</th><th>狀態</th><th>類型與標的</th><th>門市</th><th>處理方式</th><th>建立／更新</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="rq-row" :class="{ 'row-red': r.is_overdue_confirm }">
            <td><strong>{{ r.request_no }}</strong><br />{{ r.title }}</td>
            <td>
              <span class="st" :data-status="r.main_status">{{ REQUEST_STATUS_LABEL[r.main_status] }}</span>
              <span v-if="r.is_overdue_confirm" class="flag" data-testid="row-overdue">逾期未確認</span>
              <span v-if="r.store_reply_pending" class="flag soft" data-testid="row-reply">門市有新留言 {{ r.unread_store_comment_count }}</span>
            </td>
            <td>{{ REQUEST_TYPE_LABEL[r.request_type] }}<br /><span class="muted">{{ targetText(r) }}</span></td>
            <td>{{ storeText(r.store) }}</td>
            <td>{{ r.intake_route ? ROUTE_LABEL[r.intake_route] : "—" }}</td>
            <td>{{ fmtTime(r.created_at) }}<br /><span class="muted">更新 {{ fmtTime(r.updated_at) }}</span></td>
            <td><button type="button" data-testid="open-detail" @click="detailId = r.id">查看與處理</button></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的需求單" : loaded ? "目前沒有需求單" : "" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="rq-cards" aria-label="需求單清單">
      <li v-for="r in rows" :key="r.id" class="rq-card" :class="{ 'row-red': r.is_overdue_confirm }" data-testid="rq-card">
        <div class="card-head"><strong>{{ r.request_no }}</strong><span class="st" :data-status="r.main_status">{{ REQUEST_STATUS_LABEL[r.main_status] }}</span></div>
        <p class="card-flags"><span v-if="r.is_overdue_confirm" class="flag" data-testid="row-overdue">逾期未確認</span><span v-if="r.store_reply_pending" class="flag soft">門市有新留言</span></p>
        <p class="card-line">{{ r.title }}</p>
        <p class="card-line muted">{{ REQUEST_TYPE_LABEL[r.request_type] }}　{{ storeText(r.store) }}　{{ targetText(r) }}</p>
        <p class="card-line muted">建立 {{ fmtTime(r.created_at) }}</p>
        <button type="button" data-testid="open-detail" @click="detailId = r.id">查看與處理</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的需求單" : loaded ? "目前沒有需求單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <RequestDetail v-if="detailId" :request-id="detailId" surface="GA_WORKBENCH" @close="detailId = ''" @changed="load" />
    <Modal v-if="settingOpen" title="逾期天數設定" :busy="settingBusy" @cancel="settingOpen = false">
      <form class="setting" novalidate @submit.prevent="saveSetting">
        <p>「待門市確認」超過幾天還沒回覆，就在清單標示「逾期未確認」並可一鍵篩選（只標示，不會自動結案，也不發通知）。預設 7 天。</p>
        <label>逾期天數（1 到 90）<input v-model="days" inputmode="numeric" aria-label="逾期天數" data-testid="overdue-days" /></label>
        <p v-if="settingError" class="field-error" role="alert" data-testid="setting-error">{{ settingError }}</p>
        <div class="dialog-actions"><button type="button" :disabled="settingBusy" @click="settingOpen = false">取消</button><button type="submit" class="primary" :disabled="settingBusy" data-testid="setting-save">{{ settingBusy ? "儲存中…" : "儲存" }}</button></div>
      </form>
    </Modal>
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.stat-cards li.alert { border-color: #d9a3a0; }
.stat-cards li.alert strong { color: var(--danger, #b3261e); }
.stat-cards button { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 12px; min-height: 60px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
.flag { display: inline-block; margin-left: 6px; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; background: #fde7e5; color: #8c1d18; border: 1px solid #e5a9a5; white-space: nowrap; }
.flag.soft { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .flag { background: #4a1f1d; color: #f6b8b3; border-color: #7a3531; }
:root[data-theme="dark"] .flag.soft { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.row-red td { background: color-mix(in srgb, #d9534f 8%, transparent); }
.rq-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.rq-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.rq-card.row-red { border-color: #d9a3a0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-flags { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.card-flags .flag { margin-left: 0; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty, .empty { text-align: center; color: var(--muted); padding: 20px; }
.setting { display: grid; gap: 12px; }
.setting label { display: grid; gap: 4px; }
@media (max-width: 700px) {
  .rq-table { display: none; }
  .rq-cards { display: grid; }
  .rq-card button { min-height: 44px; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
