<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from "vue";
import { api, type Store } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import MonthlyTools from "../components/MonthlyTools.vue";
import TopScrollTable from "../components/TopScrollTable.vue";
import {
  canDoMonthlyAction,
  canExpandPerformance,
  levelSuffix,
  movementTypeLabel,
  nextUnconfirmedStore,
  normalizeSummaryStatus,
  resolveMonthState,
  rowsAllow,
  rowsAllowAll,
  staffTags,
  STORE_SUMMARY_LABELS,
  workloadText,
  type PreSubmitReport,
} from "../../../lib/workspace/monthly-status-rules";
import {
  formatPromotionPosition,
  getMovementNotesForDisplay,
} from "../../../lib/monthly-staff/promotion-level";
const revision = ref(0);
const globalToolsTarget=ref<HTMLElement>(),storeToolsTarget=ref<HTMLElement>();
const positionOrder: Record<string,number> = {'總經理':1,'副總經理':2,'資深經理':3,'經理':4,'督導':5,'督導(代理店長)':6,'店長':7,'代理店長':8,'副店長':9,'主任':10,'資深副理':11,'副理':12,'組長':13,'資深專員':14,'高級專員':15,'專員':16,'出納專員':17,'助理':18,'新人':19,'行政':19,'兼職':20,'實習生':21};
const props = defineProps<{ tab: WorkTab }>();
const work = useWorkspace();
const stores = ref<Store[]>([]),
  allStores = ref<Store[]>([]),
  summaries = ref<{ store_id: string; store_status: string }[]>([]),
  stats = ref<{ total: number; confirmed: number; submitted: number; pending: number } | null>(null),
  showInactive = ref(false),
  rows = ref<any[]>([]),
  error = ref(""),
  loading = ref(false),
  permissions = ref<any>({}),
  confirmation = ref("");
