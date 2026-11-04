<script setup lang="ts">
import PerformanceSummary from "../components/PerformanceSummary.vue";
import Modal from "../components/Modal.vue";
const saveFailed = ref(false);
const emit = defineEmits<{ access: [canViewBonus: boolean] }>();
import { ref, onMounted, watch, onBeforeUnmount, computed } from "vue";
import { api, type Store } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import { createThresholdRefreshGate, onThresholdsSaved } from "../performance-sync";
import { MONTHLY_THRESHOLDS } from "../../../lib/performance/bonus-calc";
import { usesCustomThresholds } from "../../../lib/workspace/performance-year";
const props = defineProps<{ tab: WorkTab; embedded?: boolean }>(),
  work = useWorkspace();
const stores = ref<Store[]>([]),
  rows = ref<any[]>([]),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  canEdit = ref(false),
  year = ref(Number(props.tab.month.slice(0, 4)));
const thresholds = ref<any>(null),
  canViewBonus = ref(false),
  importFile = ref<File | null>(null),
  importConfirm = ref(false),
  // W03-q1：照舊版，可不指定門市，依 Excel「門市代號」欄位一次匯入多間門市。
  importScope = ref<"current" | "excel">("current");
const customThresholds = computed(
  () =>
    !!thresholds.value &&
    usesCustomThresholds(thresholds.value.monthly, MONTHLY_THRESHOLDS),
);
function openTool(kind: "performance-thresholds") {
  const tab = work.open(kind, loaded.value.store);
  tab.month = String(loaded.value.year) + "-01";
  if (kind === "performance-thresholds") {
    tab.payload = JSON.parse(JSON.stringify(thresholds.value));
    tab.title =
      "獎金閾值 · " +
      (stores.value.find((s) => s.id === loaded.value.store)?.store_name ||
        "門市");
  }
}
async function importData() {
  if (!importFile.value) return;
  props.tab.busy = true;
  error.value = "";
  try {
    const body = new FormData();
    body.append("file", importFile.value);
    // 舊版：有選門市才帶 store_id（Excel 列沒有門市代號時的後備）；年份為目前選擇的年度。
    if (importScope.value === "current" && props.tab.store)
      body.append("store_id", props.tab.store);
    body.append("year", String(year.value));
    const r = await api("performance-tools/performance-import", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(180000),
    });
    if (r && r.success === false) {
      const errs: string[] = Array.isArray(r.errors) ? r.errors : [];
      const more = errs.length > 5 ? `\n...另有 ${errs.length - 5} 筆` : "";
      const details = errs.length ? `\n${errs.slice(0, 5).join("\n")}${more}` : "";
      throw new Error(`${r.error || "匯入失敗"}${details}`);
    }
    importConfirm.value = false;
    importFile.value = null;
    await load();
    message.value = `匯入完成：成功 ${r.imported} 筆，略過 ${r.skipped} 筆${r.errors?.length ? "；有警告請見主控台" : ""}`;
    if (r.errors?.length) console.warn("[Import]", r.errors);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
const loaded = ref({ store: "", year: 0 });
const queryChanged = computed(
  () =>
    loaded.value.store !== props.tab.store || loaded.value.year !== year.value,
);
const fields: [string, string][] = [
  ["business_days", "營業天數"],
  ["monthly_gross_profit_target", "毛利目標"],
  ["monthly_revenue_target", "營收目標"],
  ["monthly_customer_count_target", "客數目標"],
  ["last_month_rx_target", "處方目標"],
  ["monthly_gross_profit_actual", "實際毛利"],
  ["activity_day_gross_profit", "活動日毛利"],
  ["monthly_revenue_actual", "實際營收"],
  ["monthly_customer_count_actual", "實際客數"],
  ["last_month_rx_actual", "實際處方"],
  ["system_monthly_revenue", "系統營收"],
  ["self_pay_monthly_revenue", "自費營收"],
  ["monthly_true_gross_profit", "真實毛利"],
  ["system_monthly_gross_profit", "系統毛利"],
  ["monthly_long_term_care_gross_profit", "長照毛利"],
  ["monthly_rx_addon_makeup_gross_profit", "處方加成補足毛利"],
  ["monthly_theft_compensation_makeup_gross_profit", "失竊賠償補足毛利"],
  ["monthly_kamedis_deduction_gross_profit", "卡米迪斯扣除毛利"],
];
const form = ref<any>(
  props.tab.payload ? JSON.parse(JSON.stringify(props.tab.payload)) : {},
);
let snapshot = JSON.stringify(form.value);
watch(
  form,
  () => {
    props.tab.dirty = JSON.stringify(form.value) !== snapshot;
    message.value = "";
  },
  { deep: true, flush: "sync" },
);
const gate = createThresholdRefreshGate({
  currentStore: () => loaded.value.store,
  refresh: () => refreshThresholds(),
});
async function load() {
  return gate.track(doLoad);
}
async function doLoad() {
  loading.value = true;
  error.value = "";
  try {
    const r = await api(
      `performance?${new URLSearchParams({ year: String(year.value), store_id: props.tab.store })}`,
    );
    stores.value = r.stores;
    rows.value = r.records;
    props.tab.store = r.store || "";
    loaded.value = { store: props.tab.store, year: year.value };
    canEdit.value = r.canEdit;
    canViewBonus.value = r.canViewBonus;
    emit("access", !!r.canViewBonus);
    if (props.tab.kind === "performance")
      props.tab.month = String(year.value) + "-" + props.tab.month.slice(5, 7);
    thresholds.value = null;
    if (r.store && props.tab.kind === "performance")
      thresholds.value = await api(
        `performance-tools/thresholds?store_id=${encodeURIComponent(r.store)}`,
      );
    if (props.tab.kind === "performance")
      props.tab.title = `業績 · ${stores.value.find((s) => s.id === r.store)?.short_name || stores.value.find((s) => s.id === r.store)?.store_name || "門市"} · ${year.value}`;
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
function edit(month: number) {
  if (queryChanged.value) return;
  const row = rows.value.find((r) => r.month === month) || {
    store_id: props.tab.store,
    year: year.value,
    month,
    business_days: 26,
  };
  const tab = work.open("performance-edit", props.tab.store);
  tab.title = `業績 · ${year.value}/${month}`;
  tab.month = `${year.value}-${String(month).padStart(2, "0")}`;
  tab.payload = Object.fromEntries(
    [
      "id",
      "store_id",
      "year",
      "month",
      ...fields.map((f) => f[0]),
    ].map((k) => [k, row[k] ?? null]),
  );
}
async function save() {
  props.tab.busy = true;
  error.value = "";
  try {
    const body = Object.fromEntries(
      Object.entries(form.value).map(([k, v]) => [
        k,
        v === "" || (v === 0 && k !== "business_days") ? null : v,
      ]),
    );
    const saved = await api("performance", {
      method: "POST",
      body: JSON.stringify(body),
    });
    form.value.id = saved.record.id;
    snapshot = JSON.stringify(form.value);
    props.tab.dirty = false;
    message.value = "已儲存";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    saveFailed.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
if (props.tab.kind === "performance-edit") props.tab.save = save;
// W03-q4：閾值在另一個工作分頁（或瀏覽器分頁）儲存後，自動重新載入已開啟的年度頁。
let stopThresholdSync: (() => void) | null = null;
async function refreshThresholds() {
  const storeId = loaded.value.store;
  if (queryChanged.value) {
    // 使用者已改了查詢條件但還沒查詢：只更新閾值，不動目前選擇。
    try {
      thresholds.value = await gate.track(() =>
        api(`performance-tools/thresholds?store_id=${encodeURIComponent(storeId)}`),
      );
    } catch (e) {
      error.value = (e as Error).message;
    }
  } else await load();
  message.value = "獎金閾值已更新，年度頁已自動重新載入。";
}
onMounted(() => {
  load();
  if (props.tab.kind === "performance")
    stopThresholdSync = onThresholdsSaved((storeId) => gate.notify(storeId));
});
onBeforeUnmount(() => {
  delete props.tab.save;
  stopThresholdSync?.();
});
const money = (n: any) => (n == null ? "—" : Number(n).toLocaleString("zh-TW"));
</script>
<template>
  <header v-if="!embedded" class="page-heading">
    <div>
      <p class="eyebrow">營運 / 業績管理</p>
      <h1>
        {{
          tab.kind === "performance-edit"
            ? `${form.year} 年 ${form.month} 月業績`
            : "業績管理"
        }}
      </h1>
      <p class="muted">門市年度目標與每月實績</p>
    </div>
    <button v-if="tab.kind === 'performance'" @click="load" :disabled="loading">
      重新整理
    </button>
  </header>
  <p v-if="error" class="notice error" role="alert">
    {{ error }}
    <button v-if="tab.kind === 'performance'" @click="load">重試</button>
  </p>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <template v-if="tab.kind === 'performance'"
    ><form class="module-filters" @submit.prevent="load">
      <label
        >門市<select aria-label="門市" v-model="tab.store" :disabled="loading">
          <option v-for="s in stores" :value="s.id">
            {{ s.store_code }} {{ s.store_name }}
          </option>
        </select></label
      ><label
        >年度<input
          type="number"
          min="2000"
          max="2099"
          v-model.number="year"
          required /></label
      ><button class="primary" :disabled="loading">查詢業績</button>
      <div v-if="canEdit" class="performance-import">
        <label
          >匯入門市<select aria-label="匯入門市" v-model="importScope">
            <option value="current">目前所選門市（Excel 未填門市代號時使用）</option>
            <option value="excel">不指定門市（依 Excel 門市代號）</option>
          </select></label
        ><label
          >業績 Excel<input
            type="file"
            accept=".xlsx,.xls"
            :disabled="tab.busy || loading"
            @change="
              importFile =
                ($event.target as HTMLInputElement).files?.[0] || null
            " /></label
        ><button
          type="button"
          :disabled="!importFile || tab.busy || loading"
          @click="importConfirm = true"
        >
          匯入 Excel
        </button>
      </div>
    </form>
    <p v-if="queryChanged && !loading" class="notice">
      條件已變更，請先查詢業績再編輯。
    </p>
    <p v-if="loading" role="status">載入業績…</p>
    <template v-else-if="!error && thresholds">
      <section class="performance-thresholds">
        <header class="page-heading">
          <h2>獎金閾值設定（每人）</h2>
          <button
            v-if="canEdit"
            :disabled="queryChanged"
            @click="openTool('performance-thresholds')"
          >
            設定閾值
          </button>
        </header>
        <div class="module-form-grid">
          <section v-for="p in ['monthly', 'quarterly'] as const">
            <h3>{{ p === "monthly" ? "月" : "季" }}獎金閾值</h3>
            <dl>
              <template v-for="(t, i) in thresholds[p]"
                ><dt>
                  {{ t.label }} ·
                  {{
                    Number(i) === 0
                      ? "毛利目標"
                      : `毛利目標 + ${Number(i) * 1000} × 營業天數`
                  }}
                </dt>
                <dd>{{ money(t.baseAmount) }} 元／人</dd></template
              >
            </dl>
          </section>
        </div>
        <p class="muted">
          毛利 90%＋營業額 5%＋來客數 5%＋慢箋 10%；毛利未達標時獎金為
          0。扣除活動日後平均毛利低於第一檻，月獎金乘以 80%。營業天數支援 0.5
          天。
          <span v-if="customThresholds" class="custom-thresholds"
            >• 此門市使用自訂閾值</span
          >
        </p>
      </section>

      <PerformanceSummary
        :rows="rows"
        :monthly="thresholds.monthly"
        :quarterly="thresholds.quarterly"
        :can-edit="canEdit"
        :disabled="!tab.store || queryChanged"
        @edit="edit"
      />
    </template>
    <p v-else-if="!error && !stores.length" class="notice">
      沒有可查看的門市。
    </p>
    <Modal
      v-if="importConfirm"
      title="確認匯入業績"
      :busy="tab.busy"
      @cancel="importConfirm = false"
      ><p>
        {{ importFile?.name }}：{{
          importScope === "excel"
            ? "未指定門市，將依檔案內「門市代號」欄位匯入各門市"
            : "Excel 列未填門市代號時使用目前所選門市"
        }}；相同門市與年月的資料將依原匯入規則更新（後寫覆蓋）。
      </p>
      <p v-if="error" class="notice error">{{ error }}</p>
      <div class="dialog-actions">
        <button :disabled="tab.busy" @click="importConfirm = false">取消</button
        ><button class="primary" :disabled="tab.busy" @click="importData">
          確認匯入
        </button>
      </div></Modal
    >
  </template>
  <form v-else class="module-editor" @submit.prevent="save">
    <fieldset :disabled="!canEdit || tab.busy">
      <legend>每月目標與實績</legend>
      <div class="module-form-grid">
        <label v-for="[key, label] in fields"
          >{{ label
          }}<input
            type="number"
            :min="key === 'business_days' ? 0.5 : undefined"
            :max="key === 'business_days' ? 31 : undefined"
            :step="key === 'business_days' ? 0.5 : 'any'"
            :required="key === 'business_days'"
            v-model.number="form[key]"
        /></label>
      </div>
    </fieldset>
    <button v-if="canEdit" class="primary" :disabled="tab.busy || !tab.dirty">
      {{ tab.busy ? "儲存中…" : "儲存業績" }}
    </button>
  </form>
  <Modal v-if="saveFailed" title="儲存未完成" @cancel="saveFailed = false"
    ><p>{{ error }}</p>
    <p>編輯內容仍保留，可關閉此提示後修正或重試。</p>
    <div class="dialog-actions">
      <button class="primary" @click="saveFailed = false">返回編輯</button>
    </div></Modal
  >
</template>

<style scoped>
.performance-import {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-left: auto;
}
.custom-thresholds {
  margin-left: 8px;
  color: var(--accent, #2563eb);
}
.performance-import label {
  display: grid;
  gap: 8px;
}
.performance-import input {
  max-width: 300px;
  width: 100%;
  box-sizing: border-box;
}
.performance-thresholds {
  margin: 24px 0;
  border-block: 1px solid var(--line);
  padding: 20px 0;
}
.performance-thresholds h2 {
  font-size: 17px;
}
.performance-thresholds dt {
  font-size: 13px;
}
.performance-thresholds .page-heading {
  margin-bottom: 12px;
}
.performance-thresholds h3 {
  font-size: 14px;
  margin: 0 0 10px;
}
.performance-thresholds dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 16px;
  align-items: baseline;
}
.performance-thresholds dd {
  margin: 0;
  font-weight: 600;
}
.performance-thresholds .muted {
  font-size: 12px;
  line-height: 1.7;
}
.module-actions {
  margin-bottom: 20px;
}
</style>
