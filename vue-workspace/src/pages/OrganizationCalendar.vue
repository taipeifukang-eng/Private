<script setup lang="ts">
// M5 W23／W24 年度行事曆：月檢視與全年清單、公司行事／個人行程／政府假日三種來源、公司行事新增修改取消與異動紀錄、
// 個人行程新增修改刪除與分享、政府假日匯入（Q21 差異二次確認）、Google 同步區與頁頂警示（Q20）。
// 所有登入者都能看（Q17）；新增公司行事、修改取消、匯入假日、Google 管理是三個獨立權限（由伺服器回報）。
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../api";
import { useSession, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import CalendarShareDialog from "../components/CalendarShareDialog.vue";
import CalendarHolidayImport from "../components/CalendarHolidayImport.vue";
import CalendarGooglePanel, { type GoogleStatus } from "../components/CalendarGooglePanel.vue";
import CalendarPeoplePicker, { type Person } from "../components/CalendarPeoplePicker.vue";
import {
  buildCalendarEntries,
  entriesByMonth,
  entriesOnDate,
  googleBanner,
  monthGridDays,
  validateCalendarDraft,
  type CalendarEntry,
  type CalendarSource,
} from "../../../lib/workspace/calendar-rules";

const props = defineProps<{ tab: WorkTab }>();
const session = useSession();
const SOURCE_LABELS: Record<CalendarSource, string> = { company: "公司行事", personal: "個人行程", holiday: "政府假日" };
const TYPE_LABELS: Record<string, string> = { meeting: "會議", activity: "活動", important: "重要事項" };
const HOLIDAY_LABELS: Record<string, string> = { national_holiday: "國定假日", substitute_holiday: "補假日", makeup_workday: "補行上班" };
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const AUDIT_FIELDS: [string, string][] = [
  ["title", "名稱"], ["event_type", "類型"], ["start_date", "開始日期"], ["end_date", "結束日期"], ["is_all_day", "時間方式"],
  ["start_time", "開始時間"], ["end_time", "結束時間"], ["location", "地點"], ["description", "說明"], ["status", "狀態"],
];
const taipeiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const today = taipeiToday();

const year = ref(Number(today.slice(0, 4)));
const month = ref(Number(today.slice(5, 7)) - 1);
const selectedDate = ref(today);
const view = ref<"month" | "year">("month");
const data = reactive({ companyEvents: [] as any[], personalEvents: [] as any[], holidays: [] as any[], holidaySource: null as any });
const permissions = reactive({ createCompany: false, editCompany: false, manageHolidays: false, manageGoogle: false });
const currentUserId = ref(session.data?.user.id || "");
const loading = ref(true);
const error = ref("");
const notice = ref("");
const visible = reactive<Record<CalendarSource, boolean>>({ company: true, personal: true, holiday: true });

const entries = computed(() => buildCalendarEntries(data, visible));
const monthDays = computed(() => monthGridDays(year.value, month.value));
const dayEntries = computed(() => entriesOnDate(entries.value, selectedDate.value));
const yearMonths = computed(() => entriesByMonth(entries.value));
const fmtDate = (v: string) => { const [y, m, d] = v.split("-"); return `${y}/${Number(m)}/${Number(d)}`; };
const fmtTime = (v?: string | null) => (v ? v.slice(0, 5) : "");
const pad = (n: number) => String(n).padStart(2, "0");

async function load(target = year.value) {
  loading.value = true;
  error.value = "";
  try {
    const r = await api(`calendar?year=${target}`);
    data.companyEvents = r.companyEvents || [];
    data.personalEvents = r.personalEvents || [];
    data.holidays = r.holidays || [];
    data.holidaySource = r.holidaySource || null;
    currentUserId.value = r.currentUserId || currentUserId.value;
    Object.assign(permissions, r.permissions || {});
    if (permissions.manageGoogle) await loadGoogle();
  } catch (e) {
    error.value = (e as Error).message || "無法載入年度行事曆";
  } finally {
    loading.value = false;
  }
}

// ---- Google 狀態與頁頂警示（Q20）----
const google = ref<GoogleStatus | null>(null);
const googleError = ref("");
const banner = computed(() => googleBanner(google.value));
async function loadGoogle() {
  if (!permissions.manageGoogle) return;
  googleError.value = "";
  try {
    google.value = await api("calendar/google/status");
  } catch (e) {
    googleError.value = (e as Error).message || "無法讀取 Google 同步狀態";
  }
}
const connectHref = computed(() => {
  const href = "/api/organization/calendar/google/connect";
  return session.data?.integrated ? href : `http://localhost:3002${href}`;
});

// ---- 導覽 ----
function moveMonth(delta: number) {
  const next = new Date(Date.UTC(year.value, month.value + delta, 1));
  const changedYear = next.getUTCFullYear() !== year.value;
  year.value = next.getUTCFullYear();
  month.value = next.getUTCMonth();
  selectedDate.value = `${year.value}-${pad(month.value + 1)}-01`;
  if (changedYear) void load(year.value);
}
function selectDate(date: string) {
  selectedDate.value = date;
  const [y, m] = date.split("-").map(Number);
  const changedYear = y !== year.value;
  year.value = y;
  month.value = m - 1;
  if (changedYear) void load(y);
}
function moveYear(delta: number) {
  year.value += delta;
  selectedDate.value = `${year.value}-${pad(month.value + 1)}-01`;
  void load(year.value);
}
function openMonth(index: number) {
  month.value = index;
  view.value = "month";
  selectedDate.value = `${year.value}-${pad(index + 1)}-01`;
}

// ---- 新增／編輯 ----
type Draft = { title: string; event_type: string; start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string; location: string; description: string };
const showForm = ref(false);
const formKind = ref<"company" | "personal">("personal");
const editing = ref<CalendarEntry | null>(null);
const saving = ref(false);
const formError = ref("");
const recipients = ref<Person[]>([]);
const draft = reactive<Draft>({ title: "", event_type: "meeting", start_date: today, end_date: today, is_all_day: true, start_time: "09:00", end_time: "10:00", location: "", description: "" });
function beginCreate(kind: "company" | "personal", date = selectedDate.value) {
  formKind.value = kind === "company" && permissions.createCompany ? "company" : "personal";
  editing.value = null;
  Object.assign(draft, { title: "", event_type: "meeting", start_date: date, end_date: date, is_all_day: true, start_time: "09:00", end_time: "10:00", location: "", description: "" });
  recipients.value = [];
  formError.value = "";
  showForm.value = true;
}
function beginEdit(e: CalendarEntry) {
  formKind.value = e.source as "company" | "personal";
  editing.value = e;
  Object.assign(draft, {
    title: e.title, event_type: e.event_type || "meeting", start_date: e.start_date, end_date: e.end_date, is_all_day: e.is_all_day !== false,
    start_time: fmtTime(e.start_time) || "09:00", end_time: fmtTime(e.end_time) || "10:00", location: e.location || "", description: e.description || "",
  });
  recipients.value = [];
  formError.value = "";
  showForm.value = true;
}
function syncMessage(g: any, ok: string, failed: string) {
  return g?.status === "failed" ? `${failed}：${g.message || "請稍後重試"}` : ok;
}
async function save() {
  formError.value = validateCalendarDraft(draft) || "";
  if (formError.value) return;
  saving.value = true;
  try {
    const company = formKind.value === "company";
    const body: Record<string, unknown> = { ...draft };
    if (editing.value) body.id = editing.value.id;
    if (!editing.value && !company && recipients.value.length) body.share_with_user_ids = recipients.value.map((p) => p.id);
    const r = await api(`calendar/${company ? "company-events" : "personal-events"}`, { method: editing.value ? "PATCH" : "POST", body: JSON.stringify(body) });
    showForm.value = false;
    notice.value = syncMessage(r.googleSync, editing.value ? "行事已更新" : "行事已建立", "行事已儲存，但 Google 同步失敗");
    await load();
  } catch (e) {
    formError.value = (e as Error).message || "儲存失敗";
  } finally {
    saving.value = false;
  }
}

// ---- 取消公司行事（Q19：Google 上對應事件會真的刪除）、刪除個人行程 ----
const confirmCancel = ref<CalendarEntry | null>(null);
const confirmDelete = ref<CalendarEntry | null>(null);
async function cancelCompany() {
  const e = confirmCancel.value;
  confirmCancel.value = null;
  if (!e) return;
  try {
    const r = await api("calendar/company-events", { method: "PATCH", body: JSON.stringify({ id: e.id, status: "cancelled" }) });
    notice.value = syncMessage(r.googleSync, "公司行事已取消", "系統已取消行事，但 Google 同步失敗");
    await load();
  } catch (err) {
    error.value = (err as Error).message || "取消失敗";
  }
}
async function deletePersonal() {
  const e = confirmDelete.value;
  confirmDelete.value = null;
  if (!e) return;
  try {
    await api(`calendar/personal-events?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    notice.value = "個人行程已刪除";
    await load();
  } catch (err) {
    error.value = (err as Error).message || "刪除失敗";
  }
}

// ---- 異動紀錄 ----
const historyEntry = ref<CalendarEntry | null>(null);
const history = ref<any[]>([]);
const historyLoading = ref(false);
const historyError = ref("");
async function openHistory(e: CalendarEntry) {
  historyEntry.value = e;
  history.value = [];
  historyError.value = "";
  historyLoading.value = true;
  try {
    history.value = (await api(`calendar/company-events?event_id=${encodeURIComponent(e.id)}`)).history || [];
  } catch (err) {
    historyError.value = (err as Error).message || "無法載入異動紀錄";
  } finally {
    historyLoading.value = false;
  }
}
function auditValue(field: string, v: unknown) {
  if (v == null || v === "") return "未填寫";
  if (field === "start_date" || field === "end_date") return fmtDate(String(v));
  if (field === "start_time" || field === "end_time") return fmtTime(String(v));
  if (field === "is_all_day") return v ? "全天" : "指定時間";
  if (field === "event_type") return TYPE_LABELS[String(v)] || String(v);
  if (field === "status") return v === "cancelled" ? "已取消" : "有效";
  return String(v);
}
const changesOf = (r: any) => AUDIT_FIELDS.filter(([f]) => !r.before_data || r.before_data[f] !== r.after_data?.[f]);
const actionLabel = (a: string) => (a === "created" ? "新增" : a === "cancelled" ? "取消" : "修改");
const stamp = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// ---- 分享、假日匯入 ----
const shareTarget = ref<CalendarEntry | null>(null);
const showImport = ref(false);
function importPublished(message: string) {
  showImport.value = false;
  notice.value = message;
  void load();
}

const typeLabel = (e: CalendarEntry) =>
  e.source === "company" ? TYPE_LABELS[e.event_type || ""] || "" : e.source === "holiday" ? HOLIDAY_LABELS[e.day_type || ""] || "" : "";
const isOwner = (e: CalendarEntry) => e.source === "personal" && e.owner_id === currentUserId.value;

onMounted(async () => {
  await load();
  // M5 W24：Google 授權回調由舊站轉過來（/organization/calendar?google_calendar=...）
  const g = props.tab.payload?.google as { result: string; detail: string } | undefined;
  if (g) {
    if (g.result === "connected") notice.value = g.detail || "Google 公司日曆已連結並完成首次同步";
    else if (g.result === "connected_with_errors") error.value = g.detail || "Google 已連結，部分資料同步失敗，請重試";
    else error.value = g.detail || "Google 日曆連結失敗";
    props.tab.payload = undefined;
    await loadGoogle();
  }
});
</script>

<template>
  <div class="calendar-page" data-testid="calendar-page">
    <div v-if="banner.show" class="google-banner" role="alert" data-testid="google-banner">
      <strong>Google 日曆同步提醒</strong>
      <span>{{ banner.text }}</span>
    </div>

    <header class="page-heading">
      <div>
        <p class="eyebrow">組織與門市</p>
        <h1>年度行事曆</h1>
        <p>公司行事、個人行程與政府假日。所有同仁都能查看。</p>
      </div>
      <button class="primary" data-testid="calendar-new" @click="beginCreate(permissions.createCompany ? 'company' : 'personal')">新增行事</button>
    </header>

    <p v-if="error" role="alert" class="notice error">{{ error }}<button @click="error = ''">關閉</button></p>
    <p v-else-if="notice" role="status" class="notice success" data-testid="calendar-notice">{{ notice }}<button @click="notice = ''">關閉</button></p>

    <CalendarGooglePanel
      v-if="permissions.manageGoogle"
      :status="google"
      :status-error="googleError"
      :connect-href="connectHref"
      @changed="loadGoogle"
      @notice="notice = $event"
    />

    <section class="controls" aria-label="行事曆檢視設定">
      <div class="nav">
        <button aria-label="上一個月" @click="moveMonth(-1)" :disabled="view === 'year'">‹</button>
        <button aria-label="下一個月" @click="moveMonth(1)" :disabled="view === 'year'">›</button>
        <h2 data-testid="calendar-title">{{ view === "month" ? `${year} 年 ${month + 1} 月` : `${year} 年` }}</h2>
        <button aria-label="上一年" @click="moveYear(-1)">« 上一年</button>
        <button aria-label="下一年" @click="moveYear(1)">下一年 »</button>
        <button @click="selectDate(today)">今天</button>
      </div>
      <div class="segmented" role="group" aria-label="日曆範圍">
        <button :aria-pressed="view === 'month'" :class="{ on: view === 'month' }" @click="view = 'month'">月檢視</button>
        <button :aria-pressed="view === 'year'" :class="{ on: view === 'year' }" @click="view = 'year'">全年清單</button>
      </div>
    </section>

    <div class="sources" aria-label="顯示行事來源">
      <button v-for="s in (['company', 'personal', 'holiday'] as CalendarSource[])" :key="s" :aria-pressed="visible[s]" :class="['source', s, { off: !visible[s] }]" @click="visible[s] = !visible[s]">
        <span class="dot" />{{ SOURCE_LABELS[s] }}
      </button>
      <span v-if="data.holidaySource" class="muted holiday-source" data-testid="holiday-source">
        假日來源：{{ data.holidaySource.source_name }}{{ data.holidaySource.source_revision ? ` · ${data.holidaySource.source_revision}` : "" }} · 匯入 {{ new Date(data.holidaySource.imported_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) }}
      </span>
      <button v-if="permissions.manageHolidays" class="import-button" data-testid="holiday-import-open" @click="showImport = true">
        {{ data.holidaySource ? "更新假日資料" : "匯入政府假日" }}
      </button>
    </div>

    <p v-if="loading" role="status" class="muted">載入行事曆…</p>
    <div v-else class="layout">
      <section :aria-label="view === 'month' ? '月曆' : '全年行事清單'">
        <div v-if="view === 'month'" class="grid-wrap">
          <div class="weekdays"><span v-for="(w, i) in WEEKDAYS" :key="w" :class="{ sun: i === 0, sat: i === 6 }">{{ w }}</span></div>
          <div class="grid" data-testid="month-grid">
            <button
              v-for="cell in monthDays"
              :key="cell.value"
              :class="['cell', { out: !cell.inMonth, selected: selectedDate === cell.value, today: today === cell.value }]"
              :aria-label="`${fmtDate(cell.value)}，${entriesOnDate(entries, cell.value).length} 件行事`"
              :aria-pressed="selectedDate === cell.value"
              :data-date="cell.value"
              @click="selectDate(cell.value)"
              @dblclick="beginCreate(permissions.createCompany ? 'company' : 'personal', cell.value)"
            >
              <span class="day">{{ cell.day }}</span>
              <span v-for="e in entriesOnDate(entries, cell.value).slice(0, 2)" :key="e.key" :class="['chip', e.source]">
                <span v-if="e.is_all_day === false" class="time">{{ fmtTime(e.start_time) }}</span>{{ e.title }}
              </span>
              <span v-if="entriesOnDate(entries, cell.value).length > 2" class="more">+{{ entriesOnDate(entries, cell.value).length - 2 }} 項</span>
            </button>
          </div>
        </div>
        <div v-else class="year-list" data-testid="year-list">
          <section v-for="m in yearMonths" :key="m.month" class="year-month">
            <button class="month-name" :data-month="m.month + 1" @click="openMonth(m.month)">{{ m.month + 1 }} 月 <small data-testid="month-count">{{ m.events.length }}</small></button>
            <div v-if="m.events.length">
              <button v-for="e in m.events" :key="e.key" class="year-row" @click="selectDate(e.start_date); view = 'month'">
                <span class="when">{{ Number(e.start_date.slice(8, 10)) }} 日</span>
                <span :class="['bar', e.source]">
                  <strong>{{ e.title }}</strong>
                  <small>{{ SOURCE_LABELS[e.source] }}{{ e.is_all_day === false ? ` · ${fmtTime(e.start_time)}-${fmtTime(e.end_time)}` : "" }}{{ e.start_date !== e.end_date ? ` · 至 ${fmtDate(e.end_date)}` : "" }}</small>
                </span>
              </button>
            </div>
            <p v-else class="muted">沒有行事</p>
          </section>
        </div>
      </section>

      <aside aria-label="所選日期行事" data-testid="day-panel">
        <div class="day-head">
          <div><small class="muted">所選日期</small><h2>{{ fmtDate(selectedDate) }}</h2></div>
          <div class="day-actions">
            <button v-if="permissions.createCompany" aria-label="新增公司行事" title="新增公司行事" @click="beginCreate('company')">新增公司行事</button>
            <button aria-label="新增個人行程" title="新增個人行程" @click="beginCreate('personal')">新增個人行程</button>
          </div>
        </div>
        <ul v-if="dayEntries.length" class="day-list">
          <li v-for="e in dayEntries" :key="e.key" :data-source="e.source">
            <small :class="['tag', e.source]">{{ SOURCE_LABELS[e.source] }}</small>
            <div class="entry">
              <div>
                <strong>{{ e.title }}</strong> <small v-if="typeLabel(e)" class="muted">{{ typeLabel(e) }}</small>
                <p v-if="e.start_date !== e.end_date || e.is_all_day === false" class="muted small">
                  {{ fmtDate(e.start_date) }}{{ e.start_date !== e.end_date ? ` - ${fmtDate(e.end_date)}` : "" }}
                  <template v-if="e.is_all_day === false"> · {{ fmtTime(e.start_time) }}-{{ fmtTime(e.end_time) }}</template>
                </p>
                <p v-if="e.location" class="muted small">地點：{{ e.location }}</p>
                <p v-if="e.description" class="desc">{{ e.description }}</p>
              </div>
              <div class="entry-actions">
                <button v-if="e.source === 'personal'" @click="shareTarget = e">{{ isOwner(e) ? "管理分享" : "轉分享" }}</button>
                <button v-if="e.source === 'company'" @click="openHistory(e)">異動紀錄</button>
                <button v-if="(e.source === 'company' && permissions.editCompany) || isOwner(e)" @click="beginEdit(e)">編輯</button>
                <button v-if="e.source === 'company' && permissions.editCompany" class="danger" @click="confirmCancel = e">取消行事</button>
                <button v-if="isOwner(e)" class="danger" @click="confirmDelete = e">刪除</button>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="muted empty-day">這天沒有行事</p>
        <p v-if="visible.holiday && !data.holidaySource" class="muted small">尚無 {{ year }} 年政府假日資料</p>
      </aside>
    </div>

    <Modal v-if="showForm" :title="editing ? `編輯行事：${editing.title}` : formKind === 'company' ? '新增公司行事' : '新增個人行程'" :busy="saving" @cancel="showForm = false">
      <form class="event-form" data-testid="event-form" @submit.prevent="save">
        <p v-if="formError" role="alert" class="notice error">{{ formError }}</p>
        <div v-if="!editing && permissions.createCompany" class="segmented" role="group" aria-label="行事類型">
          <button type="button" :class="{ on: formKind === 'company' }" :aria-pressed="formKind === 'company'" @click="formKind = 'company'">公司行事</button>
          <button type="button" :class="{ on: formKind === 'personal' }" :aria-pressed="formKind === 'personal'" @click="formKind = 'personal'">個人行程</button>
        </div>
        <label>名稱<input v-model="draft.title" maxlength="160" required name="title" /></label>
        <label v-if="formKind === 'company'">類型
          <select v-model="draft.event_type" name="event_type"><option v-for="(label, v) in TYPE_LABELS" :key="v" :value="v">{{ label }}</option></select>
        </label>
        <div class="two">
          <label>開始日期<input v-model="draft.start_date" type="date" required name="start_date" @change="draft.end_date < draft.start_date && (draft.end_date = draft.start_date)" /></label>
          <label>結束日期<input v-model="draft.end_date" type="date" :min="draft.start_date" required name="end_date" /></label>
        </div>
        <label class="inline"><input v-model="draft.is_all_day" type="checkbox" name="is_all_day" />全天</label>
        <div v-if="!draft.is_all_day" class="two">
          <label>開始時間<input v-model="draft.start_time" type="time" required name="start_time" /></label>
          <label>結束時間<input v-model="draft.end_time" type="time" required name="end_time" /></label>
        </div>
        <label>地點（選填）<input v-model="draft.location" maxlength="500" name="location" /></label>
        <label>補充說明<textarea v-model="draft.description" maxlength="3000" rows="3" name="description" /></label>
        <CalendarPeoplePicker v-if="!editing && formKind === 'personal'" :selected="recipients" label="分享對象（選填）" @change="recipients = $event" />
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="showForm = false">取消</button>
          <button class="primary" type="submit" :disabled="saving">{{ saving ? "儲存中…" : editing ? "儲存變更" : "建立行事" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="confirmCancel" title="取消公司行事" @cancel="confirmCancel = null">
      <p>確定取消「{{ confirmCancel.title }}」？取消後會保留異動紀錄；若已連結 Google，Google 日曆上對應的事件會一併刪除，且無法在 Google 還原。</p>
      <div class="dialog-actions">
        <button @click="confirmCancel = null">保留行事</button>
        <button class="danger" data-testid="confirm-cancel" @click="cancelCompany">確定取消行事</button>
      </div>
    </Modal>
    <Modal v-if="confirmDelete" title="刪除個人行程" @cancel="confirmDelete = null">
      <p>確定刪除「{{ confirmDelete.title }}」？分享給其他人的紀錄也會一併失效。</p>
      <div class="dialog-actions">
        <button @click="confirmDelete = null">保留</button>
        <button class="danger" @click="deletePersonal">確定刪除</button>
      </div>
    </Modal>

    <Modal v-if="historyEntry" :title="`${historyEntry.title} · 異動紀錄`" wide @cancel="historyEntry = null">
      <div data-testid="history-dialog">
        <p v-if="historyError" role="alert" class="notice error">{{ historyError }}</p>
        <p v-else-if="historyLoading" role="status">載入異動紀錄…</p>
        <ol v-else-if="history.length" class="history">
          <li v-for="r in history" :key="r.id" data-testid="history-row">
            <p><strong>{{ actionLabel(r.action) }} · {{ r.actor_name }}</strong> <small class="muted">{{ stamp(r.changed_at) }}</small></p>
            <dl>
              <div v-for="[f, label] in changesOf(r)" :key="f"><dt>{{ label }}</dt><dd><template v-if="r.before_data">{{ auditValue(f, r.before_data[f]) }} → </template>{{ auditValue(f, r.after_data?.[f]) }}</dd></div>
            </dl>
          </li>
        </ol>
        <p v-else class="muted">目前沒有異動紀錄</p>
        <div class="dialog-actions"><button @click="historyEntry = null">關閉</button></div>
      </div>
    </Modal>

    <CalendarShareDialog v-if="shareTarget" :event-id="shareTarget.id" :title="shareTarget.title" :current-user-id="currentUserId" @close="shareTarget = null" @notice="notice = $event" />
    <CalendarHolidayImport v-if="showImport" :year="year" :has-published="!!data.holidaySource" @close="showImport = false" @published="importPublished" />
  </div>
</template>

<style scoped>
.google-banner { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; padding: 12px 16px; margin-bottom: 16px; border: 1px solid #b18b42; border-left-width: 4px; border-radius: 6px; background: #f6edd6; color: #4a3a12; position: sticky; top: 0; z-index: 5; }
:root[data-theme="dark"] .google-banner { background: #3a3220; color: #f1dfae; }
.controls { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nav h2 { margin: 0 8px; min-width: 130px; font-size: 18px; }
.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.segmented button { border: 0; border-radius: 0; }
.segmented .on { background: var(--primary); color: #fff; }
.sources { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.source { display: inline-flex; align-items: center; gap: 8px; }
.source.off { opacity: 0.5; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
.source.company, .tag.company { color: #2f5f9e; }
.source.personal, .tag.personal { color: #2f7a4f; }
.source.holiday, .tag.holiday { color: #a3372d; }
.holiday-source { margin-left: auto; font-size: 12px; }
.import-button { margin-left: auto; }
.holiday-source + .import-button { margin-left: 0; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: start; }
.grid-wrap { border: 1px solid var(--line); background: var(--surface); }
.weekdays, .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.weekdays span { padding: 8px 0; text-align: center; font-size: 12px; background: var(--soft); }
.weekdays .sun { color: var(--danger); }
.cell { min-height: 112px; display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 6px; border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; background: var(--surface); text-align: left; justify-content: flex-start; }
.cell.out { background: var(--canvas); opacity: 0.7; }
.cell.selected { outline: 2px solid var(--primary); outline-offset: -2px; position: relative; z-index: 1; }
.cell .day { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; font-size: 13px; }
.cell.today .day { background: var(--primary); color: #fff; font-weight: 600; }
.chip { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 4px; border: 1px solid var(--line); border-radius: 3px; font-size: 11px; line-height: 16px; }
.chip.company { border-color: #9db8dc; background: #e7eef8; color: #24467a; }
.chip.personal { border-color: #a6d0b6; background: #e5f3ea; color: #1f5c3a; }
.chip.holiday { border-color: #e0a8a2; background: #f8e6e4; color: #7e2820; }
:root[data-theme="dark"] .chip.company { background: #25344a; color: #bcd3f2; }
:root[data-theme="dark"] .chip.personal { background: #24392d; color: #b7e0c5; }
:root[data-theme="dark"] .chip.holiday { background: #432826; color: #f3beb8; }
.time { margin-right: 4px; font-variant-numeric: tabular-nums; }
.more { font-size: 11px; color: var(--muted); }
.year-list { border-top: 1px solid var(--line); }
.year-month { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.month-name { align-self: start; border: 0; background: transparent; font-weight: 600; text-align: left; padding: 0; }
.month-name small { color: var(--muted); margin-left: 6px; }
.year-row { display: flex; gap: 12px; width: 100%; border: 0; border-radius: 0; background: transparent; text-align: left; padding: 6px 0; }
.when { width: 48px; color: var(--muted); }
.bar { display: grid; border-left: 3px solid var(--line); padding-left: 10px; }
.bar.company { border-color: #2f5f9e; } .bar.personal { border-color: #2f7a4f; } .bar.holiday { border-color: #a3372d; }
.bar small { color: var(--muted); }
aside { border-left: 1px solid var(--line); padding-left: 20px; }
.day-head { display: flex; justify-content: space-between; gap: 8px; align-items: start; margin-bottom: 8px; }
.day-head h2 { margin: 2px 0 0; font-size: 18px; }
.day-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.day-list { list-style: none; margin: 0; padding: 0; }
.day-list li { padding: 10px 0; border-bottom: 1px solid var(--line); }
.entry { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.entry-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.entry-actions button { min-height: 30px; padding: 3px 9px; font-size: 12px; }
.desc { white-space: pre-wrap; margin: 6px 0 0; }
.small { font-size: 12px; }
p { margin: 4px 0; }
.event-form { display: grid; gap: 12px; }
.event-form label { display: grid; gap: 6px; }
.event-form label.inline { display: flex; align-items: center; gap: 8px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
textarea { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
.history { list-style: none; margin: 0; padding: 0; }
.history li { padding: 12px 0; border-bottom: 1px solid var(--line); }
.history dl { margin: 6px 0 0; display: grid; gap: 4px; }
.history dl div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; }
.history dt { color: var(--muted); }
.history dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 960px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  aside { border-left: 0; padding-left: 0; border-top: 1px solid var(--line); padding-top: 14px; }
  .cell { min-height: 76px; padding: 4px; }
  .year-month { grid-template-columns: minmax(0, 1fr); }
  .two { grid-template-columns: minmax(0, 1fr); }
}
</style>
