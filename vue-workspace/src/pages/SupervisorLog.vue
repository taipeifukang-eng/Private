<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, ApiError } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import { taipeiDate } from "../../../lib/supervisor-management-log/workspace-rules";

// 督導管理日誌（M6 W32）：今日工作台（每日計畫、追蹤佇列、今日紀錄）與管理案件（建立、紀錄、追蹤、時間線、修改、軟刪除）。
// 可見範圍（E1）與修改刪除規則（E2）由伺服端判斷，畫面只依回傳的 can_edit／can_delete／permissions 顯示按鈕；沒有權限的按鈕不出現。
// 語音錄音與 AI 摘要（W33）不在這一頁，另案處理。
const props = defineProps<{ tab: WorkTab }>();
type Caps = { viewOwn: boolean; viewTeam: boolean; create: boolean; updateOwn: boolean; followUp: boolean; manage: boolean };
type Viewer = { tier: "all" | "team" | "own" | "none"; caps: Caps; user_id: string };
type Store = { id: string; store_code: string; store_name: string; short_name?: string | null };
type Employee = { id: string; store_id: string | null; employee_code: string | null; employee_name: string | null };
type Category = { id: string; code: string; name: string };
type Person = { id: string; full_name: string | null; email: string | null } | null;
type Case = {
  id: string; case_no: string | null; title: string; category_id: string | null; owner_user_id: string; assigned_user_id: string | null; target_type: string;
  store_id: string | null; employee_id: string | null; target_name_snapshot: string; status: string; priority: string; next_follow_up_at: string | null;
  summary: string | null; opened_at: string; updated_at: string; category?: Category | null; store?: Store | null; owner?: Person; assigned_user?: Person; can_edit?: boolean; can_delete?: boolean;
};
type Rec = {
  id: string; record_type: string; record_date: string; observation: string; judgment: string; action_summary: string; action_options: string[] | null;
  requires_follow_up: boolean; follow_up_date: string | null; expected_result: string | null; follow_up_method: string | null; ai_generated: boolean | null;
  created_at: string; can_edit?: boolean; can_delete?: boolean; deleted_at?: string | null;
};
type Followup = { id: string; source_record_id: string | null; follow_up_date: string; result_status: string; result_notes: string; next_follow_up_date: string | null; created_at: string; can_delete?: boolean };
type TimelineItem = { at: string; type: string; title: string; body: string | null; source: string };
type Detail = Case & { records: Rec[]; followups: Followup[]; timeline: TimelineItem[]; permissions: { edit: boolean; delete: boolean; add_record: boolean; add_followup: boolean }; deletion_reason?: string | null; deleted_at?: string | null };
type Plan = {
  id: string; plan_date: string; owner_user_id: string; target_type: string; store_id: string | null; employee_id: string | null; target_name_snapshot: string; category_id: string | null;
  title: string; status: string; started_at: string | null; completed_at: string | null; linked_case_id: string | null; notes: string | null;
  category?: Category | null; owner?: Person; linked_case?: { id: string; case_no: string | null; title: string; status: string } | null; can_edit?: boolean; can_delete?: boolean;
};
type QueueCase = Case & { bucket: "overdue" | "today" | "upcoming"; latest_record?: { observation: string | null; action_summary: string | null; record_date: string } | null };
type Today = {
  date: string; plans: Plan[]; followUpQueue: QueueCase[]; todayRecords: (Rec & { case?: { id: string; title: string; case_no: string | null } | null; target_name_snapshot?: string })[];
  summary: { plans: { total: number; planned: number; inProgress: number; done: number; cancelled: number }; followUps: { total: number; overdue: number; today: number; upcoming: number }; records: { total: number } };
};

const STATUS: Record<string, string> = { OPEN: "待處理", FOLLOW_UP: "待追蹤", IMPROVING: "改善中", RESOLVED: "已改善", CLOSED: "已結案", CANCELLED: "已取消" };
const PRIORITY: Record<string, string> = { LOW: "低", NORMAL: "一般", HIGH: "高", URGENT: "緊急" };
const TARGET: Record<string, string> = { STORE: "門市", EMPLOYEE: "人員", AREA: "區域", CROSS_DEPARTMENT: "跨部門", OTHER: "其他" };
const RECORD_TYPE: Record<string, string> = { MANAGEMENT: "管理紀錄", FOLLOW_UP: "追蹤安排", RESULT: "結果紀錄", NOTE: "備註" };
const METHOD: Record<string, string> = { ONSITE: "現場訪查", PHONE: "電話追蹤", MESSAGE: "LINE / 訊息", MEETING: "會議追蹤", SYSTEM: "系統紀錄", OTHER: "其他" };
const FU_STATUS: Record<string, string> = { IMPROVED: "已改善", IMPROVING: "改善中", NOT_IMPROVED: "未改善", POSTPONED: "延後追蹤", CLOSED: "結案" };
const PLAN_STATUS: Record<string, string> = { PLANNED: "尚未開始", IN_PROGRESS: "處理中", DONE: "已完成", CANCELLED: "已取消" };
const BUCKET: Record<string, string> = { overdue: "已逾期", today: "今天到期", upcoming: "七天內" };
const ACTION_OPTIONS = ["現場說明", "主管約談", "教育訓練", "限期改善", "跨部門協調", "文件補正", "持續追蹤"];
const TIER: Record<string, string> = { all: "全部案件（管理者）", team: "自己負責門市的案件", own: "自己建立或指派給自己的案件", none: "" };

