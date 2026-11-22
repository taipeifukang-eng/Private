<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import RequestDetail from "../../components/ga/RequestDetail.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { storeText, targetText, type RequestPerms, type RequestRow, type RequestStats } from "../../lib/ga-requests";
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL } from "../../../../lib/workspace/general-affairs/request-rules";
import { useSession, type WorkTab } from "../../stores";

// G15 我的追蹤：店長追蹤自己門市送出的需求。可留言（可改刪，標示已編輯／已刪除）、補資料、確認完成、回報仍有問題、撤回尚未受理的需求；設備入帳（貼標）任務在「貼標待辦」。
// 內部備註與內部事件不會傳到這裡。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const session = useSession();

const rows = ref<RequestRow[]>([]);
const total = ref(0);
const stats = ref<RequestStats>({});
const perms = ref<RequestPerms>({ manage: false, create: false, purchaseManage: false, purchaseView: false, stockIssue: false, commentOwn: false, confirmOwn: false, stores: [] });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
// 從首頁或導覽徽章點進來：只看「待我確認或補資料」（與徽章同一組條件，V9）
const attention = ref(!!(props.tab.payload as { attention?: unknown } | undefined)?.attention);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const detailId = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const hasFilter = computed(() => !!(debounced.value.trim() || status.value || attention.value));
const canCreate = computed(() => !!session.data?.capabilities?.gaReportCreate);
const canTasks = computed(() => !!session.data?.capabilities?.gaOnboardingTasks);

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (attention.value) q.set("attention", "1");
    const res = await api<{ data: RequestRow[]; total: number; stats: RequestStats; permissions: RequestPerms }>("general-affairs/reports/mine?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    perms.value = res.permissions;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, status, attention], () => { page.value = 1; void load(); });
watch(page, load);
onMounted(() => void load());
useRefreshOnActivate(props.tab, load);
const waiting = computed(() => (stats.value.WAITING_STORE_CONFIRMATION ?? 0) + (stats.value.WAITING_STORE_SUPPLEMENT ?? 0));
const filters = [["", "全部"], ["WAITING_STORE_CONFIRMATION", "待我確認"], ["WAITING_STORE_SUPPLEMENT", "待我補資料"], ["PENDING_INTAKE", "待受理"], ["IN_PROGRESS", "處理中"], ["COMPLETED", "已完成"]] as const;
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 門市追蹤</p>
      <h1>我的追蹤</h1>
      <p class="muted">這裡看自己門市送出的需求進度。總務請你補資料或確認完成時，會顯示在這裡。</p>
    </div>
    <div class="head-actions">
      <button v-if="canTasks" type="button" data-testid="open-tasks" @click="openGaPage('ga-onboarding-tasks')">設備入帳（貼標）待辦</button>
      <button v-if="canCreate" class="primary" type="button" data-testid="open-create" @click="openGaPage('ga-report-create')">新增需求</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '門市追蹤', '我的追蹤']">
    <p v-if="loaded && waiting" class="notice" role="status" data-testid="waiting-hint">有 {{ waiting }} 張需求等您處理（補資料或確認完成）。</p>
    <p v-if="attention" class="notice" role="status" data-testid="attention-chip">只顯示「待我處理」的項目，筆數與導覽數字一致。<button type="button" data-testid="attention-clear" @click="attention = false">看全部</button></p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="需求單號、標題、說明" /></label>
      <label>狀態<select v-model="status" aria-label="狀態"><option v-for="f in filters" :key="f[0]" :value="f[0]">{{ f[1] }}{{ f[0] && stats[f[0]] !== undefined ? `（${stats[f[0]]}）` : "" }}</option></select></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="mr-error">{{ error }}</p>
    <div class="list-meta"><span data-testid="mr-total">共 {{ total }} 張</span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="mr-list" aria-label="我的需求清單">
      <li v-for="r in rows" :key="r.id" class="mr-card" data-testid="mr-card">
        <div class="card-head"><strong>{{ r.request_no }}</strong><span class="st" :data-status="r.main_status">{{ REQUEST_STATUS_LABEL[r.main_status] }}</span></div>
        <p class="card-line">{{ r.title }}</p>
        <p class="card-line muted">{{ REQUEST_TYPE_LABEL[r.request_type] }}　{{ storeText(r.store) }}　{{ targetText(r) }}</p>
        <p v-if="r.public_progress" class="card-line">{{ r.public_progress }}</p>
        <p class="card-line muted">建立 {{ fmtTime(r.created_at) }}　更新 {{ fmtTime(r.updated_at) }}</p>
        <button type="button" data-testid="open-detail" @click="detailId = r.id">查看與回覆</button>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty" data-testid="mr-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的需求單" : loaded ? "目前沒有需求單" : "" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>
    <RequestDetail v-if="detailId" :request-id="detailId" surface="STORE_TRACKING" @close="detailId = ''" @changed="load" />
  </GaShell>
</template>

<style scoped>
.head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mr-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.mr-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.card-line { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; grid-column: 1 / -1; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
@media (max-width: 700px) {
  .mr-card button { min-height: 44px; }
  .mr-list { grid-template-columns: minmax(0, 1fr); }
}
</style>
