<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import { bonusColumns } from "../performance-bonus-columns";
const props = defineProps<{ tab: WorkTab; embedded?: boolean }>();
const ym = ref(props.tab.month),
  quarter = ref(""),
  store = ref(props.tab.store),
  supervisor = ref(""),
  employee = ref(""),
  bonus = ref(""),
  averageMode = ref("continuous_employee"),
  stores = ref<any[]>([]),
  rows = ref<any[]>([]),
  average = ref<any>(null),
  error = ref(""),
  averageError = ref(""),
  message = ref(""),
  loading = ref(false),
  canImport = ref(false),
  file = ref<File | null>(null),
  confirmImport = ref(false),
  sort = ref("store"),
  direction = ref(1),
  loaded = ref("");
const filters = computed(() =>
  JSON.stringify([
    ym.value,
    quarter.value,
    store.value,
    supervisor.value,
    averageMode.value,
  ]),
);
const supervisors = computed(() => [
  ...new Map(
    stores.value
      .filter((s) => s.supervisor_id)
      .map((s) => [
        s.supervisor_id,
        { id: s.supervisor_id, name: s.supervisor_name },
      ]),
  ).values(),
]);
const availableStores = computed(() =>
  stores.value.filter(
    (s) => !supervisor.value || s.supervisor_id === supervisor.value,
  ),
);
watch(supervisor, () => {
  store.value = "";
});
const cols = computed(() =>
  bonus.value ? bonusColumns.filter((c) => c[0] === bonus.value) : bonusColumns,
);
const storeInfo = (r: any) =>
  Array.isArray(r.store) ? r.store[0] || {} : r.store || {};
const sum = (r: any) =>
  cols.value.reduce((s, c) => s + Number(r[c[0]] || 0), 0);
const value = (r: any, key: string) =>
  key === "store"
    ? storeInfo(r).store_code
    : key === "total"
      ? sum(r)
      : (r[key] ?? "");
const visible = computed(() =>
  rows.value
    .filter(
      (r) =>
        `${r.employee_code} ${r.employee_name}`
          .toLowerCase()
          .includes(employee.value.trim().toLowerCase()) &&
        bonusColumns.some((c) => Number(r[c[0]] || 0) !== 0),
    )
    .sort((a, b) => {
      const x = value(a, sort.value),
        y = value(b, sort.value);
      return (
        direction.value *
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "zh-Hant", { numeric: true }))
      );
    }),
);
const filteredBonusTotal = computed(() =>
  visible.value.reduce((total, row) => total + sum(row), 0),
);
const amount = (v: any) =>
  Number(v || 0).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