const status: Record<string, string> = {
  draft: "草稿",
  submitted: "待確認",
  confirmed: "已確認",
};
const labels: Record<string, string> = {
  full_month: "整月在職",
  new_hire: "到職",
  resigned: "離職",
  leave_of_absence: "留停",
  transferred_in: "調入",
  transferred_out: "調出",
  promoted: "升職",
  support_rotation: "支援卡班",
  dual_store_manager: "擔任雙店長",
  leave_return: "留停復職",
};
const loaded = ref({ store: "", month: "" });
const queryChanged = computed(
  () =>
    loaded.value.store !== props.tab.store ||
    loaded.value.month !== props.tab.month,
);
// M1-x1：狀態與按鈕可用性一律走規則表（lib/workspace/monthly-status-rules.ts）。
const monthState = computed(
  () => resolveMonthState(rows.value, permissions.value.storeStatus) || "not_started",
);
const monthLocked = computed(
  () =>
    rows.value.some((r) => !canDoMonthlyAction(r.status, "edit")) ||
    ["submitted", "confirmed"].includes(String(permissions.value.storeStatus)),
);
// 規格 B.1／B.2：照舊版，門市未確認時每列（含已送審）都顯示「編輯」「刪除」，不另看 edit 權限；
// 已送審列的編輯開唯讀頁，非草稿的刪除由 API 回 409「需先退回」。已停止門市維持唯讀。
const rowEditable = computed(
  () => permissions.value.storeActive !== false && permissions.value.storeStatus !== "confirmed",
);
const canPerf = computed(() => !!permissions.value.canViewPerformance);
const visibleStores = computed(() =>
  showInactive.value ? allStores.value : stores.value,
);
const inactiveCount = computed(() => allStores.value.length - stores.value.length);
const showTabs = computed(() => visibleStores.value.length > 1 || inactiveCount.value > 0);
function summaryOf(id: string) {
  return normalizeSummaryStatus(summaries.value.find((s) => s.store_id === id)?.store_status);
}
const colCount = computed(() => (canPerf.value ? 14 : 8));
const actions: Record<string, string> = {
  initialize: "初始化本月人員",
  submit: "送出審核",
  confirm: "確認本月狀態",
  revert: "退回草稿",
  unconfirm: "取消確認",
  recompute: "依異動重算",
};
// M2 A.2／A.3：需重新確認清單、近期因異動自動調整清單。
const recheck = computed<any[]>(() => permissions.value.recheck || []);
const adjustments = computed<any[]>(() => permissions.value.adjustments || []);
const adjustedCodes = computed(() => new Set(adjustments.value.map((a: any) => a.employee_code)));
const fieldLabels: Record<string, string> = {
  position: "職位",
  newbie_level: "階段",
  is_acting_manager: "代理店長標記",
  is_pharmacist: "藥師身分",
  monthly_status: "本月狀態",
  work_days: "工作天數",
  partial_month_reason: "未滿月原因",
  roster_row: "名冊列",
};
function fieldValue(field: string, value: string | null) {
  if (value === null || value === undefined || value === "") return "（空）";
  if (value === "true") return "是";
  if (value === "false") return "否";
  if (field === "monthly_status") return labels[value] || value;
  return value;
}
const expanded = reactive(new Set<string>());
const staffDetails = reactive<Record<string, any[]>>({});
const detailBusy = ref("");
const skipChecks = ref(false);
async function load() {
  loading.value = true;
  error.value = "";
  expanded.clear();
  try {
    const r = await api(
      `monthly?${new URLSearchParams({ month: props.tab.month, store: props.tab.store })}`,
    );
    stores.value = r.stores;
    allStores.value = r.allStores || r.stores;
    summaries.value = r.summaries || [];
    stats.value = r.stats || null;
    rows.value = (r.records || []).sort((a:any,b:any)=>Number(!!b.is_acting_manager)-Number(!!a.is_acting_manager) || (positionOrder[a.position] || 999)-(positionOrder[b.position] || 999));
    permissions.value = r;
    revision.value++;
    props.tab.store = r.store || "";
    loaded.value = { store: props.tab.store, month: props.tab.month };
    props.tab.title = `人員狀態 · ${stores.value.find((s) => s.id === r.store)?.short_name || stores.value.find((s) => s.id === r.store)?.store_name || props.tab.month}`;
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
    permissions.value = {};
  } finally {
    loading.value = false;
  }
}
function selectStore(id: string) {
  if (loading.value || props.tab.busy || props.tab.dirty || id === props.tab.store) return;
  props.tab.store = id;
  void load();
}
async function toggleDetails(row: any) {
  if (expanded.has(row.id)) {
    expanded.delete(row.id);
    return;
  }
  if (!staffDetails[row.id]) {
    detailBusy.value = row.id;
    try {
      staffDetails[row.id] = (await api(`monthly?${new URLSearchParams({ op: "staffDetails", id: row.id, month: props.tab.month })}`)).details || [];
    } catch (e) {
      error.value = (e as Error).message;
      return;
    } finally {
      detailBusy.value = "";
    }
  }
  expanded.add(row.id);
}
// 異動歷程視窗（舊版點員工姓名）
const movement = ref<{ name: string; code: string } | null>(null);
const movementRows = ref<any[]>([]);
const movementBusy = ref(false);
const movementError = ref("");
async function openMovement(row: any) {
  movement.value = { name: row.employee_name, code: row.employee_code };
  movementRows.value = [];
  movementError.value = "";
  movementBusy.value = true;
  try {
    movementRows.value = (await api(`monthly?${new URLSearchParams({ op: "movements", employee_code: row.employee_code, store: props.tab.store, month: props.tab.month })}`)).movements || [];
  } catch (e) {
    movementError.value = (e as Error).message;
  } finally {
    movementBusy.value = false;
  }
}
const movementStore = (m: any) => (Array.isArray(m.stores) ? m.stores[0] : m.stores)?.store_name || "";
// 刪除人員（W01a-q1：只有草稿可刪）
const deleting = ref<any>(null);
async function removeStaff() {
  const row = deleting.value;
  if (!row) return;
  props.tab.busy = true;
  error.value = "";
  try {
    await api("monthly", { method: "POST", body: JSON.stringify({ action: "delete", id: row.id, store: props.tab.store, month: props.tab.month }) });
    deleting.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    deleting.value = null;
  } finally {
    props.tab.busy = false;
  }
}
// 送審前檢查（W01a-q2）：兼職缺時數 + 新人階段，同一個視窗
const report = ref<PreSubmitReport | null>(null);
async function startSubmit() {
  props.tab.busy = true;
  error.value = "";
  skipChecks.value = false;
  try {
    const r = await api(`monthly?${new URLSearchParams({ op: "precheck", month: props.tab.month, store: props.tab.store })}`);
    if (r.report?.hasIssues) report.value = r.report;
    else confirmation.value = "submit";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
function editById(id: string) {
  const row = rows.value.find((r) => r.id === id);
  report.value = null;
  if (row) edit(row);
}
function submitAnyway() {
  report.value = null;
  skipChecks.value = true;
  confirmation.value = "submit";
}
function edit(row: any) {
  if (queryChanged.value) return;
  const tab = work.open("monthly-edit", props.tab.store, row.id);
  tab.month = props.tab.month;
  tab.title = `人員 · ${row.employee_name || row.employee_code}`;
  tab.payload = JSON.parse(JSON.stringify(row));
}
async function execute() {
  props.tab.busy = true;
  error.value = "";
  try {
    await api("monthly", {
      method: "POST",
      body: JSON.stringify({
        action: confirmation.value,
        store: props.tab.store,
        month: props.tab.month,
        ...(confirmation.value === "submit" && skipChecks.value ? { skipChecks: true } : {}),
      }),
    });
    const done = confirmation.value;
    confirmation.value = "";
    skipChecks.value = false;
    await load();
    // 舊版：確認後自動跳到下一間未確認門市
    if (done === "confirm") {
      const next = nextUnconfirmedStore(stores.value, props.tab.store, summaries.value);
      if (next) {
        props.tab.store = next;
        await load();
      }
    }
  } catch (e) {
    error.value = (e as Error).message;
    confirmation.value = "";
    skipChecks.value = false;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
// 單人編輯儲存後回到本分頁：重新讀取名冊（有未完成操作時不打斷）。
watch(
  () => work.monthlyRevision,
  () => {
    if (!loading.value && !props.tab.busy && props.tab.store) void load();
  },
);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">人員 / 每月狀態</p>
      <h1>每月人員狀態</h1>
      <p class="muted">查詢門市名冊、維護出勤並提交確認。</p>
    </div>
    <div class="monthly-global-actions"><div ref="globalToolsTarget"/></div>
  </header>
  <section v-if="stats" class="monthly-stats" aria-label="本月門市統計">
    <div class="stat-card"><span>總門市數</span><strong data-stat="total">{{ stats.total }}</strong></div>
    <div class="stat-card"><span>已確認</span><strong data-stat="confirmed">{{ stats.confirmed }}</strong></div>
    <div class="stat-card"><span>已提交</span><strong data-stat="submitted">{{ stats.submitted }}</strong></div>
    <div class="stat-card"><span>待填寫</span><strong data-stat="pending">{{ stats.pending }}</strong></div>
  </section>
  <div v-if="showTabs" class="store-tabs-bar">
    <div class="store-tabs" role="tablist" aria-label="門市狀態頁籤">
      <button
        v-for="s in visibleStores"
        :key="s.id"
        role="tab"
        type="button"
        :aria-selected="s.id === tab.store"
        :class="{ active: s.id === tab.store, inactive: s.is_active === false }"
        :disabled="loading || tab.busy || tab.dirty"
        @click="selectStore(s.id)"
      >
        <span>{{ s.store_name }}</span>
        <em v-if="s.is_active === false" class="badge">已停止</em>
        <em v-else class="badge" :data-status="summaryOf(s.id)">{{ STORE_SUMMARY_LABELS[summaryOf(s.id)] }}</em>
      </button>
    </div>
    <button
      v-if="inactiveCount > 0"
      type="button"
      class="inactive-toggle"
      :aria-pressed="showInactive"
      :disabled="loading || tab.busy || tab.dirty"
      @click="showInactive = !showInactive"
    >
      {{ showInactive ? "隱藏已停止" : `已停止（${inactiveCount}）` }}
    </button>
  </div>
  <div class="monthly-query-actions"><form class="module-filters" @submit.prevent="load">
    <label
      >門市<select aria-label="門市" v-model="tab.store" :disabled="loading || tab.busy || tab.dirty">
        <option v-for="s in visibleStores" :value="s.id">
          {{ s.store_code }} {{ s.store_name }}{{ s.is_active === false ? "（已停止）" : "" }}
        </option>
      </select></label
    ><label>月份<input type="month" v-model="tab.month" :disabled="loading || tab.busy || tab.dirty" required /></label
    ><button class="primary" :disabled="loading || tab.busy || tab.dirty">查詢人員</button>
  </form><div class="monthly-store-actions"><div ref="storeToolsTarget"/>  <div class="module-actions"><button @click="load" :disabled="loading || tab.busy || tab.dirty">重新整理</button>
    <template v-if="permissions.canEdit && !monthLocked"
      ><button
        @click="confirmation = 'initialize'"
        :disabled="loading || queryChanged || tab.busy || !tab.store"
      >
        初始化本月人員</button
      ><button
        v-if="permissions.canRecompute && rows.length"
        data-testid="monthly-recompute"
        @click="confirmation = 'recompute'"
        :disabled="loading || queryChanged || tab.busy || !tab.store"
      >
        依異動重算</button></template
      ><button
        v-if="permissions.canSubmit && rowsAllow(rows, 'submit')"
        class="primary"
        @click="startSubmit"
        :disabled="loading || queryChanged || tab.busy"
      >
        送出審核
      </button
    ><button
      v-if="permissions.canConfirm && rowsAllowAll(rows, 'confirm')"
      @click="confirmation = 'confirm'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      確認本月狀態</button
    ><button
      v-if="permissions.canRevert && rowsAllowAll(rows, 'revert')"
      @click="confirmation = 'revert'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      退回草稿</button
    ><button
      v-if="permissions.canUnconfirm && rowsAllowAll(rows, 'unconfirm')"
      @click="confirmation = 'unconfirm'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      取消確認</button
    ><span class="muted">{{ rows.length }} 位人員</span>
  </div>
</div></div>
  <div v-if="error" class="notice error" role="alert">
    {{ error }} <button @click="load">重試</button>
  </div>
  <p v-if="queryChanged && !loading" class="notice">
    條件已變更，請按「查詢人員」更新資料後再操作。
  </p>
  <p v-if="permissions.storeActive === false && !loading && !error" class="notice">此為已停止門市的歷史資料，僅供查看。</p>
  <section v-if="recheck.length && !loading" class="roster-panel recheck" data-testid="monthly-recheck" aria-label="需重新確認">
    <h2>需重新確認（{{ recheck.length }}）</h2>
    <p class="muted">異動已登記，但下列月份已送審或已確認，名冊沒有被更動。請將該月份退回草稿後，按「依異動重算」。</p>
    <ul>
      <li v-for="x in recheck" :key="x.id"><strong>{{ x.year_month }}</strong> {{ x.employee_code }} {{ x.employee_name }}：{{ fieldLabels[x.field] || x.field }} {{ fieldValue(x.field, x.old_value) }} → {{ fieldValue(x.field, x.new_value) }}<small>{{ x.reason_label }}</small></li>
    </ul>
  </section>
  <section v-if="adjustments.length && !loading" class="roster-panel adjusted" data-testid="monthly-adjustments" aria-label="近期因異動自動調整">
    <h2>近期因異動自動調整（{{ adjustments.length }}）</h2>
    <p class="muted">下列欄位已依人員異動覆蓋原本的內容（含店長手動修改過的資料），僅供核對，不會另外通知。</p>
    <ul>
      <li v-for="a in adjustments" :key="a.id">{{ a.employee_code }} {{ a.employee_name }}：{{ fieldLabels[a.field] || a.field }} {{ fieldValue(a.field, a.old_value) }} → {{ fieldValue(a.field, a.new_value) }}<small>{{ a.movement_label }}</small></li>
    </ul>
  </section>
  <MonthlyTools :global-target="globalToolsTarget" :store-target="storeToolsTarget" :tab="tab" :rows="rows" :month-state="monthState" :options="permissions.options || {}" :revision="revision" :meta="permissions.meta" :disabled="loading || queryChanged || !tab.store || !!error || permissions.storeActive === false" @refresh="load" />
  <p v-if="loading" role="status">載入人員資料…</p>
  <TopScrollTable v-else-if="!error" label="人員狀態表格" class="monthly-table">
    <table>
      <thead>
        <tr>
          <th class="sticky-name">員編 / 姓名</th>
          <th>職位</th>
          <th>僱用類型／到職日</th>
          <th>本月狀態</th>
          <th>天數/時數</th>
          <th>特殊標記</th>
          <template v-if="canPerf">
            <th>上月單品獎金</th>
            <th>計算區塊</th>
            <th>交易次數</th>
            <th>銷售金額</th>
            <th>毛利／毛利率</th>
          </template>
          <th>審核狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="r in rows" :key="r.id">
        <tr :class="{ manual: r.is_manually_added }" :data-staff="r.employee_code">
          <td class="sticky-name">
            {{ r.employee_code }}<br />
            <button type="button" class="link-button" title="點擊查看異動歷程" :aria-label="`查看 ${r.employee_name} 的異動歷程`" @click="openMovement(r)"><strong>{{ r.employee_name }}</strong></button>
            <span v-if="r.is_manually_added" class="tag manual-tag">手動新增</span>
          </td>
          <td>{{ r.position }}<span v-if="levelSuffix(r.position, r.newbie_level)" class="level" :class="{ missing: levelSuffix(r.position, r.newbie_level)!.missing }">（{{ levelSuffix(r.position, r.newbie_level)!.text }}）</span></td>
          <td>{{ r.employment_type === "part_time" ? "兼職" : "正職" }}<span v-if="r.is_pharmacist" class="tag">藥師</span><br />{{ r.start_date || "—" }}</td>
          <td>{{ labels[r.monthly_status] || r.monthly_status }}<small v-if="r.movement_hint" class="movement-hint" data-testid="movement-hint">{{ r.movement_hint }}</small></td>
          <td data-cell="workload">{{ workloadText(r) }}</td>
          <td><span class="tags"><span v-for="t in staffTags(r)" :key="t.key" class="tag" :data-tag="t.key">{{ t.label }}</span><span v-if="adjustedCodes.has(r.employee_code)" class="tag" data-tag="adjusted">異動調整</span><template v-if="!staffTags(r).length && !adjustedCodes.has(r.employee_code)">—</template></span></td>
          <template v-if="canPerf">
            <td>{{ r.last_month_single_item_bonus ? `$${r.last_month_single_item_bonus.toLocaleString()}` : "—" }}</td>
            <td>{{ r.calculated_block ? `區塊 ${r.calculated_block}` : "—" }}</td>
            <td>{{ r.transaction_count ? r.transaction_count.toLocaleString() : "—" }}</td>
            <td>{{ r.sales_amount ? `$${r.sales_amount.toLocaleString()}` : "—" }}</td>
            <td>{{ r.gross_profit ? `$${Math.round(r.gross_profit).toLocaleString()}` : "—" }}<br />{{ r.gross_profit_rate ? `${r.gross_profit_rate}%` : "—" }}
              <button v-if="canExpandPerformance(r, canPerf)" type="button" class="expand" :aria-expanded="expanded.has(r.id)" :aria-label="expanded.has(r.id) ? '收合各門市業績明細' : '展開各門市業績明細'" :disabled="detailBusy === r.id" @click="toggleDetails(r)">{{ expanded.has(r.id) ? "收合" : "展開" }}</button>
            </td>
          </template>
          <td>{{ status[r.status] || r.status }}</td>
          <td class="row-actions">
            <button @click="edit(r)" :disabled="queryChanged">
              {{ rowEditable ? "編輯" : "查看明細" }}
            </button>
            <button v-if="rowEditable" type="button" class="danger" :disabled="queryChanged || tab.busy" @click="deleting = r">刪除</button>
          </td>
        </tr>
        <tr v-if="expanded.has(r.id)" class="detail-row">
          <td :colspan="colCount">
            <div class="detail-box">
              <strong>各門市業績明細</strong>
              <p v-if="!staffDetails[r.id]?.length" class="muted">沒有各門市明細。</p>
              <table v-else>
                <thead><tr><th>門市</th><th>交易次數</th><th>銷售金額</th><th>毛利</th><th>毛利率</th></tr></thead>
                <tbody>
                  <tr v-for="(d, i) in staffDetails[r.id]" :key="i">
                    <td>{{ d.store_code }}<span v-if="d.is_from_file2" class="tag">處方加購回補</span></td>
                    <td>{{ d.transaction_count?.toLocaleString() || "-" }}</td>
                    <td>${{ d.sales_amount?.toLocaleString() || "0" }}</td>
                    <td>${{ Math.round(d.gross_profit || 0).toLocaleString() }}</td>
                    <td>{{ d.gross_profit_rate || "0" }}%</td>
                  </tr>
                  <tr class="total"><td>合計</td><td>{{ r.transaction_count?.toLocaleString() }}</td><td>${{ r.sales_amount?.toLocaleString() }}</td><td>${{ Math.round(r.gross_profit || 0).toLocaleString() }}</td><td>{{ r.gross_profit_rate }}%</td></tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="colCount">此門市本月尚無人員資料。</td>
        </tr>
      </tbody>
    </table>
  </TopScrollTable>
  <Modal
    v-if="confirmation"
    :title="actions[confirmation]"
    :busy="tab.busy"
    @cancel="confirmation = ''; skipChecks = false"
    ><p>即將處理 {{ tab.month }} 的門市人員資料。請確認目前門市與月份。</p>
    <p v-if="confirmation === 'submit'" class="muted">提交後店長將無法再修改。</p>
    <p v-if="confirmation === 'recompute'" class="muted">會依人員異動重算本月名冊的職位、階段、狀態與天數，並以異動為準覆蓋手動修改（變更會列在「近期因異動自動調整」）。</p>
    <p v-if="confirmation === 'confirm'" class="muted">確認後資料將用於獎金計算；確認後會自動跳到下一間未確認的門市。</p>
    <div class="dialog-actions">
      <button @click="confirmation = ''; skipChecks = false" :disabled="tab.busy">取消</button
      ><button class="primary" @click="execute" :disabled="tab.busy">
        確認執行
      </button>
    </div></Modal
  >
  <Modal v-if="report" title="送審前檢查" :busy="tab.busy" @cancel="report = null">
    <p>送出前請先確認以下項目。可以先去編輯補齊，也可以確認無誤後仍要送出。</p>
    <section v-if="report.partTimeMissingHours.length" aria-label="兼職缺時數">
      <h3>兼職人員尚未填寫本月工作時數（空白或 0）</h3>
      <ul class="check-list">
        <li v-for="p in report.partTimeMissingHours" :key="p.id"><span>{{ p.employee_code }} {{ p.employee_name }}</span><button type="button" @click="editById(p.id)">去編輯</button></li>
      </ul>
    </section>
    <section v-if="report.newbiesNeedCheck.length" aria-label="新人階段確認">
      <h3>需確認階段的新人</h3>
      <ul class="check-list">
        <li v-for="n in report.newbiesNeedCheck" :key="n.id"><span>{{ n.employee_code }} {{ n.employee_name }}<br /><small>到職日 {{ n.start_date }}・目前登記為 {{ n.current_level }}・建議：{{ n.suggested_action }}</small></span><button type="button" @click="editById(n.id)">去編輯</button></li>
      </ul>
    </section>
    <div class="dialog-actions">
      <button @click="report = null" :disabled="tab.busy">返回補填</button
      ><button class="primary" @click="submitAnyway" :disabled="tab.busy">確認無誤，仍要送出</button>
    </div>
  </Modal>
  <Modal v-if="deleting" title="刪除人員" :busy="tab.busy" @cancel="deleting = null">
    <p>{{ deleting.is_manually_added ? `確定要刪除手動新增的員工「${deleting.employee_name}」？` : `確定要從本月狀態中移除員工「${deleting.employee_name}」？` }}此操作無法復原。</p>
    <p class="muted">只有草稿狀態可以刪除；已送審或已確認需先退回草稿。</p>
    <div class="dialog-actions">
      <button @click="deleting = null" :disabled="tab.busy">取消</button
      ><button class="primary" @click="removeStaff" :disabled="tab.busy">確認刪除</button>
    </div>
  </Modal>
  <Modal v-if="movement" title="人員異動歷程" @cancel="movement = null">
    <p class="muted">{{ movement.name }}（{{ movement.code }}）</p>
    <p v-if="movementBusy" role="status">載入中…</p>
    <p v-else-if="movementError" class="notice error" role="alert">{{ movementError }}</p>
    <p v-else-if="!movementRows.length">尚無異動記錄</p>
    <ol v-else class="movement-list">
      <li v-for="m in movementRows" :key="m.id">
        <div><strong>{{ m.movement_date }}</strong> <span class="tag">{{ movementTypeLabel(m.movement_type, m.new_value) }}</span> <span v-if="movementStore(m)" class="tag">{{ movementStore(m) }}</span></div>
        <p v-if="m.movement_type === 'onboarding' && movementStore(m)">入職門市：{{ movementStore(m) }}</p>
        <p v-if="m.movement_type === 'promotion' && m.new_value">升至：{{ formatPromotionPosition(m.new_value, m.notes) }}</p>
        <p v-if="m.movement_type === 'acting_manager'">代理職位：代理店長</p>
        <p v-if="m.movement_type === 'store_transfer' && (m.old_value || m.new_value)">調店：{{ m.old_value || "未知" }} → {{ m.new_value || "未知" }}</p>
        <p v-if="getMovementNotesForDisplay(m.notes)" class="muted">備註：{{ getMovementNotesForDisplay(m.notes) }}</p>
      </li>
    </ol>
    <div class="dialog-actions"><button @click="movement = null">關閉</button></div>
  </Modal>
</template>

<style scoped>
.monthly-global-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;max-width:100%}.monthly-query-actions{display:grid;grid-template-columns:minmax(460px,auto) minmax(0,1fr);gap:24px;align-items:start;margin-bottom:20px}.monthly-query-actions .module-filters{margin:0;align-items:end;flex-wrap:wrap}.monthly-store-actions{min-width:0}.monthly-store-actions .module-actions{flex-wrap:wrap;margin:8px 0 0}.monthly-store-actions :deep(.monthly-tools){margin:0}.monthly-global-actions :deep(.monthly-tools){margin:0;justify-content:flex-end}@media(max-width:1200px){.monthly-query-actions{grid-template-columns:1fr}.monthly-global-actions{justify-content:flex-start}}@media(max-width:650px){.monthly-query-actions .module-filters{display:flex;flex-wrap:wrap}.monthly-query-actions .module-filters label{min-width:0;flex:1 1 160px}.monthly-query-actions select,.monthly-query-actions input{width:100%;min-width:0}}
.monthly-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}.stat-card{border:1px solid var(--line);background:var(--surface);padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}.stat-card span{font-size:12px;color:var(--muted)}.stat-card strong{font-size:24px}
.store-tabs-bar{display:flex;align-items:stretch;gap:8px;margin:0 0 16px;min-width:0;border-bottom:1px solid var(--line)}.store-tabs{display:flex;overflow-x:auto;flex:1 1 auto;min-width:0;-webkit-overflow-scrolling:touch}.store-tabs>button{flex:0 0 auto;white-space:nowrap;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:10px 14px;display:flex;gap:8px;align-items:center}.store-tabs>button.active{border-bottom-color:var(--primary);color:var(--primary);background:var(--soft)}.store-tabs>button.inactive{color:var(--muted)}.store-tabs .badge{font-style:normal;font-size:12px;padding:1px 8px;border-radius:10px;background:var(--soft);color:var(--ink)}.store-tabs .badge[data-status=confirmed]{background:#d8ecd3;color:#1f4d1a}.store-tabs .badge[data-status=submitted]{background:#d6e6f7;color:#1b4470}.store-tabs .badge[data-status=in_progress]{background:#f7ebc2;color:#5c4710}.inactive-toggle{flex:0 0 auto;align-self:center;font-size:12px;white-space:nowrap}
.sticky-name{position:sticky;left:0;z-index:2;background:var(--surface)}th.sticky-name{z-index:3}.monthly-table table{min-width:1500px}.link-button{border:0;background:transparent;padding:0;min-height:0;color:inherit;text-decoration:underline dotted;cursor:pointer}.tag{display:inline-block;font-size:12px;padding:1px 6px;margin:0 2px 2px;border-radius:4px;background:var(--soft);color:var(--ink)}.tags{display:flex;flex-wrap:wrap;gap:2px}.manual-tag{background:#fbe3c4;color:#6a3b05}.level{font-size:12px;color:var(--primary)}.level.missing{color:var(--danger);font-weight:600}tr.manual td{background:color-mix(in srgb,#fbe3c4 22%,transparent)}tr.manual td.sticky-name{background:var(--surface)}.row-actions{display:flex;gap:6px;flex-wrap:nowrap}.row-actions .danger{color:var(--danger)}.expand{margin-left:6px;font-size:12px;padding:2px 8px;min-height:0}
.detail-row td{background:var(--soft)}.detail-box{padding:6px 0 6px 24px}.detail-box table{min-width:0;width:auto;background:var(--surface)}.detail-box .total td{font-weight:600}
.check-list{list-style:none;padding:0;margin:8px 0 16px}.check-list li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.movement-list{list-style:none;padding:0;margin:12px 0;max-height:50vh;overflow:auto}.movement-list li{padding:10px 0;border-bottom:1px solid var(--line)}.movement-list p{margin:4px 0}
.roster-panel{border:1px solid var(--line);background:var(--surface);padding:12px 16px;margin:0 0 16px}.roster-panel h2{font-size:16px;margin:0 0 6px}.roster-panel ul{margin:8px 0 0;padding-left:18px;max-height:240px;overflow:auto}.roster-panel li{margin:4px 0}.roster-panel small{display:block;color:var(--muted)}.roster-panel.recheck{border-color:#e0b04a}.movement-hint{display:block;font-size:12px;color:var(--danger)}
@media(max-width:650px){.monthly-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.store-tabs-bar{flex-wrap:wrap}.check-list li{flex-wrap:wrap}.detail-box{padding-left:0}}
</style>
