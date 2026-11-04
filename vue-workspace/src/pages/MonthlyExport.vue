<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, ApiError } from "../api";
import type { WorkTab } from "../stores";
import TopScrollTable from "../components/TopScrollTable.vue";
import {
  EXPORT_DEFINITIONS,
  canExportStore,
  canUseExport,
  exportFileName,
  type ExportAccess,
  type ExportKey,
  type ExportStoreRow,
} from "../../../lib/workspace/monthly-export";

// W02：每月資料匯出。畫面、檔名、門市狀態規則照舊版 /admin/export-monthly-status；
// 權限：一般匯出需 monthly.export.download；單品獎金、支援時數照舊版開放（W02-q2），沒有一般權限的人只看到這兩個按鈕。
const props = defineProps<{ tab: WorkTab }>();
type RosterRow = { year_month: string; store_code: string; store_name: string; employee_code: string; employee_name: string; position: string; monthly_status: string };

const access = ref<ExportAccess | null>(null);
const stores = ref<ExportStoreRow[]>([]);
const selected = ref<Set<string>>(new Set());
const loading = ref(false);
const error = ref("");
const message = ref("");
const busy = ref<string>("");
const year = ref(Number(props.tab.month.slice(0, 4)) || new Date().getFullYear());
const month = ref(Number(props.tab.month.slice(5, 7)) || new Date().getMonth() + 1);
const rosterRows = ref<RosterRow[]>([]);
const rosterLoaded = ref(false);
const rosterMessage = ref("選擇門市後按「預覽每月門市人員名冊」即可查看資料。");

const yearMonth = computed(() => `${year.value}-${String(month.value).padStart(2, "0")}`);
const validYear = computed(() => Number.isInteger(year.value) && year.value >= 2000 && year.value <= 2199);
const hasStores = computed(() => !!access.value?.general);
const exportable = computed(() => stores.value.filter((s) => canExportStore(s.store_status)));
const allSelected = computed(() => exportable.value.length > 0 && exportable.value.every((s) => selected.value.has(s.id)));
const totalEmployees = computed(() => stores.value.filter((s) => selected.value.has(s.id)).reduce((n, s) => n + s.total_employees, 0));
const storeLabels = { pending: "未提交", submitted: "已提交", confirmed: "已確認" } as const;

const visibleDefs = computed(() => EXPORT_DEFINITIONS.filter((d) => access.value && canUseExport(access.value, d.key)));
const defByKey = (key: ExportKey) => EXPORT_DEFINITIONS.find((d) => d.key === key)!;
const show = (key: ExportKey) => visibleDefs.value.some((d) => d.key === key);

