<script setup lang="ts">
import TopScrollTable from "../components/TopScrollTable.vue";
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, type Store } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import {
  prescriptionSaveError,
  prescriptionStatus,
  prescriptionStatusLabel,
  prescriptionTotal,
} from "../../../lib/workspace/prescription-rules";
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
  preview = ref<any>(null),
  previewStores = ref<any[]>([]),
  selections = ref<Record<string, string>>({}),
  aliases = ref<any[]>([]),
  aliasOpen = ref(false),
  aliasEditing = ref(""),
  aliasDraft = ref({ alias: "", store_id: "" }),
  aliasNew = ref({ alias: "", store_id: "" }),
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
// 舊版 calculatedTotal：缺少或格式錯誤為 null，顯示時一律一位小數。
const total = (r: any) => prescriptionTotal(r);
const totalText = (r: any) => {
  const t = total(r);
  return t === null ? "—" : t.toFixed(1);
};
const amount = (n: any) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 4 });
const status = (r: any) => prescriptionStatusLabel(prescriptionStatus(r));
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
  // 舊版 saveChanges：先在畫面檢查，格式錯誤不送出。
  for (const row of dirtyRows.value) {
    const problem = prescriptionSaveError(row);
    if (problem) {
      error.value = problem;
      return false;
    }
  }
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
// 上傳 → 預覽（不寫入）→ 選未知門市 → 確認匯入。伺服端在確認時會重新解析與驗證。
function importBody(mode: "preview" | "commit") {
  const body = new FormData();
  body.append("file", file.value as File);
  body.append("year_month", loaded.value);
  body.append("mode", mode);
  body.append("selections", JSON.stringify(selections.value));
  return body;
}
async function openPreview() {
  if (!file.value) return;
  props.tab.busy = true;
  error.value = "";
  message.value = "";
  selections.value = {};
  try {
    const r = await api("performance-tools/prescription-import", {
      method: "POST",
      body: importBody("preview"),
    });
    preview.value = r.plan;
    previewStores.value = r.stores || [];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
async function pickStore(key: string, storeId: string) {
  const next = { ...selections.value };
  if (storeId) next[key] = storeId;
  else delete next[key];
  selections.value = next;
  try {
    const r = await api("performance-tools/prescription-import", {
      method: "POST",
      body: importBody("preview"),
    });
    preview.value = r.plan;
  } catch {
    /* 重算失敗不影響已顯示的內容，確認匯入時伺服端會再驗證 */
  }
}
const pendingRows = computed(() =>
  (preview.value?.rows || []).filter((r: any) => !r.store),
);
const mismatchRows = computed(() =>
  (preview.value?.rows || []).filter((r: any) => r.mismatches.length > 0),
);
const errorRows = computed(() =>
  (preview.value?.rows || []).filter((r: any) => r.errors.length > 0),
);
const canConfirm = computed(
  () =>
    !!preview.value?.rows.length &&
    !pendingRows.value.length &&
    !errorRows.value.length,
);
const statusText = (r: any) =>
  ({
    mapped: "對照表",
    auto: "自動對上",
    matched: preview.value?.format === "gsheet" ? "你選的" : "門市代號",
    ambiguous: "有多家可能，請選擇",
    unknown: "找不到，請選擇",
  })[r.status as string] || "需修正";
const pair = (m: any) => `${amount(m.count)} 張 / ${amount(m.points)}`;
function closePreview() {
  if (props.tab.busy) return;
  preview.value = null;
  error.value = "";
}
async function upload() {
  if (!file.value || !canConfirm.value) return;
  props.tab.busy = true;
  error.value = "";
  try {
    const r = await api("performance-tools/prescription-import", {
      method: "POST",
      body: importBody("commit"),
    });
    preview.value = null;
    file.value = null;
    await load();
    await loadAliases();
    const notes = [
      r.saved_aliases ? `已把 ${r.saved_aliases} 個簡稱存進對照表` : "",
      r.mismatch_count
        ? `${r.mismatch_count} 間門市的加總與表上不符（已照實匯入）`
        : "",
    ].filter(Boolean);
    message.value = `已匯入 ${r.imported} 間門市${notes.length ? `（${notes.join("；")}）` : ""}`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
// 門市簡稱對照表：查看、新增、修改、刪除（一個簡稱只對一家門市）。
async function loadAliases() {
  try {
    aliases.value = (
      await api("performance-tools/prescription-aliases")
    ).aliases;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function aliasCall(path: string, init: RequestInit) {
  props.tab.busy = true;
  error.value = "";
  try {
    await api(path, init);
    await loadAliases();
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function addAlias() {
  if (!aliasNew.value.alias.trim() || !aliasNew.value.store_id) {
    error.value = "請填簡稱並選擇門市";
    return;
  }
  if (
    await aliasCall("performance-tools/prescription-aliases", {
      method: "POST",
      body: JSON.stringify(aliasNew.value),
    })
  )
    aliasNew.value = { alias: "", store_id: "" };
}
async function saveAlias(id: string) {
  if (
    await aliasCall(`performance-tools/prescription-aliases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(aliasDraft.value),
    })
  )
    aliasEditing.value = "";
}
async function removeAlias(a: any) {
  if (!window.confirm(`確定刪除簡稱「${a.alias}」的對照？`)) return;
  await aliasCall(`performance-tools/prescription-aliases/${a.id}`, {
    method: "DELETE",
  });
}
function editAlias(a: any) {
  aliasEditing.value = a.id;
  aliasDraft.value = { alias: a.alias, store_id: a.store_id };
}
const storeOptions = computed(() =>
  [...new Map(rows.value.map((r) => [r.store_id, r])).values()].sort((a, b) =>
    String(a.store_code).localeCompare(String(b.store_code)),
  ),
);
props.tab.save = save;
onBeforeUnmount(() => delete props.tab.save);
onMounted(() => {
  void load();
  void loadAliases();
});
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
        @submit.prevent="openPreview"
      >
        <button type="button" :disabled="tab.busy" @click="download">
          下載 Excel 範本</button
        ><label
          >處方箋 Excel（範本或 Google Sheet 下載的 xlsx）<input
            type="file"
            accept=".xlsx,.xls"
            :disabled="tab.busy || tab.dirty"
            @change="
              file = ($event.target as HTMLInputElement).files?.[0] || null
            " /></label
        ><button :disabled="!file || tab.dirty || tab.busy">預覽匯入</button>
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
                <td>{{ totalText(r) }}</td>
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
                ><strong>總慢箋 {{ totalText(r) }}</strong>
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
  <section
    v-if="mode === 'month' && loaded === period"
    class="rx-aliases"
    aria-label="門市簡稱對照表"
  >
    <h2>
      <button
        type="button"
        class="rx-alias-toggle"
        :aria-expanded="aliasOpen"
        @click="aliasOpen = !aliasOpen"
      >
        {{ aliasOpen ? "▾" : "▸" }} 門市簡稱對照表
      </button>
    </h2>
    <p class="muted">
      匯入 Google Sheet 時，表上的簡稱靠這張表對到門市。一個簡稱只對一家門市；一家門市可以有好幾個簡稱。
    </p>
    <template v-if="aliasOpen">
      <form v-if="canEdit" class="module-filters" @submit.prevent="addAlias">
        <label
          >新增簡稱<input
            v-model="aliasNew.alias"
            maxlength="40"
            placeholder="例如：南港"
        /></label>
        <label
          >對應門市<select v-model="aliasNew.store_id">
            <option value="">請選擇門市</option>
            <option
              v-for="s in storeOptions"
              :key="s.store_id"
              :value="s.store_id"
            >
              {{ s.store_code }} {{ s.store_name }}
            </option>
          </select></label
        ><button :disabled="tab.busy">新增簡稱</button>
      </form>
      <TopScrollTable label="門市簡稱對照表格">
        <table>
          <thead>
            <tr>
              <th>簡稱</th>
              <th>對應門市</th>
              <th v-if="canEdit">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!aliases.length">
              <td :colspan="canEdit ? 3 : 2">
                還沒有任何對照。第一次匯入時選的門市會自動記在這裡。
              </td>
            </tr>
            <tr v-for="a in aliases" :key="a.id" data-alias-row>
              <template v-if="aliasEditing === a.id">
                <td>
                  <input
                    v-model="aliasDraft.alias"
                    maxlength="40"
                    aria-label="修改簡稱"
                  />
                </td>
                <td>
                  <select
                    v-model="aliasDraft.store_id"
                    aria-label="修改對應門市"
                  >
                    <option
                      v-for="s in storeOptions"
                      :key="s.store_id"
                      :value="s.store_id"
                    >
                      {{ s.store_code }} {{ s.store_name }}
                    </option>
                  </select>
                </td>
                <td>
                  <button :disabled="tab.busy" @click="saveAlias(a.id)">
                    儲存簡稱
                  </button>
                  <button type="button" @click="aliasEditing = ''">取消</button>
                </td>
              </template>
              <template v-else>
                <td>{{ a.alias }}</td>
                <td>{{ a.store_code }} {{ a.store_name }}</td>
                <td v-if="canEdit">
                  <template v-if="a.editable">
                    <button
                      :disabled="tab.busy"
                      :aria-label="`修改簡稱 ${a.alias}`"
                      @click="editAlias(a)"
                    >
                      修改
                    </button>
                    <button
                      :disabled="tab.busy"
                      :aria-label="`刪除簡稱 ${a.alias}`"
                      @click="removeAlias(a)"
                    >
                      刪除
                    </button>
                  </template>
                  <small v-else>非你管理的門市</small>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </TopScrollTable>
    </template>
  </section>
  <Modal
    v-if="preview"
    title="匯入預覽"
    wide
    :busy="tab.busy"
    @cancel="closePreview"
  >
    <p class="muted">
      {{ loaded }} · {{ file?.name }}（{{
        preview.format === "gsheet"
          ? `Google Sheet 格式，讀取工作表「${preview.sheetName}」的「${preview.monthLabel}」那一組`
          : "一門市一列的範本格式"
      }}）。確認前不會寫入任何資料；表上沒有出現的門市不會被更動。
    </p>
    <p role="status">
      共 {{ preview.rows.length }} 間 · 待選門市 {{ pendingRows.length }} ·
      加總不符 {{ mismatchRows.length }}
      <template v-if="errorRows.length">
        · 有錯誤 {{ errorRows.length }}</template
      >
    </p>
    <p v-if="mismatchRows.length" class="notice">
      標黃的門市：表上「一般＋連續」和「加總」那一列對不起來。這只是提醒，仍可匯入，匯入的是一般與連續兩列的數字（加總列不寫入）。
    </p>
    <p v-if="pendingRows.length" class="notice">
      藍底的店別系統對不上門市，請選擇對應的門市。確認匯入時會記住你的選擇，下次同一個簡稱就會自動對上。
    </p>
    <p v-if="preview.ignoredLabels.length" class="muted">
      已略過總計用的列：{{ preview.ignoredLabels.join("、") }}
    </p>
    <TopScrollTable label="匯入預覽表格">
      <table>
        <thead>
          <tr>
            <th>{{ preview.format === "gsheet" ? "簡稱" : "門市代號" }}</th>
            <th>對應門市</th>
            <th>一般箋（張數／點值）</th>
            <th>慢箋（張數／點值）</th>
            <th>加總核對</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in preview.rows"
            :key="r.key + r.rowNo"
            :class="{
              'rx-error': r.errors.length,
              'rx-pending': !r.store && !r.errors.length,
              'rx-mismatch': r.store && r.mismatches.length && !r.errors.length,
            }"
            :data-status="r.status"
            data-preview-row
          >
            <th>
              {{ r.label }}<br /><small>第 {{ r.rowNo }} 列</small>
            </th>
            <td>
              <template
                v-if="
                  r.store && r.status !== 'ambiguous' && r.status !== 'unknown'
                "
              >
                {{ r.store.store_code }} {{ r.store.store_name }}<br /><small>{{
                  statusText(r)
                }}</small>
              </template>
              <template v-else>
                <select
                  :aria-label="`${r.label} 對應的門市`"
                  :value="selections[r.key] || ''"
                  @change="
                    pickStore(r.key, ($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="">請選擇門市…</option>
                  <option
                    v-for="s in r.candidates.length
                      ? r.candidates
                      : previewStores"
                    :key="s.id"
                    :value="s.id"
                  >
                    {{ s.store_code }} {{ s.store_name }}
                  </option>
                </select>
                <br /><small>{{ statusText(r) }}</small>
              </template>
            </td>
            <td>{{ pair(r.regular) }}</td>
            <td>{{ pair(r.chronic) }}</td>
            <td>
              <template v-if="r.errors.length"
                ><div v-for="e in r.errors" :key="e">{{ e }}</div></template
              >
              <template v-else-if="r.mismatches.length"
                ><div v-for="m in r.mismatches" :key="m">{{ m }}</div></template
              >
              <template v-else>{{
                preview.format === "gsheet" ? "相符" : "—"
              }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </TopScrollTable>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="closePreview">取消</button
      ><button
        class="primary"
        :disabled="tab.busy || !canConfirm"
        @click="upload"
      >
        {{
          pendingRows.length
            ? `還有 ${pendingRows.length} 間未選門市`
            : `確認匯入 ${preview.rows.length} 間`
        }}
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
.rx-mismatch > * {
  background: #fef9c3;
}
.rx-pending > * {
  background: #e0f2fe;
}
.rx-error > * {
  background: #fee2e2;
}
.rx-alias-toggle {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.rx-aliases {
  margin-top: 24px;
}
.annual-prescription td {
  font-size: 12px;
  line-height: 1.8;
  min-width: 185px;
}
</style>
