<script setup lang="ts">
import { onMounted, ref, watch, computed } from "vue";
import { api, type Store } from "../api";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import { formatTaipeiDate } from "../taipei-time";
import InspectionOverview from "../components/InspectionOverview.vue";
const props = defineProps<{ tab: WorkTab }>();
const session = useSession(),
  work = useWorkspace();
const allRecords = ref<any[]>([]),
  coverage = ref<any>(null),
  canExport = ref(false),
  exporting = ref(false),
  records = computed(() =>
    allRecords.value.slice((page.value - 1) * 20, page.value * 20),
  ),
  stores = ref<Store[]>([]),
  loading = ref(true),
  error = ref(""),
  total = ref(0),
  page = ref(1),
  type = ref("supervisor"),
  resultMonth = ref(props.tab.month);
let sequence = 0;
function updateTitle() {
  const name =
    stores.value.find((s) => s.id === props.tab.store)?.short_name ||
    stores.value.find((s) => s.id === props.tab.store)?.store_name ||
    "全部門市";
  props.tab.title = `巡店 · ${name} · ${props.tab.month}`;
}
async function load(reset = false) {
  if (reset) page.value = 1;
  const seq = ++sequence;
  loading.value = true;
  error.value = "";
  // M4 Q4：還沒手動選過月份時不帶 month，由伺服器回「最新有資料的月份」。
  const useDefault = !props.tab.payload?.monthChosen;
  const query = {
    month: useDefault ? "" : props.tab.month,
    store: props.tab.store,
    type: type.value,
  };
  try {
    const result = await api(
      `inspections?${new URLSearchParams({ ...query, overview: "true" })}`,
    );
    if (seq === sequence) {
      allRecords.value = result.records;
      coverage.value = result.coverage;
      canExport.value = result.canExport;
      total.value = result.total;
      resultMonth.value = result.month;
      props.tab.month = result.month;
      props.tab.payload = { ...props.tab.payload, monthChosen: true };
    }
  } catch (e) {
    if (seq === sequence) {
      error.value = (e as Error).message;
      allRecords.value = [];
      coverage.value = null;
      total.value = 0;
    }
  } finally {
    if (seq === sequence) loading.value = false;
  }
  updateTitle();
}
function createInspection() {
  const tab = work.open("inspection-editor", props.tab.store);
  tab.payload = { type: type.value };
}
async function changeMonth(month: string) {
  props.tab.month = month;
  props.tab.payload = { ...props.tab.payload, monthChosen: true };
  await load(true);
}
async function download() {
  exporting.value = true;
  error.value = "";
  try {
    const r = await fetch(
      `/api/workspace/inspection-export?month=${resultMonth.value}`,
      { credentials: "same-origin" },
    );
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || "匯出失敗");
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `巡店得分-${resultMonth.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}
watch(
  () => work.deletedInspectionIds.length,
  () => load(),
);
onMounted(async () => {
  try {
    stores.value = (await api("stores?module=inspections")).stores;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    loading.value = false;
  }
});
watch(
  () => session.data?.capabilities.managerInspections,
  (allowed) => {
    if (!allowed && type.value === "manager") {
      type.value = "supervisor";
      void load(true);
    }
  },
);
// 舊版評級徽章配色：8–10 紫、6–7 綠、4–5 黃、其餘紅。
function gradeTone(grade: string | number | null) {
  const n = parseInt(String(grade ?? "0"), 10) || 0;
  return n >= 8 ? "tone-top" : n >= 6 ? "tone-good" : n >= 4 ? "tone-mid" : "tone-low";
}
const status: Record<string, string> = {
  draft: "草稿",
  in_progress: "進行中",
  completed: "已完成",
  closed: "已結案",
};
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">門市營運 / 巡店紀錄</p>
      <h1>巡店列表</h1>
      <p class="muted">每份工作頁獨立保留門市與月份。</p>
    </div>
    <div class="module-actions">
      <button
        v-if="
          type === 'manager' &&
          session.data?.capabilities.compareInspections &&
          allRecords.length
        "
        data-testid="compare-entry"
        @click="work.open('inspection-compare', tab.store)"
      >
        督導 vs 經理 對比分析
      </button>
      <button
        v-if="session.data?.capabilities.createInspections"
        class="primary"
        @click="createInspection"
      >
        新增{{ type === "manager" ? "經理" : "督導" }}巡店
      </button>
      <button
        v-if="canExport"
        @click="download"
        :disabled="loading || exporting"
      >
        {{ exporting ? "匯出中…" : "匯出當月巡店得分" }}</button
      ><button @click="load()" :disabled="loading">重新整理</button>
    </div>
  </header>
  <form
    class="filter-bar"
    @submit.prevent="
      props.tab.payload = { ...props.tab.payload, monthChosen: true };
      load(true);
    "
  >
    <label
      >門市<select v-model="tab.store">
        <option value="">全部可查看門市</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">
          {{ s.store_code }} {{ s.short_name || s.store_name }}
        </option>
      </select></label
    >
    <label
      >月份<input
        type="month"
        v-model="tab.month"
        required
        min="2000-01"
        max="2099-12"
    /></label>
    <label
      >巡店類型<select v-model="type">
        <option value="supervisor">督導巡店</option>
        <option
          v-if="session.data?.capabilities.managerInspections"
          value="manager"
        >
          經理巡店
        </option>
      </select></label
    >
    <button class="primary" :disabled="loading">查詢紀錄</button>
  </form>
  <div v-if="error" class="notice error" role="alert">
    {{ error }} <button @click="load()">重試</button>
  </div>
  <div v-else-if="loading" class="empty" role="status">正在讀取巡店紀錄…</div>
  <template v-else>
    <InspectionOverview
      :month="resultMonth"
      :records="allRecords"
      :coverage="coverage"
      @month="changeMonth"
      @detail="(row) => work.open('inspection-detail', row.store_id, row.id)"
    />
    <div class="list-meta">
      <strong>{{ resultMonth }} 巡店紀錄</strong><span>{{ total }} 筆</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>巡店日期</th>
            <th>門市</th>
            <th>巡店人員</th>
            <th>流水號</th>
            <th>分數</th>
            <th>得分（滿分 10 分）</th>
            <th>狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in records" :key="row.id">
            <td>{{ formatTaipeiDate(row.inspection_date) || row.inspection_date }}</td>
            <td>
              <strong>{{ row.store?.short_name || row.store?.store_name || "未提供門市名稱" }}</strong
              ><small>{{ row.store?.store_code }}</small>
            </td>
            <td>{{ row.inspector }}</td>
            <td>{{ row.inspection_no || "尚無流水號" }}</td>
            <td data-col="score">
              <strong>{{ row.total_score ?? "—" }}</strong> /
              {{ row.max_possible_score ?? 220 }}
              <small
                v-if="Number(row.improvement_bonus) > 0"
                class="bonus-note"
                data-testid="bonus-note"
                >（含改善 +{{ row.improvement_bonus }}）</small
              >
            </td>
            <td data-col="grade">
              <span :class="['grade-badge', gradeTone(row.grade)]">{{
                row.grade ?? "-"
              }}</span>
            </td>
            <td>
              <span
                :class="[
                  'state-text',
                  row.status === 'completed' || row.status === 'closed'
                    ? 'done'
                    : '',
                ]"
                >{{ status[row.status] || row.status }}</span
              >
            </td>
            <td>
              <button
                @click="work.open('inspection-detail', row.store_id, row.id)"
              >
                查看明細
              </button>
              <button
                v-if="
                  type === 'manager' &&
                  row.status === 'completed' &&
                  session.data?.capabilities.compareInspections
                "
                @click="work.open('inspection-compare', row.store_id, row.id)"
              >
                比較督導巡店
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!records.length" class="empty">
      <h2>{{ resultMonth }} 沒有巡店紀錄</h2>
      <p>請調整門市或月份後重新查詢。</p>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }} 頁</span
      ><button :disabled="page <= 1" @click="page--">上一頁</button
      ><button :disabled="page * 20 >= total" @click="page++">下一頁</button>
    </footer>
  </template>
</template>
