<script setup lang="ts">
import TopScrollTable from "../components/TopScrollTable.vue";
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, type Store } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab; embedded?: boolean }>();
const year = ref(Number(props.tab.month.slice(0, 4))),
  month = ref(props.tab.month),
  mode = ref("year"),
  rows = ref<any[]>([]),
  search = ref(""),
  error = ref(""),
  message = ref(""),
  loading = ref(false),
  canEdit = ref(false),
  file = ref<File | null>(null),
  confirmImport = ref(false),
  baseline = ref<Record<string, string>>({}),
  loaded = ref(""),
  loadedMode = ref("year");
const fields = [
  ["regular_prescription_count", "一般箋張數"],
  ["regular_prescription_point_value", "一般箋點值"],
  ["chronic_prescription_count", "慢箋張數"],
  ["chronic_prescription_point_value", "慢箋點值"],
];
const signature = (r: any) =>
  JSON.stringify(fields.map((f) => (r[f[0]] === "" ? null : r[f[0]])));
const dirtyRows = computed(() =>
  mode.value === "month" &&
  loadedMode.value === "month" &&
  loaded.value === month.value
    ? rows.value.filter((r) => baseline.value[r.store_id] !== signature(r))
    : [],
);
watch(
  dirtyRows,
  () => {
    props.tab.dirty = dirtyRows.value.length > 0;
    message.value = "";
  },
  { flush: "sync" },
);
const period = computed(() =>
  mode.value === "year" ? String(year.value) : month.value,
);
const visible = computed(() =>
  rows.value.filter((r) =>
    (r.store_code + " " + r.store_name).includes(search.value.trim()),
  ),
);
const annualStores = computed(() => [
  ...new Map(visible.value.map((r) => [r.store_id, r])).values(),
]);
const total = (r: any) => {
  const a = r.regular_prescription_count,
    b = r.chronic_prescription_count;
  if (a == null || a === "" || b == null || b === "") return null;
  return Math.round((Number(a) / 4 + Number.EPSILON) * 10) / 10 + Number(b);
};
const amount = (n: any) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 4 });
const status = (r: any) => {
  const count = fields.filter((f) => r[f[0]] != null && r[f[0]] !== "").length;
  return count === 0 ? "未填" : count === 4 ? "完整" : "部分填寫";
};
async function load() {
  if (props.tab.dirty) {
    error.value = "請先儲存目前草稿再切換查詢。";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const [r, meta] = await Promise.all([
      api(
        `performance-tools/prescription?${mode.value === "year" ? "year" : "year_month"}=${period.value}`,
      ),
      api(`performance?year=${year.value}&store_id=${props.tab.store}`),
    ]);
    rows.value = r.records;
    canEdit.value = meta.canEdit;
    baseline.value = Object.fromEntries(
      rows.value.map((r) => [r.store_id, signature(r)]),
    );
    loaded.value = period.value;
    loadedMode.value = mode.value;
    props.tab.title = `處方箋 · ${period.value}`;
    props.tab.dirty = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function openMonth(m: number) {
  if (props.tab.dirty) return;
  mode.value = "month";
  month.value = `${year.value}-${String(m).padStart(2, "0")}`;
  await load();
}
async function save() {
  if (!dirtyRows.value.length) return true;
  props.tab.busy = true;
  error.value = "";
  try {
    const records = dirtyRows.value.map((r) => ({
      store_id: r.store_id,
      ...Object.fromEntries(
        fields.map((f) => [f[0], r[f[0]] === "" ? null : r[f[0]]]),
      ),
    }));
    await api("performance-tools/prescription", {
      method: "POST",
      body: JSON.stringify({ year_month: loaded.value, records }),
    });
    baseline.value = Object.fromEntries(
      rows.value.map((r) => [r.store_id, signature(r)]),
    );
    props.tab.dirty = false;
    message.value = `已儲存 ${records.length} 間門市`;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function download() {
  error.value = "";
  try {
    const response = await fetch(
      `/api/workspace/performance-tools/prescription-template?year_month=${month.value}`,
    );
    if (!response.ok) throw Error((await response.json()).error || "下載失敗");
    const url = URL.createObjectURL(await response.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = `處方箋匯入範本_${month.value}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function upload() {
  if (!file.value) return;
  props.tab.busy = true;
  error.value = "";
  try {
    const body = new FormData();
    body.append("file", file.value);
    body.append("year_month", loaded.value);
    const r = await api("performance-tools/prescription-import", {
      method: "POST",
      body,
    });
    confirmImport.value = false;
    file.value = null;
    await load();
    message.value = `已匯入 ${r.imported} 間門市`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = save;
onBeforeUnmount(() => delete props.tab.save);
onMounted(load);
</script>
<template>
  <header v-if="!embedded" class="page-heading">
    <div>
      <p class="eyebrow">業績 / 處方箋</p>
      <h1>處方箋報表</h1>
      <p class="muted">
        一般箋張數 ÷ 4（四捨五入至一位小數）＋慢箋張數＝總慢箋張數
      </p>
    </div>
  </header>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <form class="module-filters" @submit.prevent="load">
    <fieldset
      :disabled="tab.dirty || tab.busy || loading"
      class="module-filters"
    >
      <label
        >檢視<select aria-label="檢視" v-model="mode">
          <option value="year">年度總覽</option>
          <option value="month">單月編輯</option>
        </select></label
      ><label v-if="mode === 'year'"
        >年份<input
          type="number"
          min="2018"
          max="2100"
          v-model.number="year"
          required /></label
      ><label v-else>月份<input type="month" v-model="month" required /></label
      ><button class="primary">查詢處方箋</button>
    </fieldset>
    <label>搜尋門市<input v-model="search" type="search" /></label>
  </form>
  <p v-if="loading" role="status">載入處方箋…</p>
  <p v-else-if="loaded !== period" class="notice">條件已變更，請重新查詢。</p>
  <template v-else-if="!error || rows.length"
    ><template v-if="mode === 'month'"
      ><form
        v-if="canEdit"
        class="module-filters"
        @submit.prevent="confirmImport = true"
      >
        <button type="button" :disabled="tab.busy" @click="download">
          下載 Excel 範本</button
        ><label
          >處方箋 Excel<input
            type="file"
            accept=".xlsx,.xls"
            :disabled="tab.busy || tab.dirty"
            @change="
              file = ($event.target as HTMLInputElement).files?.[0] || null
            " /></label
        ><button :disabled="!file || tab.dirty || tab.busy">匯入處方箋</button>
      </form>
      <form @submit.prevent="save">
        <TopScrollTable label="處方箋表格">
          <table>
            <thead>
              <tr>
                <th>門市</th>
                <th v-for="f in fields">{{ f[1] }}</th>
                <th>總慢箋張數</th>
                <th>資料狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in visible">
                <th>{{ r.store_code }} {{ r.store_name }}</th>
                <td v-for="f in fields">
                  <input
                    v-if="canEdit"
                    :aria-label="`${r.store_code} ${f[1]}`"
                    type="number"
                    min="0"
                    :step="f[0].endsWith('count') ? 1 : 0.0001"
                    :disabled="tab.busy"
                    v-model="r[f[0]]"
                  /><span v-else>{{ amount(r[f[0]]) }}</span>
                </td>
                <td>{{ amount(total(r)) }}</td>
                <td>{{ status(r) }}</td>
              </tr>
            </tbody>
          </table>
        </TopScrollTable>
        <button
          v-if="canEdit"
          class="primary"
          :disabled="!tab.dirty || tab.busy"
        >
          儲存處方箋（{{ dirtyRows.length }} 間門市）
        </button>
      </form></template
    >
    <TopScrollTable v-else label="處方箋表格">
      <table class="annual-prescription">
        <thead>
          <tr>
            <th>門市</th>
            <th v-for="m in 12">
              <button @click="openMonth(m)">{{ m }} 月</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in annualStores">
            <th>{{ s.store_code }} {{ s.store_name }}</th>
            <td v-for="m in 12">
              <template
                v-for="r in rows.filter(
                  (r) =>
                    r.store_id === s.store_id &&
                    r.year_month === `${year}-${String(m).padStart(2, '0')}`,
                )"
                ><strong>總慢箋 {{ amount(total(r)) }}</strong>
                <div v-for="f in fields">{{ f[1] }}：{{ amount(r[f[0]]) }}</div>
                <small>{{ status(r) }}</small></template
              >
            </td>
          </tr>
        </tbody>
      </table>
    </TopScrollTable>
    <p v-if="!visible.length" class="notice">沒有符合條件的門市。</p></template
  >
  <Modal
    v-if="confirmImport"
    title="確認匯入處方箋"
    :busy="tab.busy"
    @cancel="confirmImport = false"
    ><p>
      {{ loaded }} · {{ file?.name }}。檔案內的門市資料將更新，空白欄位會清空。
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
fieldset {
  border: 0;
  padding: 0;
}
td input {
  min-width: 120px;
  max-width: 160px;
}
.annual-prescription {
  min-width: 2500px;
}
.annual-prescription td {
  font-size: 12px;
  line-height: 1.8;
  min-width: 185px;
}
</style>