const viewer = ref<Viewer | null>(null);
const section = ref<"today" | "cases">("today");
const error = ref(""), message = ref("");
const categories = ref<Category[]>([]), stores = ref<Store[]>([]), employees = ref<Employee[]>([]);
const today = ref<Today | null>(null), todayLoading = ref(false);
const cases = ref<Case[]>([]), meta = ref({ page: 1, pageSize: 20, total: 0, totalPages: 1 }), casesLoading = ref(false);
const filters = ref({ status: "", targetType: "", search: "" });
const searchInput = ref("");
const detail = ref<Detail | null>(null), detailLoading = ref(false);
const todayKey = computed(() => taipeiDate(new Date()));
const caps = computed(() => viewer.value?.caps);
const canCreate = computed(() => !!caps.value && (caps.value.create || caps.value.manage));
const canWritePlans = computed(() => canCreate.value);
const fmtDate = (v?: string | null) => (v ? v.slice(0, 10) : "-");
const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");
const storeLabel = (s?: Store | null) => (s ? `${s.store_code} ${s.short_name || s.store_name}`.trim() : "");
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/* ── 載入 ── */
async function loadOptions() {
  try {
    const d = await api<any>("supervisor-management/options");
    categories.value = d.data.categories;
    stores.value = d.data.stores;
  } catch (e) {
    error.value = errText(e, "載入選項失敗");
  }
}
let todaySeq = 0;
async function loadToday() {
  const mine = ++todaySeq;
  todayLoading.value = true;
  try {
    const d = await api<any>(`supervisor-management/today?date=${todayKey.value}`);
    if (mine !== todaySeq) return;
    today.value = d.data;
    viewer.value = d.viewer;
  } catch (e) {
    if (mine === todaySeq) error.value = errText(e, "載入今日工作台失敗");
  } finally {
    if (mine === todaySeq) todayLoading.value = false;
  }
}
let casesSeq = 0;
async function loadCases(page = meta.value.page) {
  const mine = ++casesSeq;
  casesLoading.value = true;
  try {
    const q = new URLSearchParams({ page: String(page), pageSize: String(meta.value.pageSize), sortBy: "updated_at", sortOrder: "desc" });
    if (filters.value.status) q.set("status", filters.value.status);
    if (filters.value.targetType) q.set("targetType", filters.value.targetType);
    if (filters.value.search) q.set("search", filters.value.search);
    const d = await api<any>("supervisor-management/cases?" + q);
    if (mine !== casesSeq) return;
    cases.value = d.data;
    meta.value = d.meta;
    viewer.value = d.viewer;
  } catch (e) {
    if (mine === casesSeq) error.value = errText(e, "載入案件失敗");
  } finally {
    if (mine === casesSeq) casesLoading.value = false;
  }
}
async function openCase(id: string) {
  detailLoading.value = true;
  error.value = "";
  try {
    const d = await api<any>(`supervisor-management/cases/${id}`);
    detail.value = d.data;
    return d.data as Detail;
  } catch (e) {
    error.value = errText(e, "載入案件詳情失敗");
    detail.value = null;
    return null;
  } finally {
    detailLoading.value = false;
  }
}
/** 重新載入已開啟的案件詳情；載入期間使用者關掉或換開別的案件時，不會把舊案件再打開。 */
async function reloadDetail(id: string) {
  try {
    const d = await api<any>(`supervisor-management/cases/${id}`);
    if (detail.value?.id === id) detail.value = d.data;
  } catch (e) {
    if (detail.value?.id === id) {
      detail.value = null;
      error.value = errText(e, "載入案件詳情失敗");
    }
  }
}
async function refreshAll(reopen = true) {
  const id = detail.value?.id;
  await Promise.all([loadToday(), loadCases()]);
  // 重新整理期間使用者若已關掉或換開別的案件，就不要再把舊案件打開
  if (reopen && id && detail.value?.id === id) await reloadDetail(id);
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    filters.value.search = searchInput.value.trim();
    void loadCases(1);
  }, 300);
});
onBeforeUnmount(() => clearTimeout(timer));
function setStatus(s: string) {
  filters.value.status = s;
  void loadCases(1);
}