let loadSeq = 0; // 連續切換年月時，只採用最後一次請求的結果
async function loadStores() {
  if (!hasStores.value || !validYear.value) return;
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  rosterRows.value = [];
  rosterLoaded.value = false;
  rosterMessage.value = "選擇門市後按「預覽每月門市人員名冊」即可查看資料。";
  try {
    const r = await api<{ stores: ExportStoreRow[] }>(`monthly-export/stores?year_month=${yearMonth.value}`);
    if (seq !== loadSeq) return;
    stores.value = r.stores || [];
    // 照舊版：預設選擇所有已提交或已確認的門市。
    selected.value = new Set(stores.value.filter((s) => canExportStore(s.store_status)).map((s) => s.id));
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = (e as Error).message;
    stores.value = [];
    selected.value = new Set();
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}
onMounted(async () => {
  loading.value = true;
  try {
    access.value = await api<ExportAccess>("monthly-export/access");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
  await loadStores();
});

function toggle(store: ExportStoreRow) {
  if (!canExportStore(store.store_status)) return;
  const next = new Set(selected.value);
  if (next.has(store.id)) next.delete(store.id);
  else next.add(store.id);
  selected.value = next;
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(exportable.value.map((s) => s.id));
}

async function saveBlob(response: Response, name: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
async function failureText(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event("workspace-session-expired"));
  return String(data.error || "下載失敗");
}
async function download(key: ExportKey) {
  const def = defByKey(key);
  if (!validYear.value) { error.value = "請輸入正確年份"; return; }
  if (def.storeScoped && selected.value.size === 0) { error.value = "請至少選擇一間門市"; return; }
  busy.value = key;
  error.value = "";
  message.value = "";
  try {
    const url = `/api/workspace/monthly-export/${def.path}`;
    const ids = Array.from(selected.value);
    const response = def.method === "GET"
      ? await fetch(`${url}?year_month=${yearMonth.value}`, { credentials: "same-origin", signal: AbortSignal.timeout(120000) })
      : await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year_month: yearMonth.value, store_ids: ids }),
          signal: AbortSignal.timeout(120000),
        });
    if (!response.ok) throw new Error(await failureText(response));
    await saveBlob(response, exportFileName(key, yearMonth.value, ids.length));
    message.value = `已下載 ${exportFileName(key, yearMonth.value, ids.length)}`;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : (e as Error).name === "TimeoutError" ? "匯出逾時，請稍後重試" : (e as Error).message || "下載失敗";
  } finally {
    busy.value = "";
  }
}
async function loadRoster() {
  if (selected.value.size === 0) { error.value = "請至少選擇一間門市"; return; }
  busy.value = "roster-preview";
  error.value = "";
  rosterRows.value = [];
  rosterLoaded.value = false;
  rosterMessage.value = "正在載入每月門市人員名冊...";
  try {
    const q = new URLSearchParams({ year_month: yearMonth.value, store_ids: Array.from(selected.value).join(",") });
    const r = await api<{ rows: RosterRow[] }>(`monthly-export/roster?${q}`);
    rosterRows.value = r.rows || [];
    rosterLoaded.value = true;
    rosterMessage.value = rosterRows.value.length ? "" : `查無 ${yearMonth.value}、目前所選門市的人員名冊資料。`;
  } catch (e) {
    rosterLoaded.value = true;
    rosterMessage.value = (e as Error).message;
    error.value = (e as Error).message;
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">人員 / 每月狀態</p>
      <h1>每月人員資料匯出</h1>
      <p class="muted">選擇門市並下載整合的 Excel 檔案</p>
    </div>
  </header>
  <p v-if="error" class="notice" role="alert" data-export-error>{{ error }}</p>
  <p v-if="message" class="notice" role="status" data-export-message>{{ message }}</p>
  <p v-if="loading && !access" class="muted">載入中…</p>
  <div v-if="access" class="export-layout">
    <aside class="export-side">
      <section class="export-card">
        <h2>選擇年月</h2>
        <label class="export-field">年份<input v-model.number="year" type="number" min="2000" max="2199" inputmode="numeric" data-export-year @change="loadStores" /></label>
        <label class="export-field">月份
          <select v-model.number="month" data-export-month @change="loadStores">
            <option v-for="m in 12" :key="m" :value="m">{{ m }} 月</option>
          </select>
        </label>
      </section>
      <section v-if="hasStores" class="export-card" data-export-stats>
        <h2>統計資訊</h2>
        <dl>
          <div><dt>總門市數</dt><dd data-stat="total">{{ stores.length }}</dd></div>
          <div><dt>可匯出門市</dt><dd data-stat="exportable">{{ exportable.length }}</dd></div>
          <div><dt>已選擇</dt><dd data-stat="selected">{{ selected.size }}</dd></div>
          <div><dt>總員工數</dt><dd data-stat="employees">{{ totalEmployees }}</dd></div>
        </dl>
      </section>
      <div class="export-buttons">
        <button v-if="show('download')" class="primary" type="button" data-export="download" :disabled="busy === 'download' || selected.size === 0" @click="download('download')">{{ busy === 'download' ? '下載中...' : `下載 Excel (${selected.size} 間門市)` }}</button>
        <button v-if="show('actual-staff-points')" type="button" data-export="actual-staff-points" :disabled="busy === 'actual-staff-points' || selected.size === 0" @click="download('actual-staff-points')">{{ busy === 'actual-staff-points' ? '匯出中...' : `匯出實際人力點值 (${selected.size} 間門市)` }}</button>
        <button v-if="show('roster')" type="button" data-export="roster-preview" :disabled="busy === 'roster-preview' || selected.size === 0" @click="loadRoster">{{ busy === 'roster-preview' ? '載入中...' : `預覽每月門市人員名冊 (${selected.size} 間門市)` }}</button>
        <button v-if="show('roster')" type="button" data-export="roster" :disabled="busy === 'roster' || selected.size === 0" @click="download('roster')">{{ busy === 'roster' ? '匯出中...' : `匯出每月門市人員名冊 (${selected.size} 間門市)` }}</button>
        <h3 v-if="show('transport') || show('single-item-bonus') || show('support-hours')">匯出交通費用、單品獎金、育才獎金 Excel</h3>
        <button v-if="show('transport')" type="button" data-export="transport" :disabled="busy === 'transport' || selected.size === 0" @click="download('transport')">{{ busy === 'transport' ? '匯出中...' : `匯出交通費用 (${selected.size} 間門市)` }}</button>
        <button v-if="show('single-item-bonus')" type="button" data-export="single-item-bonus" :disabled="busy === 'single-item-bonus' || selected.size === 0" @click="download('single-item-bonus')">{{ busy === 'single-item-bonus' ? '匯出中...' : `匯出單品獎金 (${selected.size} 間門市)` }}</button>
        <button v-if="show('talent-cultivation-bonus')" type="button" data-export="talent-cultivation-bonus" :disabled="busy === 'talent-cultivation-bonus' || selected.size === 0" @click="download('talent-cultivation-bonus')">{{ busy === 'talent-cultivation-bonus' ? '匯出中...' : `匯出育才獎金 (${selected.size} 間門市)` }}</button>
        <button v-if="show('meal-allowance')" type="button" data-export="meal-allowance" :disabled="busy === 'meal-allowance' || selected.size === 0" @click="download('meal-allowance')">{{ busy === 'meal-allowance' ? '匯出中...' : `匯出誤餐費 (${selected.size} 間門市)` }}</button>
        <button v-if="show('spring-festival-bonus')" type="button" data-export="spring-festival-bonus" :disabled="busy === 'spring-festival-bonus' || selected.size === 0" @click="download('spring-festival-bonus')">{{ busy === 'spring-festival-bonus' ? '匯出中...' : `匯出春節出勤獎金 (${selected.size} 間門市)` }}</button>
        <button v-if="show('support-hours')" type="button" data-export="support-hours" :disabled="busy === 'support-hours'" @click="download('support-hours')">{{ busy === 'support-hours' ? '匯出中...' : '匯出門市支援時數 (全部門市)' }}</button>
      </div>
    </aside>

    <section v-if="hasStores" class="export-card export-stores">
      <div class="export-stores-head">
        <h2>門市列表</h2>
        <button type="button" data-export-toggle-all :disabled="!exportable.length" @click="toggleAll">{{ allSelected ? '取消全選' : '全選' }}</button>
      </div>
      <p v-if="loading" class="muted">載入中…</p>
      <p v-else-if="!stores.length" class="empty">該月份尚無門市資料</p>
      <ul v-else class="export-store-list">
        <li v-for="s in stores" :key="s.id" :data-store="s.store_code" :data-status="s.store_status" :class="{ on: selected.has(s.id), off: !canExportStore(s.store_status) }">
          <label>
            <input type="checkbox" :checked="selected.has(s.id)" :disabled="!canExportStore(s.store_status)" @change="toggle(s)" />
            <span class="name"><strong>{{ s.store_code }} - {{ s.store_name }}</strong><small>員工人數：{{ s.total_employees }} 人</small></span>
            <em class="badge" :data-status="s.store_status">{{ storeLabels[s.store_status] }}</em>
          </label>
          <p v-if="!canExportStore(s.store_status)" class="muted">尚未提交，無法匯出</p>
        </li>
      </ul>
    </section>
    <section v-else class="export-card export-stores">
      <h2>可使用的匯出</h2>
      <p class="muted">你的帳號只能使用左側列出的匯出項目。</p>
    </section>
  </div>

  <section v-if="access && show('roster')" class="export-card export-roster" data-export-roster>
    <div class="export-stores-head">
      <h2>每月門市人員名冊</h2>
      <span class="muted">{{ rosterRows.length ? `${rosterRows.length} 筆` : rosterLoaded ? '0 筆' : '尚未載入' }}</span>
    </div>
    <p class="muted">依照該月份快照列出所有選取門市的人員員編、姓名與職稱。</p>
    <p v-if="!rosterRows.length" class="empty">{{ rosterMessage }}</p>
    <TopScrollTable v-else label="名冊">
      <table class="export-roster-table">
        <thead><tr><th>月份</th><th>門市代號</th><th>門市名稱</th><th>員編</th><th class="sticky-name">姓名</th><th>職稱</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in rosterRows" :key="`${r.store_code}-${r.employee_code}-${i}`">
            <td>{{ r.year_month }}</td><td>{{ r.store_code }}</td><td>{{ r.store_name }}</td><td>{{ r.employee_code }}</td><td class="sticky-name">{{ r.employee_name }}</td><td>{{ r.position }}</td>
          </tr>
        </tbody>
      </table>
    </TopScrollTable>
  </section>
</template>

<style scoped>
.export-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin-bottom:16px}
@media(min-width:1000px){.export-layout{grid-template-columns:340px minmax(0,1fr);align-items:start}}
.export-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.export-card{border:1px solid var(--line);background:var(--surface);padding:14px 16px;min-width:0}
.export-card h2{margin:0 0 10px;font-size:16px}
.export-field{display:block;font-size:13px;margin-bottom:10px}
.export-field input,.export-field select{display:block;width:100%;margin-top:4px}
.export-card dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.export-card dl div{display:flex;flex-direction:column;gap:2px}
.export-card dt{font-size:12px;color:var(--muted)}
.export-card dd{margin:0;font-size:22px;font-weight:700}
.export-buttons{display:flex;flex-direction:column;gap:10px}
.export-buttons h3{margin:8px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.export-buttons button{width:100%;min-height:40px}
.export-stores-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.export-stores-head h2{margin:0}
.export-store-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;max-height:640px;overflow:auto}
.export-store-list li{border:1px solid var(--line);padding:10px 12px}
.export-store-list li.on{border-color:var(--primary);background:var(--soft)}
.export-store-list li.off{opacity:.65}
.export-store-list label{display:flex;align-items:center;gap:10px;margin:0;cursor:pointer}
.export-store-list input[type=checkbox]{width:18px;height:18px;min-height:18px;min-width:18px;padding:0;margin:0;flex:none;accent-color:var(--primary)}
.export-store-list .name{flex:1;min-width:0;display:flex;flex-direction:column}
.export-store-list small{color:var(--muted)}
.export-store-list p{margin:6px 0 0;font-size:12px}
.badge{font-style:normal;font-size:12px;padding:2px 8px;border:1px solid var(--line);white-space:nowrap}
.badge[data-status=submitted]{color:var(--primary);border-color:var(--primary)}
.badge[data-status=confirmed]{color:#1b6e3a;border-color:#1b6e3a}
.export-roster-table{min-width:640px;border-collapse:collapse;width:100%}
.export-roster-table th,.export-roster-table td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
.export-roster-table .sticky-name{position:sticky;left:0;background:var(--surface)}
.export-roster{margin-top:16px}
</style>