function sortBy(key: string) {
  if (sort.value === key) direction.value *= -1;
  else {
    sort.value = key;
    direction.value = 1;
  }
}
async function selectAverage(mode: string) {
  if (loading.value || props.tab.busy || averageMode.value === mode) return;
  averageMode.value = mode;
  await load();
}
async function load() {
  loading.value = true;
  error.value = "";
  averageError.value = "";
  average.value = null;
  try {
    const base = new URLSearchParams();
    if (store.value) base.set("store_id", store.value);
    else if (supervisor.value) base.set("supervisor_id", supervisor.value);
    const periods = quarter.value
      ? [0, 1, 2].map(
          (i) =>
            `${ym.value.slice(0, 4)}-${String((Number(quarter.value) - 1) * 3 + i + 1).padStart(2, "0")}`,
        )
      : [ym.value];
    const result = await Promise.all(
      periods.map((p) =>
        api(`performance-tools/bonus?${base}&year_month=${p}`),
      ),
    );
    if (quarter.value) {
      const grouped = new Map<string, any>();
      for (const r of result.flatMap((d) => d.records)) {
        const key = r.store_id + ":" + r.employee_code;
        if (!grouped.has(key))
          grouped.set(key, {
            ...r,
            ...Object.fromEntries(bonusColumns.map((c) => [c[0], 0])),
            other_bonus_note: "",
          });
        const target = grouped.get(key);
        for (const c of bonusColumns) target[c[0]] += Number(r[c[0]] || 0);
        if (r.other_bonus_note)
          target.other_bonus_note +=
            [r.year_month, r.other_bonus_note].join(" ") + "\n";
      }
      rows.value = [...grouped.values()];
    } else rows.value = result[0].records;
    loaded.value = filters.value;
    props.tab.title = `獎金 · ${quarter.value ? ym.value.slice(0, 4) + " Q" + quarter.value : ym.value}`;
    try {
      average.value = await api(
        `performance-tools/bonus-averages?${base}&average_mode=${averageMode.value}`,
      );
    } catch (e) {
      averageError.value = (e as Error).message;
    }
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
async function upload() {
  if (!file.value) return;
  props.tab.busy = true;
  error.value = "";
  try {
    const body = new FormData();
    body.append("file", file.value);
    body.append("year", ym.value.slice(0, 4));
    if (store.value) body.append("store_id", store.value);
    const r = await api("performance-tools/bonus-import", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(180000),
    });
    confirmImport.value = false;
    file.value = null;
    await load();
    message.value = `匯入 ${r.imported} 筆、略過 ${r.skipped ?? 0} 筆；月份：${(r.importedMonths || []).join("、")}。${(r.errors || []).join("；")}`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(async () => {
  try {
    const [s, meta] = await Promise.all([
      api("performance-tools/bonus-stores"),
      api(
        `performance?year=${ym.value.slice(0, 4)}&store_id=${props.tab.store}`,
      ),
    ]);
    stores.value = s.data;
    canImport.value = meta.canImportBonus;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <header v-if="!embedded" class="page-heading">
    <div>
      <p class="eyebrow">業績 / 每月獎金</p>
      <h1>匯入每月獎金</h1>
      <p class="muted">查閱員工各項獎金、季度合計與年度平均。</p>
    </div>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="message" role="status" class="notice">{{ message }}</p>
  <form class="module-filters" @submit.prevent="load">
    <fieldset :disabled="loading || tab.busy" class="module-filters">
      <label>年月<input type="month" v-model="ym" required /></label
      ><label
        >季別<select aria-label="季別" v-model="quarter">
          <option value="">單月</option>
          <option v-for="q in 4" :value="String(q)">Q{{ q }}</option>
        </select></label
      ><label
        >督導<select aria-label="督導" v-model="supervisor">
          <option value="">全部督導</option>
          <option v-for="s in supervisors" :value="s.id">{{ s.name }}</option>
        </select></label
      ><label
        >門市<select aria-label="門市" v-model="store">
          <option value="">全部門市</option>
          <option v-for="s in availableStores" :value="s.id">
            {{ s.store_code }} {{ s.store_name }}
          </option>
        </select></label
      >
      <label>員工代號／姓名<input v-model="employee" type="search" /></label
      ><label
        >獎金項目<select aria-label="獎金項目" v-model="bonus">
          <option value="">全部項目</option>
          <option v-for="c in bonusColumns" :value="c[0]">{{ c[1] }}</option>
        </select></label
      >
      <div class="average-mode" role="group" aria-label="平均方式">
        <span>平均方式</span>
        <div class="average-mode-cards">
          <button
            type="button"
            :aria-pressed="averageMode === 'continuous_employee'"
            :class="{ active: averageMode === 'continuous_employee' }"
            @click="selectAverage('continuous_employee')"
          >
            每月皆存在員工</button
          ><button
            type="button"
            :aria-pressed="averageMode === 'person_month'"
            :class="{ active: averageMode === 'person_month' }"
            @click="selectAverage('person_month')"
          >
            人月平均
          </button>
        </div>
      </div>
      <button class="primary">查詢獎金</button>
    </fieldset>
  </form>
  <form
    v-if="canImport"
    class="module-filters"
    @submit.prevent="confirmImport = true"
  >
    <label
      >獎金 Excel<input
        type="file"
        accept=".xlsx,.xls"
        :disabled="tab.busy"
        @change="
          file = ($event.target as HTMLInputElement).files?.[0] || null
        " /></label
    ><button :disabled="!file || tab.busy || loading">匯入獎金</button>
  </form>
  <p v-if="loading" role="status">載入獎金…</p>
  <p v-else-if="loaded !== filters" class="notice">條件已變更，請重新查詢。</p>
  <template v-else>
    <section aria-label="年度累積平均獎金">
      <h2>年度累積平均獎金</h2>
      <p v-if="averageError" class="notice error">
        {{ averageError }} <button @click="load">重試</button>
      </p>
      <template v-if="average"
        ><p>
          {{ average.start_year_month }} 至 {{ average.as_of_year_month }} ·
          {{ average.employee_count }} 人 ·
          {{ average.person_month_count }} 人月 ·
          {{ average.imported_month_count }} 個匯入月份
        </p>
        <dl class="average-results">
          <div
            v-for="c in [
              ['average_single_item_bonus', '平均單品＋品牌'],
              ['average_group_bonus', '平均團體＋季回補＋人力補貼'],
              ['average_manager_group_bonus', '店長群平均團體'],
              ['average_staff_group_bonus', '同仁平均團體'],
            ]"
          >
            <dt>{{ c[1] }}</dt>
            <dd>{{ amount(average[c[0]]) }} 元</dd>
          </div>
        </dl>
        <p class="muted">
          只計入符合資格規則的正職專員以上人員；每月皆存在員工與人月平均使用不同分母。
        </p></template
      >
    </section>
    <div class="bonus-table-summary">
      <p>{{ visible.length }} 筆 · 全部獎金為零的紀錄不列入。</p>
      <p class="bonus-total" role="status" aria-label="獎金合計">
        獎金合計 <strong>{{ amount(filteredBonusTotal) }}</strong> 元
      </p>
    </div>
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th
              v-for="c in [
                ['store', '門市'],
                ['employee_code', '員工代號'],
                ['employee_name', '姓名'],
                ...cols,
                ['total', '合計'],
              ]"
              :aria-sort="
                sort === c[0]
                  ? direction === 1
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              "
            >
              <button @click="sortBy(c[0])">
                {{ c[1] }}
                {{ sort === c[0] ? (direction === 1 ? "↑" : "↓") : "" }}
              </button>
            </th>
            <th>其他獎金說明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visible">
            <th>{{ storeInfo(r).store_code }} {{ storeInfo(r).store_name }}</th>
            <td>{{ r.employee_code }}</td>
            <td>{{ r.employee_name }}</td>
            <td v-for="c in cols">{{ amount(r[c[0]]) }}</td>
            <td>{{ amount(sum(r)) }}</td>
            <td>{{ r.other_bonus_note }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!visible.length" class="notice">
      沒有符合條件的獎金紀錄。
    </p></template
  >
  <Modal
    v-if="confirmImport"
    title="確認匯入每月獎金"
    :busy="tab.busy"
    @cancel="confirmImport = false"
    ><p>
      {{
        file?.name
      }}。檔案可包含多個月份；相同門市、年月與員工會依既有規則合併，明確填入的 0
      也會更新。
    </p>
    <p v-if="error" class="notice error">{{ error }}</p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="confirmImport = false">取消</button
      ><button class="primary" :disabled="tab.busy" @click="upload">
        確認匯入
      </button>
    </div></Modal
  >
</template>
<style scoped>
.bonus-table-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 20px 0 12px;
}
.bonus-table-summary p {
  margin: 0;
}
.bonus-total {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.bonus-total strong {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.average-mode {
  display: grid;
  gap: 8px;
}
.average-mode > span {
  font-size: 13px;
  font-weight: 600;
}
.average-mode-cards {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.average-mode-cards button {
  padding: 12px 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  border-radius: 6px;
}
.average-mode-cards button.active {
  border-color: var(--primary);
  background: var(--soft);
  box-shadow: inset 0 -3px 0 var(--primary);
}
.module-filters {
  flex-wrap: wrap;
}

fieldset {
  border: 0;
  padding: 0;
}
.average-results {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.average-results dd {
  margin: 8px 0;
  font-weight: 600;
}
th,
td {
  white-space: nowrap;
}
td:last-child {
  white-space: pre-wrap;
  min-width: 180px;
}
</style>