/* ── 共用：送出與刪除 ── */
const formError = ref("");
async function run(fn: () => Promise<void>, fail: string) {
  if (props.tab.busy) return;
  props.tab.busy = true;
  formError.value = "";
  try {
    await fn();
  } catch (e) {
    formError.value = errText(e, fail);
  } finally {
    props.tab.busy = false;
  }
}
const post = (path: string, method: string, body?: unknown) => api(`supervisor-management/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

type DeleteTarget = { kind: "case" | "record" | "followup" | "plan"; id: string; label: string; caseId?: string };
const delTarget = ref<DeleteTarget | null>(null), delReason = ref("");
function askDelete(t: DeleteTarget) {
  delTarget.value = t;
  delReason.value = "";
  formError.value = "";
}
async function confirmDelete() {
  const t = delTarget.value;
  if (!t) return;
  if (!delReason.value.trim()) return void (formError.value = "請輸入刪除原因");
  await run(async () => {
    const path = t.kind === "case" ? `cases/${t.id}` : t.kind === "record" ? `cases/${t.caseId}/records/${t.id}` : t.kind === "followup" ? `cases/${t.caseId}/followups/${t.id}` : `daily-plans/${t.id}`;
    await post(path, "DELETE", { deletion_reason: delReason.value.trim() });
    message.value = `已刪除${t.label}（保留刪除紀錄與時間線事件）`;
    delTarget.value = null;
    if (t.kind === "case") detail.value = null;
    await refreshAll(t.kind !== "case");
  }, "刪除失敗");
}

/* ── 案件表單（建立、編輯） ── */
const caseOpen = ref(false);
const emptyCase = () => ({ title: "", target_type: "STORE", store_id: "", employee_id: "", category_id: "", target_name_snapshot: "", priority: "NORMAL", next_follow_up_at: "", summary: "" });
const caseForm = ref(emptyCase());
let empSeq = 0;
async function loadEmployees(storeId: string, q = "") {
  const mine = ++empSeq;
  employees.value = [];
  if (!storeId && !q) return;
  try {
    const p = new URLSearchParams();
    if (storeId) p.set("store_id", storeId);
    else p.set("q", q);
    const d = await api<any>("supervisor-management/options?" + p);
    if (mine === empSeq) employees.value = d.data.employees;
  } catch {
    if (mine === empSeq) employees.value = [];
  }
}
function openCaseForm() {
  caseForm.value = emptyCase();
  employees.value = [];
  formError.value = "";
  caseOpen.value = true;
}
function onTargetType(f: { target_type: string; store_id: string; employee_id: string; target_name_snapshot: string }) {
  f.store_id = "";
  f.employee_id = "";
  f.target_name_snapshot = "";
  employees.value = [];
}
function onStore(f: { target_type: string; store_id: string; employee_id: string; target_name_snapshot: string }) {
  f.employee_id = "";
  const s = stores.value.find((x) => x.id === f.store_id);
  if (f.target_type === "STORE" && s) f.target_name_snapshot = storeLabel(s);
  void loadEmployees(f.store_id);
}
function onEmployee(f: { target_type: string; store_id: string; employee_id: string; target_name_snapshot: string }) {
  const e = employees.value.find((x) => x.id === f.employee_id);
  if (e) {
    f.target_name_snapshot = `${e.employee_code || ""} ${e.employee_name || ""}`.trim();
    if (e.store_id) f.store_id = e.store_id;
  }
}
const empSearch = ref("");
let empTimer: ReturnType<typeof setTimeout> | undefined;
watch(empSearch, () => {
  clearTimeout(empTimer);
  empTimer = setTimeout(() => void loadEmployees("", empSearch.value.trim()), 250);
});
onBeforeUnmount(() => clearTimeout(empTimer));
async function submitCase() {
  const f = caseForm.value;
  if (!f.title.trim()) return void (formError.value = "請輸入案件標題");
  await run(async () => {
    await post("cases", "POST", { ...f, store_id: f.store_id || null, employee_id: f.employee_id || null, category_id: f.category_id || null, next_follow_up_at: f.next_follow_up_at || null, summary: f.summary || null });
    caseOpen.value = false;
    message.value = "督導管理案件已建立";
    section.value = "cases";
    await loadCases(1);
    await loadToday();
  }, "建立案件失敗");
}
const editOpen = ref(false);
const editForm = ref({ title: "", category_id: "", status: "OPEN", priority: "NORMAL", next_follow_up_at: "", summary: "" });
function openEdit() {
  const d = detail.value;
  if (!d) return;
  editForm.value = { title: d.title, category_id: d.category_id || "", status: d.status, priority: d.priority, next_follow_up_at: d.next_follow_up_at ? d.next_follow_up_at.slice(0, 10) : "", summary: d.summary || "" };
  formError.value = "";
  editOpen.value = true;
}
async function submitEdit() {
  const d = detail.value;
  if (!d) return;
  const f = editForm.value;
  if (!f.title.trim()) return void (formError.value = "請輸入案件標題");
  await run(async () => {
    await post(`cases/${d.id}`, "PATCH", { title: f.title, category_id: f.category_id || null, status: f.status, priority: f.priority, next_follow_up_at: f.next_follow_up_at || null, summary: f.summary || null });
    editOpen.value = false;
    message.value = "案件已更新";
    await refreshAll();
  }, "更新案件失敗");
}

/* ── 管理紀錄 ── */
const recOpen = ref(false), recEditing = ref<Rec | null>(null);
const emptyRec = () => ({ record_type: "MANAGEMENT", record_date: todayKey.value, observation: "", judgment: "", action_summary: "", action_options: [] as string[], requires_follow_up: false, follow_up_date: "", expected_result: "", follow_up_method: "" });
const recForm = ref(emptyRec());
function openRecord(rec?: Rec, prefill?: Partial<ReturnType<typeof emptyRec>>) {
  recEditing.value = rec || null;
  recForm.value = rec
    ? { record_type: rec.record_type, record_date: rec.record_date, observation: rec.observation, judgment: rec.judgment, action_summary: rec.action_summary, action_options: [...(rec.action_options || [])], requires_follow_up: rec.requires_follow_up, follow_up_date: rec.follow_up_date || "", expected_result: rec.expected_result || "", follow_up_method: rec.follow_up_method || "" }
    : { ...emptyRec(), ...prefill };
  formError.value = "";
  recOpen.value = true;
}
function toggleOption(o: string) {
  const list = recForm.value.action_options;
  recForm.value.action_options = list.includes(o) ? list.filter((x) => x !== o) : [...list, o];
}
async function submitRecord() {
  const d = detail.value;
  const f = recForm.value;
  if (!d) return;
  if (!f.observation.trim() || !f.judgment.trim() || !f.action_summary.trim()) return void (formError.value = "發現或觀察、管理判斷、管理動作都要填寫");
  if (f.requires_follow_up && (!f.follow_up_date || !f.expected_result.trim())) return void (formError.value = "需要追蹤時，請填寫追蹤日期與預期結果");
  await run(async () => {
    const body = { ...f, follow_up_date: f.requires_follow_up ? f.follow_up_date : null, expected_result: f.requires_follow_up ? f.expected_result : null, follow_up_method: f.requires_follow_up ? f.follow_up_method || null : null };
    if (recEditing.value) await post(`cases/${d.id}/records/${recEditing.value.id}`, "PATCH", body);
    else await post(`cases/${d.id}/records`, "POST", body);
    recOpen.value = false;
    message.value = recEditing.value ? "管理紀錄已更新" : "管理紀錄已新增";
    await refreshAll();
  }, "儲存管理紀錄失敗");
}

/* ── 追蹤 ── */
const fuOpen = ref(false);
const fuForm = ref({ source_record_id: "", follow_up_date: "", result_status: "IMPROVING", result_notes: "", next_follow_up_date: "" });
function openFollowup(sourceId = "") {
  fuForm.value = { source_record_id: sourceId || detail.value?.records?.[0]?.id || "", follow_up_date: todayKey.value, result_status: "IMPROVING", result_notes: "", next_follow_up_date: "" };
  formError.value = "";
  fuOpen.value = true;
}
async function submitFollowup() {
  const d = detail.value;
  const f = fuForm.value;
  if (!d) return;
  if (!f.result_notes.trim()) return void (formError.value = "請輸入追蹤結果說明");
  await run(async () => {
    await post(`cases/${d.id}/followups`, "POST", { ...f, source_record_id: f.source_record_id || null, next_follow_up_date: f.next_follow_up_date || null });
    fuOpen.value = false;
    message.value = "追蹤結果已新增";
    await refreshAll();
  }, "新增追蹤結果失敗");
}
async function quickFollowup(c: QueueCase) {
  const d = await openCase(c.id);
  if (d) openFollowup();
}

/* ── 每日計畫（E3） ── */
const planOpen = ref(false), planEditing = ref<Plan | null>(null);
const emptyPlan = () => ({ plan_date: todayKey.value, target_type: "STORE", store_id: "", employee_id: "", target_name_snapshot: "", category_id: "", title: "", notes: "", linked_case_id: "" });
const planForm = ref(emptyPlan());
const linkable = ref<Case[]>([]);
async function openPlan(p?: Plan) {
  planEditing.value = p || null;
  planForm.value = p
    ? { plan_date: p.plan_date, target_type: p.target_type, store_id: p.store_id || "", employee_id: p.employee_id || "", target_name_snapshot: p.target_name_snapshot, category_id: p.category_id || "", title: p.title, notes: p.notes || "", linked_case_id: p.linked_case_id || "" }
    : emptyPlan();
  employees.value = [];
  formError.value = "";
  planOpen.value = true;
  try {
    const d = await api<any>("supervisor-management/cases?pageSize=100&sortBy=updated_at&sortOrder=desc");
    linkable.value = (d.data as Case[]).filter((c) => c.status !== "CLOSED" && c.status !== "CANCELLED");
  } catch {
    linkable.value = [];
  }
}
async function submitPlan() {
  const f = planForm.value;
  if (!f.title.trim()) return void (formError.value = "請輸入今日管理事項");
  if (!f.target_name_snapshot.trim()) return void (formError.value = "請選擇管理對象");
  await run(async () => {
    const body = { ...f, store_id: f.store_id || null, employee_id: f.employee_id || null, category_id: f.category_id || null, linked_case_id: f.linked_case_id || null, notes: f.notes || null };
    if (planEditing.value) await post(`daily-plans/${planEditing.value.id}`, "PATCH", body);
    else await post("daily-plans", "POST", body);
    planOpen.value = false;
    message.value = planEditing.value ? "今日管理規劃已更新" : "今日管理規劃已建立";
    await loadToday();
  }, "儲存今日管理規劃失敗");
}
async function setPlanStatus(p: Plan, status: string) {
  await run(async () => {
    const now = new Date().toISOString();
    await post(`daily-plans/${p.id}`, "PATCH", { status, started_at: status === "IN_PROGRESS" && !p.started_at ? now : p.started_at || null, completed_at: status === "DONE" ? now : p.completed_at || null });
    message.value = status === "DONE" ? "今日管理事項已完成" : "今日管理事項狀態已更新";
    await loadToday();
  }, "更新今日管理狀態失敗");
  if (formError.value) {
    error.value = formError.value;
    formError.value = "";
  }
}
async function startPlan(p: Plan) {
  if (p.status === "PLANNED") await setPlanStatus(p, "IN_PROGRESS");
  if (!p.linked_case_id) return void (message.value = "此規劃尚未關聯管理案件；請先編輯規劃並選擇關聯案件，或到管理案件建立後再新增管理紀錄。");
  const d = await openCase(p.linked_case_id);
  if (d?.permissions.add_record) openRecord(undefined, { observation: p.title, action_summary: p.notes || "" });
}

onMounted(async () => {
  await Promise.all([loadOptions(), loadToday(), loadCases(1)]);
});
const grouped = computed(() => {
  const q = today.value?.followUpQueue || [];
  return (["overdue", "today", "upcoming"] as const).map((b) => ({ bucket: b, items: q.filter((c) => c.bucket === b) })).filter((g) => g.items.length);
});
</script>

<template>
  <section class="sml-page">
    <header class="page-heading">
      <div>
        <small>督導 / 管理日誌</small>
        <h1>督導管理日誌</h1>
        <p v-if="viewer" data-testid="tier">目前可看：{{ TIER[viewer.tier] }}</p>
      </div>
      <div class="actions">
        <button v-if="canCreate" class="primary" data-testid="new-case" :disabled="tab.busy" @click="openCaseForm">新增案件</button>
        <button :disabled="todayLoading || casesLoading" @click="refreshAll()">重新整理</button>
      </div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="message" role="status" class="notice" data-testid="message">{{ message }}</p>

    <div class="segments" role="tablist">
      <button role="tab" :aria-selected="section === 'today'" :class="{ on: section === 'today' }" data-testid="tab-today" @click="section = 'today'">今日工作台</button>
      <button role="tab" :aria-selected="section === 'cases'" :class="{ on: section === 'cases' }" data-testid="tab-cases" @click="section = 'cases'">管理案件</button>
    </div>

    <!-- 今日工作台 -->
    <div v-if="section === 'today'" data-testid="today">
      <p v-if="todayLoading && !today" role="status">載入中…</p>
      <template v-if="today">
        <p class="date-line">{{ today.date }}（台北時間）</p>
        <ul class="stats" aria-label="今日摘要">
          <li><small>今日規劃</small><strong data-stat="plans">{{ today.summary.plans.total }}</strong><small>處理中 {{ today.summary.plans.inProgress }} · 已完成 {{ today.summary.plans.done }}</small></li>
          <li class="warn"><small>已逾期追蹤</small><strong data-stat="overdue">{{ today.summary.followUps.overdue }}</strong></li>
          <li><small>今天到期</small><strong data-stat="due-today">{{ today.summary.followUps.today }}</strong></li>
          <li><small>今日紀錄</small><strong data-stat="records">{{ today.summary.records.total }}</strong></li>
        </ul>

        <div class="block-head">
          <h2>今日管理規劃</h2>
          <button v-if="canWritePlans" data-testid="new-plan" :disabled="tab.busy" @click="openPlan()">新增規劃</button>
        </div>
        <p v-if="!today.plans.length" class="empty">今天還沒有管理規劃</p>
        <div class="cards">
          <article v-for="p in today.plans" :key="p.id" class="card" :data-plan="p.title">
            <div class="card-head">
              <strong>{{ p.title }}</strong>
              <span class="badge" :class="'p-' + p.status.toLowerCase()" data-plan-status>{{ PLAN_STATUS[p.status] || p.status }}</span>
            </div>
            <small>{{ TARGET[p.target_type] }} · {{ p.target_name_snapshot }}<template v-if="p.category"> · {{ p.category.name }}</template></small>
            <small v-if="p.owner && p.owner.id !== viewer?.user_id">規劃人：{{ p.owner.full_name || p.owner.email }}</small>
            <p v-if="p.notes" class="pre">{{ p.notes }}</p>
            <small v-if="p.linked_case">關聯案件：{{ p.linked_case.case_no ? p.linked_case.case_no + " " : "" }}{{ p.linked_case.title }}</small>
            <div class="actions">
              <template v-if="p.can_edit">
                <button v-if="p.status === 'PLANNED' || p.status === 'IN_PROGRESS'" :disabled="tab.busy" @click="startPlan(p)">{{ p.status === "PLANNED" ? "開始處理" : "新增管理紀錄" }}</button>
                <button v-if="p.status === 'IN_PROGRESS'" :disabled="tab.busy" data-act="done" @click="setPlanStatus(p, 'DONE')">完成</button>
                <button v-if="p.status !== 'CANCELLED' && p.status !== 'DONE'" :disabled="tab.busy" @click="setPlanStatus(p, 'CANCELLED')">取消</button>
                <button :disabled="tab.busy" @click="openPlan(p)">編輯</button>
              </template>
              <button v-if="p.can_delete" class="danger" :disabled="tab.busy" data-act="del-plan" @click="askDelete({ kind: 'plan', id: p.id, label: '今日管理規劃' })">刪除</button>
            </div>
          </article>
        </div>

        <div class="block-head"><h2>追蹤佇列</h2></div>
        <p v-if="!grouped.length" class="empty">七天內沒有需要追蹤的案件</p>
        <section v-for="g in grouped" :key="g.bucket" class="bucket" :data-bucket="g.bucket">
          <h3 :class="{ danger: g.bucket === 'overdue' }">{{ BUCKET[g.bucket] }}（{{ g.items.length }}）</h3>
          <div class="cards">
            <article v-for="c in g.items" :key="c.id" class="card">
              <div class="card-head"><strong>{{ c.title }}</strong><span class="badge">{{ STATUS[c.status] }}</span></div>
              <small>{{ c.target_name_snapshot }} · 下次追蹤 {{ fmtDate(c.next_follow_up_at) }}</small>
              <p v-if="c.latest_record" class="pre"><small>最近紀錄 {{ c.latest_record.record_date }}：{{ c.latest_record.action_summary }}</small></p>
              <div class="actions">
                <button :disabled="tab.busy" @click="quickFollowup(c)">記錄追蹤</button>
                <button :disabled="tab.busy" @click="section = 'cases'; openCase(c.id)">開啟案件</button>
              </div>
            </article>
          </div>
        </section>

        <div class="block-head"><h2>今日紀錄</h2></div>
        <p v-if="!today.todayRecords.length" class="empty">今天還沒有管理紀錄</p>
        <ul class="plain">
          <li v-for="r in today.todayRecords" :key="r.id"><strong>{{ r.case?.title || r.target_name_snapshot }}</strong> · {{ RECORD_TYPE[r.record_type] }}<p class="pre">{{ r.action_summary }}</p></li>
        </ul>
      </template>
    </div>

    <!-- 管理案件 -->
    <div v-else data-testid="cases">
      <div class="filters">
        <label>搜尋案件<input v-model="searchInput" type="search" placeholder="標題、對象、摘要、案件編號" data-testid="case-search" /></label>
        <label>目標類型
          <select v-model="filters.targetType" @change="loadCases(1)">
            <option value="">全部</option>
            <option v-for="(label, key) in TARGET" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
      </div>
      <div class="segments" role="group" aria-label="案件狀態">
        <button :class="{ on: !filters.status }" @click="setStatus('')">全部</button>
        <button v-for="(label, key) in STATUS" :key="key" :class="{ on: filters.status === key }" @click="setStatus(key)">{{ label }}</button>
      </div>
      <p v-if="casesLoading && !cases.length" role="status">載入中…</p>
      <p v-else-if="!cases.length" class="empty" data-testid="no-cases">目前沒有案件</p>
      <div class="cards">
        <article v-for="c in cases" :key="c.id" class="card clickable" :data-case="c.title" tabindex="0" @click="openCase(c.id)" @keydown.enter="openCase(c.id)">
          <div class="card-head"><strong>{{ c.title }}</strong><span class="badge" :class="'s-' + c.status.toLowerCase()" data-case-status>{{ STATUS[c.status] }}</span></div>
          <small>{{ c.case_no ? c.case_no + " · " : "" }}{{ TARGET[c.target_type] }} · {{ c.target_name_snapshot }}</small>
          <small>優先 {{ PRIORITY[c.priority] }} · 下次追蹤 {{ fmtDate(c.next_follow_up_at) }} · 建立 {{ c.owner?.full_name || c.owner?.email || "" }}</small>
        </article>
      </div>
      <footer class="pager">
        <span>共 {{ meta.total }} 筆 · 第 {{ meta.page }} / {{ meta.totalPages }} 頁</span>
        <button :disabled="meta.page <= 1 || casesLoading" @click="loadCases(meta.page - 1)">上一頁</button>
        <button :disabled="meta.page >= meta.totalPages || casesLoading" @click="loadCases(meta.page + 1)">下一頁</button>
      </footer>
    </div>
  </section>

  <!-- 案件詳情 -->
  <Modal v-if="detail" :title="detail.title" wide :busy="tab.busy" @cancel="!tab.busy && (detail = null)">
    <div data-testid="case-detail">
      <p v-if="formError && !recOpen && !fuOpen && !editOpen && !delTarget" role="alert" class="notice error">{{ formError }}</p>
      <p>
        <span class="badge" :class="'s-' + detail.status.toLowerCase()" data-detail-status>{{ STATUS[detail.status] }}</span>
        <small> {{ detail.case_no ? detail.case_no + " · " : "" }}{{ TARGET[detail.target_type] }} · {{ detail.target_name_snapshot }} · 優先 {{ PRIORITY[detail.priority] }} · 下次追蹤 {{ fmtDate(detail.next_follow_up_at) }}</small>
      </p>
      <p v-if="detail.summary" class="pre">{{ detail.summary }}</p>
      <small>建立者：{{ detail.owner?.full_name || detail.owner?.email || "-" }}<template v-if="detail.category"> · 分類：{{ detail.category.name }}</template></small>
      <div class="actions">
        <button v-if="detail.permissions.edit" data-act="edit-case" :disabled="tab.busy" @click="openEdit">編輯案件</button>
        <button v-if="detail.permissions.add_record" data-act="add-record" :disabled="tab.busy" @click="openRecord()">新增管理紀錄</button>
        <button v-if="detail.permissions.add_followup" data-act="add-followup" :disabled="tab.busy" @click="openFollowup()">新增追蹤結果</button>
        <button v-if="detail.permissions.delete" class="danger" data-act="del-case" :disabled="tab.busy" @click="askDelete({ kind: 'case', id: detail.id, label: '案件' })">刪除案件</button>
      </div>

      <h3>管理紀錄（{{ detail.records.length }}）</h3>
      <p v-if="!detail.records.length" class="empty">尚無管理紀錄</p>
      <article v-for="r in detail.records" :key="r.id" class="card" :data-record="r.action_summary">
        <div class="card-head"><strong>{{ RECORD_TYPE[r.record_type] }} · {{ r.record_date }}</strong><span v-if="r.ai_generated" class="badge">AI 草稿已人工確認</span></div>
        <p class="pre"><b>發現：</b>{{ r.observation }}</p>
        <p class="pre"><b>判斷：</b>{{ r.judgment }}</p>
        <p class="pre"><b>動作：</b>{{ r.action_summary }}</p>
        <small v-if="r.action_options?.length">{{ r.action_options.join("、") }}</small>
        <small v-if="r.requires_follow_up">需追蹤：{{ r.follow_up_date }}（{{ METHOD[r.follow_up_method || ""] || "未指定方式" }}）預期：{{ r.expected_result }}</small>
        <div class="actions">
          <button v-if="r.can_edit" data-act="edit-record" :disabled="tab.busy" @click="openRecord(r)">編輯</button>
          <button v-if="r.can_delete" class="danger" data-act="del-record" :disabled="tab.busy" @click="askDelete({ kind: 'record', id: r.id, label: '管理紀錄', caseId: detail.id })">刪除</button>
        </div>
      </article>

      <h3>追蹤結果（{{ detail.followups.length }}）</h3>
      <p v-if="!detail.followups.length" class="empty">尚無追蹤結果</p>
      <article v-for="f in detail.followups" :key="f.id" class="card" :data-followup="f.result_notes">
        <div class="card-head"><strong>{{ FU_STATUS[f.result_status] || f.result_status }} · {{ f.follow_up_date }}</strong></div>
        <p class="pre">{{ f.result_notes }}</p>
        <small v-if="f.next_follow_up_date">下次追蹤：{{ f.next_follow_up_date }}</small>
        <div class="actions"><button v-if="f.can_delete" class="danger" data-act="del-followup" :disabled="tab.busy" @click="askDelete({ kind: 'followup', id: f.id, label: '追蹤結果', caseId: detail.id })">刪除</button></div>
      </article>

      <h3>時間線</h3>
      <ol class="timeline" data-testid="timeline">
        <li v-for="(t, i) in detail.timeline" :key="i" :data-event="t.type"><small>{{ fmtTime(t.at) }}</small> <strong>{{ t.title }}</strong><span v-if="t.body" class="pre"> {{ t.body }}</span></li>
      </ol>
    </div>
    <footer class="actions end"><button @click="detail = null">關閉</button></footer>
  </Modal>
  <p v-if="detailLoading" class="sr-only" role="status">載入案件中…</p>

  <!-- 新增案件 -->
  <Modal v-if="caseOpen" title="新增督導管理案件" :busy="tab.busy" @cancel="!tab.busy && (caseOpen = false)">
    <form data-testid="case-form" @submit.prevent="submitCase">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <fieldset :disabled="tab.busy">
        <label>案件標題<input v-model="caseForm.title" name="title" placeholder="例：A 店陳列與效期檢視" /></label>
        <label>目標類型
          <select v-model="caseForm.target_type" name="target_type" @change="onTargetType(caseForm)">
            <option v-for="(label, key) in TARGET" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label v-if="caseForm.target_type === 'STORE' || caseForm.target_type === 'EMPLOYEE'">門市
          <select v-model="caseForm.store_id" name="store_id" @change="onStore(caseForm)">
            <option value="">{{ caseForm.target_type === "EMPLOYEE" ? "不指定（改用下方搜尋人員）" : "請選擇門市" }}</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ storeLabel(s) }}</option>
          </select>
        </label>
        <template v-if="caseForm.target_type === 'EMPLOYEE'">
          <label v-if="!caseForm.store_id">搜尋人員<input v-model="empSearch" type="search" placeholder="姓名或員編" /></label>
          <label>人員
            <select v-model="caseForm.employee_id" name="employee_id" @change="onEmployee(caseForm)">
              <option value="">請選擇人員</option>
              <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.employee_code }} {{ e.employee_name }}</option>
            </select>
          </label>
        </template>
        <label>管理對象<input v-model="caseForm.target_name_snapshot" name="target_name_snapshot" placeholder="選擇門市或人員後自動帶入，其他類型請直接輸入" /></label>
        <label>分類
          <select v-model="caseForm.category_id" name="category_id"><option value="">不指定</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </label>
        <label>優先程度
          <select v-model="caseForm.priority" name="priority"><option v-for="(label, key) in PRIORITY" :key="key" :value="key">{{ label }}</option></select>
        </label>
        <label>下次追蹤日期<input v-model="caseForm.next_follow_up_at" name="next_follow_up_at" type="date" /></label>
        <label>摘要<textarea v-model="caseForm.summary" name="summary" rows="3"></textarea></label>
      </fieldset>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="caseOpen = false">取消</button><button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : "建立案件" }}</button></footer>
    </form>
  </Modal>

  <!-- 編輯案件 -->
  <Modal v-if="editOpen" title="編輯案件" :busy="tab.busy" @cancel="!tab.busy && (editOpen = false)">
    <form data-testid="edit-form" @submit.prevent="submitEdit">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <fieldset :disabled="tab.busy">
        <label>案件標題<input v-model="editForm.title" name="title" /></label>
        <label>狀態<select v-model="editForm.status" name="status"><option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option></select></label>
        <label>分類<select v-model="editForm.category_id" name="category_id"><option value="">不指定</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>優先程度<select v-model="editForm.priority" name="priority"><option v-for="(label, key) in PRIORITY" :key="key" :value="key">{{ label }}</option></select></label>
        <label>下次追蹤日期<input v-model="editForm.next_follow_up_at" name="next_follow_up_at" type="date" /></label>
        <label>摘要<textarea v-model="editForm.summary" name="summary" rows="3"></textarea></label>
      </fieldset>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="editOpen = false">取消</button><button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : "儲存" }}</button></footer>
    </form>
  </Modal>

  <!-- 管理紀錄 -->
  <Modal v-if="recOpen" :title="recEditing ? '編輯管理紀錄' : '新增管理紀錄'" :busy="tab.busy" @cancel="!tab.busy && (recOpen = false)">
    <form data-testid="record-form" @submit.prevent="submitRecord">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <fieldset :disabled="tab.busy">
        <label>紀錄類型<select v-model="recForm.record_type" name="record_type"><option v-for="(label, key) in RECORD_TYPE" :key="key" :value="key">{{ label }}</option></select></label>
        <label>紀錄日期<input v-model="recForm.record_date" name="record_date" type="date" /></label>
        <label>發現或觀察<textarea v-model="recForm.observation" name="observation" rows="2"></textarea></label>
        <label>管理判斷<textarea v-model="recForm.judgment" name="judgment" rows="2"></textarea></label>
        <label>管理動作<textarea v-model="recForm.action_summary" name="action_summary" rows="2"></textarea></label>
        <div class="checks"><label v-for="o in ACTION_OPTIONS" :key="o" class="inline"><input type="checkbox" :checked="recForm.action_options.includes(o)" @change="toggleOption(o)" />{{ o }}</label></div>
        <label class="inline"><input v-model="recForm.requires_follow_up" type="checkbox" name="requires_follow_up" />需要追蹤</label>
        <template v-if="recForm.requires_follow_up">
          <label>追蹤日期<input v-model="recForm.follow_up_date" name="follow_up_date" type="date" /></label>
          <label>追蹤方式<select v-model="recForm.follow_up_method" name="follow_up_method"><option value="">未指定</option><option v-for="(label, key) in METHOD" :key="key" :value="key">{{ label }}</option></select></label>
          <label>預期結果<textarea v-model="recForm.expected_result" name="expected_result" rows="2"></textarea></label>
        </template>
      </fieldset>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="recOpen = false">取消</button><button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : "儲存紀錄" }}</button></footer>
    </form>
  </Modal>

  <!-- 追蹤結果 -->
  <Modal v-if="fuOpen" title="新增追蹤結果" :busy="tab.busy" @cancel="!tab.busy && (fuOpen = false)">
    <form data-testid="followup-form" @submit.prevent="submitFollowup">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <fieldset :disabled="tab.busy">
        <label>來源紀錄
          <select v-model="fuForm.source_record_id" name="source_record_id"><option value="">不指定</option><option v-for="r in detail?.records || []" :key="r.id" :value="r.id">{{ r.record_date }} {{ r.action_summary.slice(0, 20) }}</option></select>
        </label>
        <label>追蹤日期<input v-model="fuForm.follow_up_date" name="follow_up_date" type="date" /></label>
        <label>追蹤結果<select v-model="fuForm.result_status" name="result_status"><option v-for="(label, key) in FU_STATUS" :key="key" :value="key">{{ label }}</option></select></label>
        <label>結果說明<textarea v-model="fuForm.result_notes" name="result_notes" rows="3"></textarea></label>
        <label>下次追蹤日期<input v-model="fuForm.next_follow_up_date" name="next_follow_up_date" type="date" /></label>
      </fieldset>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="fuOpen = false">取消</button><button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : "儲存追蹤" }}</button></footer>
    </form>
  </Modal>

  <!-- 每日計畫 -->
  <Modal v-if="planOpen" :title="planEditing ? '編輯今日管理規劃' : '新增今日管理規劃'" :busy="tab.busy" @cancel="!tab.busy && (planOpen = false)">
    <form data-testid="plan-form" @submit.prevent="submitPlan">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <fieldset :disabled="tab.busy">
        <label>今日管理事項<input v-model="planForm.title" name="title" placeholder="例：到 A 店檢視陳列" /></label>
        <label>規劃日期<input v-model="planForm.plan_date" name="plan_date" type="date" /></label>
        <label>目標類型
          <select v-model="planForm.target_type" name="target_type" @change="onTargetType(planForm)"><option v-for="(label, key) in TARGET" :key="key" :value="key">{{ label }}</option></select>
        </label>
        <label v-if="planForm.target_type === 'STORE' || planForm.target_type === 'EMPLOYEE'">門市
          <select v-model="planForm.store_id" name="store_id" @change="onStore(planForm)">
            <option value="">{{ planForm.target_type === "EMPLOYEE" ? "不指定（改用下方搜尋人員）" : "請選擇門市" }}</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ storeLabel(s) }}</option>
          </select>
        </label>
        <template v-if="planForm.target_type === 'EMPLOYEE'">
          <label v-if="!planForm.store_id">搜尋人員<input v-model="empSearch" type="search" placeholder="姓名或員編" /></label>
          <label>人員<select v-model="planForm.employee_id" name="employee_id" @change="onEmployee(planForm)"><option value="">請選擇人員</option><option v-for="e in employees" :key="e.id" :value="e.id">{{ e.employee_code }} {{ e.employee_name }}</option></select></label>
        </template>
        <label>管理對象<input v-model="planForm.target_name_snapshot" name="target_name_snapshot" /></label>
        <label>分類<select v-model="planForm.category_id" name="category_id"><option value="">不指定</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>關聯案件<select v-model="planForm.linked_case_id" name="linked_case_id"><option value="">不關聯</option><option v-for="c in linkable" :key="c.id" :value="c.id">{{ c.title }}</option></select></label>
        <label>備註<textarea v-model="planForm.notes" name="notes" rows="3"></textarea></label>
      </fieldset>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="planOpen = false">取消</button><button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : "儲存規劃" }}</button></footer>
    </form>
  </Modal>

  <!-- 刪除原因 -->
  <Modal v-if="delTarget" :title="`刪除${delTarget.label}`" :busy="tab.busy" @cancel="!tab.busy && (delTarget = null)">
    <form data-testid="delete-form" @submit.prevent="confirmDelete">
      <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
      <p>刪除只會標記為已刪除並留下時間線事件，資料不會真的消失。</p>
      <label>刪除原因<textarea v-model="delReason" name="deletion_reason" rows="3"></textarea></label>
      <footer class="actions end"><button type="button" :disabled="tab.busy" @click="delTarget = null">取消</button><button class="danger" data-act="confirm-delete" :disabled="tab.busy">{{ tab.busy ? "刪除中…" : "確定刪除" }}</button></footer>
    </form>
  </Modal>
</template>

<style scoped>
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
.page-heading p, small { color: var(--muted); }
h1 { margin: 10px 0; }
h2 { margin: 0; font-size: 1.15rem; }
h3 { margin: 18px 0 8px; }
.actions { display: flex; align-items: end; gap: 9px; flex-wrap: wrap; margin-top: 8px; }
.actions.end { justify-content: flex-end; margin-top: 18px; }
label { display: flex; flex-direction: column; gap: 7px; }
label.inline { flex-direction: row; align-items: center; gap: 8px; }
input:not([type="checkbox"]), select, textarea { padding: 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--surface); font: inherit; max-width: 100%; box-sizing: border-box; width: 100%; }
fieldset { border: 0; padding: 12px 0; display: grid; gap: 14px; margin: 0; min-width: 0; }
.filters { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.filters label { min-width: 200px; flex: 1; }
.segments { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.segments button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.date-line { color: var(--muted); margin: 0 0 8px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 0; list-style: none; margin: 14px 0; }
.stats li { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; background: var(--surface); }
.stats strong { font-size: 1.6rem; }
.stats .warn strong { color: #b45309; }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 22px 0 10px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: var(--surface); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.card.clickable { cursor: pointer; }
.card.clickable:hover, .card.clickable:focus { border-color: var(--primary); }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.badge { font-size: .8rem; padding: 2px 9px; border-radius: 999px; background: var(--soft); white-space: nowrap; }
.badge.p-done, .badge.s-resolved, .badge.s-closed { background: #cdeed9; color: #0b5a2d; }
.badge.p-in_progress, .badge.s-improving, .badge.s-follow_up { background: #dbe8fb; color: #1d4a8a; }
.badge.p-cancelled, .badge.s-cancelled { background: #f6d6d3; color: #8a1f17; }
.badge.s-open, .badge.p-planned { background: #fbe9c8; color: #7a4b03; }
.pre { white-space: pre-wrap; margin: 4px 0; overflow-wrap: anywhere; }
.plain { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.plain li { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: var(--surface); }
.bucket h3 { margin: 14px 0 8px; }
.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.timeline li { border-left: 3px solid var(--line); padding: 2px 10px; overflow-wrap: anywhere; }
.checks { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.danger, .error { color: #a32a23; }
.notice { padding: 12px; border: 1px solid var(--primary); border-radius: 6px; background: var(--soft); white-space: pre-line; }
.empty { text-align: center; padding: 22px 0; color: var(--muted); }
.pager { display: flex; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.pager span { margin-right: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
