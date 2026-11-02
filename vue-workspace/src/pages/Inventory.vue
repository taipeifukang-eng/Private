<script setup lang="ts">
const saveFailed = ref(false);
import { ref, watch, onMounted, onBeforeUnmount, computed } from "vue";
import { api } from "../api";
import { useSession, type WorkTab } from "../stores";
import InventoryOffline from "../components/InventoryOffline.vue";
import { readRows, validate, code, download } from "../lib/inventory-files";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>(),
  session = useSession();
const store = ref(
    session.data?.stores.find((s) => s.id === props.tab.store)?.store_code ||
      "",
  ),
  order = ref(""),
  batch = ref(""),
  view = ref("batch"),
  data = ref<any>({ batches: [], items: [] }),
  error = ref(""),
  message = ref(""),
  loading = ref(false),
  search = ref(""),
  confirmation = ref(false),
  file = ref<File | null>(null),
  recount = ref(false);
const importDialog = ref(false),
  importError = ref(""),
  importTarget = ref<any>(null),
  importMonth = ref(""),
  importOrder = ref("");
function openImport(isRecount: boolean) {
  if (isRecount && (!selected.value || loading.value)) return;
  recount.value = isRecount;
  file.value = null;
  importError.value = "";
  importTarget.value = isRecount ? { ...selected.value } : null;
  importMonth.value = isRecount
    ? selected.value.year_month || props.tab.month
    : props.tab.month;
  importOrder.value = isRecount
    ? selected.value.inventory_order_no || ""
    : order.value;
  importDialog.value = true;
}
const reasons = ref<Record<string, string>>({});
let baseline: Record<string, string> = {};
const canOffline = computed(() =>
  session.data?.permissions.some((p) =>
    [
      "inventory.manage",
      "inventory.inventory.access",
      "inventory.inventory.view",
    ].includes(p),
  ),
);
const section = ref("analysis"),
  offlineDirty = ref(false),
  analysisDirty = ref(false);
function syncDirty() {
  props.tab.dirty = offlineDirty.value || analysisDirty.value;
}
const category = ref(""),
  exclude = ref(false),
  diffOnly = ref(false),
  requiredOnly = ref(false),
  sort = ref("product_code"),
  descending = ref(false),
  page = ref(1),
  threshold = ref(100);
function sortBy(key: string) {
  if (sort.value === key) descending.value = !descending.value;
  else {
    sort.value = key;
    descending.value = false;
  }
}
function sortState(key: string): "ascending" | "descending" | "none" {
  return sort.value === key
    ? descending.value
      ? "descending"
      : "ascending"
    : "none";
}
function sortMark(key: string) {
  return sort.value === key ? (descending.value ? " ↓" : " ↑") : " ↕";
}
const detailColumns = computed(
  () =>
    [
      { key: "product_code", label: "品號" },
      { key: "product_name", label: "品名" },
      { key: "category_code", label: "分類" },
      { key: "unit", label: "單位" },
      { key: "storage_location_1", label: "儲位" },
      ...(view.value === "recount_changes"
        ? [
            {
              key: "initial_difference_qty",
              label: "第一次盤差量",
              numeric: true,
            },
            { key: "initial_cost", label: "第一次成本", numeric: true },
            {
              key: "recount_difference_qty",
              label: "再次盤差量",
              numeric: true,
            },
            { key: "recount_cost", label: "再次成本", numeric: true },
            { key: "difference_qty_delta", label: "盤差量加總", numeric: true },
            { key: "cost_delta", label: "成本異動", numeric: true },
          ]
        : [
            { key: "stock_qty", label: "庫存量", numeric: true },
            { key: "difference_qty", label: "盤差量", numeric: true },
            { key: "cost", label: "成本", numeric: true },
            {
              key: "difference_amount_member",
              label: "會員價盤差金額",
              numeric: true,
            },
            { key: "stock_amount", label: "庫存金額", numeric: true },
          ]),
    ] as { key: string; label: string; numeric?: boolean }[],
);
const visible = computed(() =>
  data.value.items
    .filter(
      (r: any) =>
        (r.product_code + " " + r.product_name).includes(search.value.trim()) &&
        (!category.value || r.category_code === category.value) &&
        (!exclude.value ||
          !["01", "97", "98", "99"].includes(r.category_code)) &&
        (!diffOnly.value || Number(r.difference_qty) !== 0) &&
        (!requiredOnly.value ||
          Math.abs(Number(r.cost)) >
            Number(data.value.difference_reason_cost_threshold ?? 100)),
    )
    .sort((a: any, b: any) => {
      const x = a[sort.value],
        y = b[sort.value];
      return (
        (typeof x === "number"
          ? x - y
          : String(x ?? "").localeCompare(String(y ?? ""), "zh-TW", {
              numeric: true,
            })) * (descending.value ? -1 : 1)
      );
    }),
);
const pages = computed(() =>
  Math.max(1, Math.ceil(visible.value.length / 200)),
);
const paged = computed(() =>
  visible.value.slice(
    (Math.min(page.value, pages.value) - 1) * 200,
    Math.min(page.value, pages.value) * 200,
  ),
);
watch(
  [search, category, exclude, diffOnly, requiredOnly, sort, descending],
  () => (page.value = 1),
);
let loadedView = "batch";
const summary = computed(() =>
  category.value
    ? (data.value.category_summary || []).find(
        (r: any) => r.category_code === category.value,
      )
    : data.value.non_excluded_summary,
);
const topLoss = computed(() =>
  visible.value
    .filter((r: any) => r.cost < 0)
    .sort((a: any, b: any) => a.cost - b.cost)
    .slice(0, 10),
);
const topGain = computed(() =>
  visible.value
    .filter((r: any) => r.cost > 0)
    .sort((a: any, b: any) => b.cost - a.cost)
    .slice(0, 10),
);
const selected = computed(() =>
  data.value.batches.find((r: any) => r.id === batch.value),
);
const missingReasons = computed(
  () =>
    data.value.items.filter(
      (r: any) =>
        Math.abs(Number(r.cost)) >
          Number(data.value.difference_reason_cost_threshold ?? 100) &&
        !String(reasons.value[r.id] || "").trim(),
    ).length,
);
async function saveThreshold() {
  error.value = "";
  props.tab.busy = true;
  try {
    await api("inventory", {
      method: "PATCH",
      body: JSON.stringify({
        action: "update_threshold",
        amount: threshold.value,
      }),
    });
    data.value.difference_reason_cost_threshold = threshold.value;
    message.value = "門檻已儲存";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
async function exportReasons() {
  try {
    await download(
      visible.value.map((r: any) =>
        view.value === "recount_changes"
          ? {
              品號: code(r.product_code),
              品名: r.product_name,
              第一次盤差量: r.initial_difference_qty,
              第一次成本: r.initial_cost,
              再次盤差量: r.recount_difference_qty,
              再次成本: r.recount_cost,
              盤差量加總: r.difference_qty_delta,
              成本異動: r.cost_delta,
            }
          : {
              品號: code(r.product_code),
              品名: r.product_name,
              盤差量: r.difference_qty,
              盤差原因: reasons.value[r.id] ?? r.difference_reason ?? "",
            },
      ),
      `盤差原因_${props.tab.month}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function importReasons(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  error.value = "";
  try {
    const rows = validate(await readRows(f), [
      "品號",
      "品名",
      "盤差量",
      "盤差原因",
    ]);
    const mapped = new Map(
      rows.map((r) => [code(r.品號), String(r.盤差原因 || "")]),
    );
    let count = 0;
    const next = { ...reasons.value };
    for (const r of data.value.items) {
      if (mapped.has(code(r.product_code))) {
        next[r.id] = mapped.get(code(r.product_code))!;
        count++;
      }
    }
    if (!count) throw new Error("檔案品號與目前批次沒有相符資料");
    reasons.value = next;
    message.value = `已載入 ${count} 筆原因，請核對後儲存`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    input.value = "";
  }
}
const categoriesOpen = ref(true);
const integerFormat = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});
function whole(value: any) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n)
    ? integerFormat.format(Math.abs(n) < 0.5 ? 0 : n)
    : "—";
}
const sortedCategories = computed(() =>
  [...(data.value.category_summary || [])].sort((a: any, b: any) =>
    String(a.category_code).localeCompare(String(b.category_code), "zh-TW", {
      numeric: true,
    }),
  ),
);
const canImport = computed(() => session.data?.capabilities.importInventory);
const canDelete = computed(() => session.data?.capabilities.deleteInventory);
watch(
  reasons,
  () => {
    analysisDirty.value =
      JSON.stringify(reasons.value) !== JSON.stringify(baseline);
    syncDirty();
    message.value = "";
  },
  { deep: true, flush: "sync" },
);
async function load() {
  if (analysisDirty.value) {
    error.value = "此頁有未儲存的盤差原因，請先儲存再查詢。";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await api(
      `inventory?${new URLSearchParams({ year_month: props.tab.month, store: store.value, order_no: order.value, batch_id: batch.value, view: view.value })}`,
    );
    if (!r.selected_batch_id && r.batches.length && !batch.value) {
      batch.value = r.batches[0].id;
      await load();
      return;
    }
    r.batches.sort(
      (a: any, b: any) =>
        String(a.store_code).localeCompare(String(b.store_code), "zh-TW", {
          numeric: true,
        }) ||
        String(a.inventory_order_no).localeCompare(
          String(b.inventory_order_no),
          "zh-TW",
          { numeric: true },
        ) ||
        (a.report_round || 0) - (b.report_round || 0),
    );
    data.value = r;
    loadedView = view.value;
    threshold.value = r.difference_reason_cost_threshold ?? 100;
    page.value = 1;
    batch.value = r.selected_batch_id || "";
    baseline = Object.fromEntries(
      r.items.map((i: any) => [i.id, i.difference_reason || ""]),
    );
    reasons.value = { ...baseline };
    props.tab.title = `盤點 · ${props.tab.month}`;
  } catch (e) {
    error.value = (e as Error).message;
    batch.value = data.value.selected_batch_id || "";
    view.value = loadedView;
  } finally {
    loading.value = false;
  }
}
async function save() {
  props.tab.busy = true;
  error.value = "";
  try {
    for (const row of data.value.items) {
      if (reasons.value[row.id] === baseline[row.id]) continue;
      await api("inventory", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_reason",
          item_id: row.id,
          reason: reasons.value[row.id],
        }),
      });
      baseline[row.id] = reasons.value[row.id];
    }
    analysisDirty.value = false;
    syncDirty();
    message.value = "盤差原因已儲存";
    return true;
  } catch (e) {
    analysisDirty.value =
      JSON.stringify(reasons.value) !== JSON.stringify(baseline);
    syncDirty();
    error.value = (e as Error).message;
    saveFailed.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function upload() {
  if (!file.value || analysisDirty.value || props.tab.busy) return;
  props.tab.busy = true;
  error.value = "";
  importError.value = "";
  try {
    const form = new FormData();
    form.append("file", file.value);
    form.append("year_month", importMonth.value);
    if (importOrder.value) form.append("inventory_order_no", importOrder.value);
    if (recount.value)
      form.append(
        "recount_parent_batch_id",
        importTarget.value?.parent_batch_id || importTarget.value?.id,
      );
    const imported = await api("inventory", { method: "POST", body: form });
    file.value = null;
    importDialog.value = false;
    batch.value = "";
    await load();
    message.value = `已匯入 ${imported.imported_batches} 批、${imported.imported_rows} 筆；取代 ${imported.replaced_batches} 批。`;
    if (imported.errors?.length)
      error.value = `部分資料未匯入：${imported.errors.join("；")}`;
  } catch (e) {
    importError.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
async function remove() {
  props.tab.busy = true;
  try {
    await api(`inventory?batch_id=${encodeURIComponent(batch.value)}`, {
      method: "DELETE",
    });
    batch.value = "";
    confirmation.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    confirmation.value = false;
  } finally {
    props.tab.busy = false;
  }
}
function exportCsv() {
  const quote = (v: any) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const lines = [
    [
      "品號",
      "品名",
      "分類",
      "單位",
      "儲位1",
      "儲位2",
      "盤差量",
      "成本",
      "會員價盤差金額",
      "庫存量",
      "庫存金額",
      "盤差原因",
    ],
    ...visible.value.map((r: any) => [
      r.product_code,
      r.product_name,
      r.category_code,
      r.unit,
      r.storage_location_1,
      r.storage_location_2,
      r.difference_qty,
      r.cost,
      r.difference_amount_member,
      r.stock_qty,
      r.stock_amount,
      reasons.value[r.id],
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff" + lines.map((r) => r.map(quote).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `盤點-${props.tab.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
props.tab.save = async () => {
  if (offlineDirty.value) {
    error.value = "離線資料請先下載結果；無法存入資料庫。";
    return false;
  }
  return save();
};
onBeforeUnmount(() => {
  delete props.tab.save;
});
onMounted(load);
</script>
<template>
  <div class="module-actions">
    <button
      v-if="canOffline"
      :class="{ primary: section === 'offline' }"
      @click="section = 'offline'"
    >
      離線盤點匯入匯出工具</button
    ><button
      :class="{ primary: section === 'analysis' }"
      @click="section = 'analysis'"
    >
      盤點結果分析報表
    </button>
  </div>
  <InventoryOffline
    v-if="canOffline"
    v-show="section === 'offline'"
    @dirty="
      offlineDirty = $event;
      syncDirty();
    "
  />
  <section v-show="section === 'analysis'">
    <header class="page-heading">
      <div>
        <p class="eyebrow">營運 / 盤點</p>
        <h1>盤點結果分析報表</h1>
        <p class="muted">盤點結果、複盤比對與盤差原因</p>
      </div>
      <div class="heading-actions">
        <button
          v-if="canImport"
          class="primary"
          @click="openImport(false)"
          :disabled="loading || tab.busy || analysisDirty"
        >
          匯入盤點 Excel</button
        ><button @click="load" :disabled="loading || tab.busy || analysisDirty">
          重新整理
        </button>
      </div>
    </header>
    <form
      class="module-filters"
      @submit.prevent="
        batch = '';
        load();
      "
    >
      <label
        >月份<input
          type="month"
          v-model="tab.month"
          required
          :disabled="analysisDirty || loading || tab.busy" /></label
      ><label
        >門市代碼或名稱<input
          v-model="store"
          :disabled="analysisDirty || loading || tab.busy" /></label
      ><label
        >盤點單號<input
          v-model="order"
          :disabled="analysisDirty || loading || tab.busy" /></label
      ><button class="primary" :disabled="loading || tab.busy || analysisDirty">
        查詢盤點
      </button>
    </form>
    <p v-if="error" class="notice error" role="alert">
      {{ error }}
      <button @click="load" :disabled="analysisDirty || loading || tab.busy">
        重試
      </button>
    </p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <div class="module-filters">
      <label
        >盤點批次<select
          v-model="batch"
          @change="load"
          :disabled="loading || analysisDirty || tab.busy"
        >
          <option value="">選擇批次</option>
          <option v-for="b in data.batches" :value="b.id">
            {{ b.store_code }} {{ b.store_name }} · {{ b.inventory_order_no }} ·
            {{ b.report_label || b.report_kind }}
          </option>
        </select></label
      ><label
        >報表檢視<select
          v-model="view"
          @change="load"
          :disabled="analysisDirty || loading || tab.busy"
        >
          <option value="batch">本次盤點</option>
          <option value="merged">合併複盤結果</option>
          <option value="recount_changes">複盤差異</option>
        </select></label
      >
    </div>
    <div v-if="canImport && selected && !loading" class="recount-import">
      <div>
        <strong>爭議再次盤點</strong>
        <p class="muted">
          {{ selected.store_code }} {{ selected.store_name }} ·
          {{ selected.inventory_order_no }} ·
          {{ selected.year_month || tab.month }}
        </p>
      </div>
      <button @click="openImport(true)" :disabled="tab.busy || analysisDirty">
        匯入爭議再次盤點
      </button>
    </div>
    <div v-if="selected" class="batch-information">
      <p class="muted">
        {{ selected.source_file_name }} · 匯入時間 {{ selected.imported_at }} ·
        {{ selected.report_label }} · {{ selected.row_count }} 筆
      </p>
      <button
        v-if="canDelete"
        class="danger"
        @click="confirmation = true"
        :disabled="!batch || loading || tab.busy || analysisDirty"
      >
        刪除
      </button>
    </div>
    <div v-if="summary" class="inventory-summary">
      <strong
        >{{ category ? "選取分類" : "排除 01／97／98／99 類別" }}摘要</strong
      ><span>統計筆數 {{ whole(summary.row_count) }} 筆</span
      ><span>盤盈成本 {{ whole(summary.positive_cost_total) }}</span
      ><span>盤虧成本 {{ whole(summary.negative_cost_total) }}</span
      ><span>淨盤差成本 {{ whole(summary.net_cost_total) }}</span
      ><span>庫存金額 {{ whole(summary.stock_amount_total) }}</span
      ><span class="cost-ratio"
        ><span
          >成本佔比
          {{
            summary.stock_amount_total
              ? (
                  (Number(summary.net_cost_total) /
                    Number(summary.stock_amount_total)) *
                  100
                ).toFixed(2) + "%"
              : "—"
          }}</span
        ><small class="muted">(正負加總成本/庫存額總額)</small></span
      >
    </div>
    <section class="category-analysis" aria-label="分類統計">
      <header class="category-heading">
        <div>
          <h2>
            分類統計 <small>{{ whole(sortedCategories.length) }} 類</small>
          </h2>
          <p class="muted">
            點選分類，同步查看摘要、前十名與明細；再次點選可取消。
          </p>
        </div>
        <div class="heading-actions">
          <button v-if="category" @click="category = ''">清除分類篩選</button
          ><button
            :aria-expanded="categoriesOpen"
            @click="categoriesOpen = !categoriesOpen"
          >
            {{ categoriesOpen ? "收折分類" : "展開分類" }}
          </button>
        </div>
      </header>
      <div v-if="categoriesOpen" class="category-grid">
        <button
          v-for="c in sortedCategories"
          :key="c.category_code"
          type="button"
          class="category-card"
          :class="{ selected: category === c.category_code }"
          :aria-pressed="category === c.category_code"
          @click="
            category = category === c.category_code ? '' : c.category_code
          "
        >
          <span class="category-title"
            ><strong>{{ c.category_code }} {{ c.category_name }}</strong
            ><span>{{
              category === c.category_code ? "已選取" : "查看分類"
            }}</span></span
          >
          <span class="category-counts"
            >總品項 {{ whole(c.row_count) }} · 有盤差
            {{
              whole(
                Number(c.shortage_count || 0) + Number(c.surplus_count || 0),
              )
            }}
            · 盤差量 {{ whole(c.total_difference_qty) }}</span
          >
          <span class="category-metrics">
            <span
              ><span>盤盈成本</span
              ><strong>{{ whole(c.positive_cost_total) }}</strong></span
            >
            <span
              ><span>盤虧成本</span
              ><strong>{{ whole(c.negative_cost_total) }}</strong></span
            >
            <span class="net-cost"
              ><span>淨盤差成本</span
              ><strong>{{ whole(c.net_cost_total) }}</strong></span
            >
            <span
              ><span>庫存金額</span
              ><strong>{{ whole(c.stock_amount_total) }}</strong></span
            >
          </span>
        </button>
        <p v-if="!sortedCategories.length" class="muted">
          {{
            loading ? "載入分類統計…" : "目前沒有分類統計，請先選擇盤點批次。"
          }}
        </p>
      </div>
    </section>
    <div class="module-filters">
      <label
        >分類<select v-model="category">
          <option value="">全部分類</option>
          <option v-for="c in data.category_summary" :value="c.category_code">
            {{ c.category_code }} {{ c.category_name }}
          </option>
        </select></label
      >
      <div class="detail-filter-cards" aria-label="明細篩選">
        <button
          type="button"
          :aria-pressed="exclude"
          :class="{ active: exclude }"
          @click="exclude = !exclude"
        >
          <strong>排除 01／97／98／99</strong
          ><span>{{ exclude ? "已啟用" : "未啟用" }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="diffOnly"
          :class="{ active: diffOnly }"
          @click="diffOnly = !diffOnly"
        >
          <strong>只看盤差不等於0</strong
          ><span>{{ diffOnly ? "已啟用" : "未啟用" }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="requiredOnly"
          :class="{ active: requiredOnly }"
          @click="requiredOnly = !requiredOnly"
        >
          <strong>填寫盤差原因</strong
          ><span>{{ requiredOnly ? "已啟用" : "未啟用" }}</span>
        </button>
      </div>
      <div
        v-if="data.can_manage_difference_reason_threshold"
        class="threshold-controls"
      >
        <label
          >門檻<input
            type="number"
            min="0"
            v-model.number="threshold"
            :disabled="tab.busy"
        /></label>
        <button :disabled="tab.busy || threshold < 0" @click="saveThreshold">
          儲存門檻
        </button>
      </div>
    </div>
    <div class="module-actions">
      <span
        >成本超過 ±{{ data.difference_reason_cost_threshold ?? 100 }} 須填原因 ·
        尚缺 {{ missingReasons }} 項</span
      ><button :disabled="!visible.length" @click="exportReasons">
        匯出原因 Excel</button
      ><label v-if="view === 'batch' && batch"
        >匯入盤差原因<input
          type="file"
          accept=".xlsx,.xls"
          :disabled="tab.busy"
          @change="importReasons"
      /></label>
    </div>
    <details class="module-import">
      <summary>盤虧／盤盈成本前十名（目前篩選範圍）</summary>
      <div class="inventory-ranking">
        <div v-for="(rows, index) in [topLoss, topGain]">
          <h3>{{ index ? "盤盈" : "盤虧" }}前十名</h3>
          <ol>
            <li v-for="r in rows">
              {{ r.product_code }} {{ r.product_name }}：{{ whole(r.cost) }}
            </li>
          </ol>
          <p v-if="!rows.length">無符合資料</p>
        </div>
      </div>
    </details>
    <div class="module-actions">
      <label>搜尋品號或品名<input v-model="search" type="search" /></label
      ><button @click="exportCsv" :disabled="!visible.length">
        匯出目前明細</button
      ><button
        class="primary"
        @click="save"
        :disabled="!analysisDirty || tab.busy"
      >
        儲存盤差原因</button
      ><span>{{ visible.length }} 筆明細</span>
    </div>
    <p v-if="loading" role="status">載入盤點結果…</p>
    <div v-else class="module-table">
      <table>
        <thead>
          <tr>
            <th
              v-for="column in detailColumns"
              :key="column.key"
              :aria-sort="sortState(column.key)"
            >
              <button
                class="sort-heading"
                @click="sortBy(column.key)"
                :aria-label="`${column.label}排序`"
              >
                {{ column.label }}{{ sortMark(column.key) }}
              </button>
            </th>
            <th>盤差原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paged" :key="r.id">
            <td
              v-for="column in detailColumns"
              :key="column.key"
              :class="{ numeric: column.numeric }"
            >
              <template v-if="column.key === 'category_code'"
                >{{ r.category_code }} {{ r.category_name }}</template
              >
              <template v-else-if="column.key === 'storage_location_1'"
                >{{ r.storage_location_1 }}<br />{{
                  r.storage_location_2
                }}</template
              >
              <template v-else-if="column.numeric">{{
                r[column.key] == null &&
                ["difference_qty_delta", "cost_delta"].includes(column.key)
                  ? "新增"
                  : whole(r[column.key])
              }}</template>
              <template v-else>{{ r[column.key] || "—" }}</template>
            </td>
            <td>
              <input
                v-if="view === 'batch'"
                v-model="reasons[r.id]"
                :aria-label="`${r.product_name} 盤差原因`"
                :disabled="tab.busy"
              /><span v-else>{{ r.difference_reason || "—" }}</span>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td :colspan="detailColumns.length + 1">
              沒有符合條件的盤點明細。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="module-actions">
      <button :disabled="page <= 1" @click="page--">上一頁</button
      ><span>{{ Math.min(page, pages) }} / {{ pages }} 頁 · 每頁 200 筆</span
      ><button :disabled="page >= pages" @click="page++">下一頁</button>
    </div>
    <Modal
      v-if="importDialog"
      :title="recount ? '匯入爭議再次盤點' : '匯入盤點 Excel'"
      :busy="tab.busy"
      @cancel="importDialog = false"
    >
      <p v-if="recount">
        {{ importTarget.store_code }} {{ importTarget.store_name }} ·
        {{ importTarget.inventory_order_no }}
      </p>
      <p v-if="recount" class="muted">
        將新增此門市盤點單的再次盤點版本，保留第一次盤點資料。
      </p>
      <p v-else class="muted">
        沿用既有盤點檔格式；同門市、月份及單號的資料會依原匯入規則更新。
      </p>
      <p>匯入年月：{{ importMonth }}</p>
      <p v-if="!recount && importOrder">盤點單號：{{ importOrder }}</p>
      <label class="import-file"
        >{{ recount ? "爭議再次盤點 Excel 檔案" : "盤點 Excel 檔案"
        }}<input
          type="file"
          accept=".xlsx,.xls"
          :disabled="tab.busy"
          @change="
            file = ($event.target as HTMLInputElement).files?.[0] || null
          "
      /></label>
      <p v-if="importError" class="notice error" role="alert">
        {{ importError }}
      </p>
      <div class="dialog-actions">
        <button :disabled="tab.busy" @click="importDialog = false">取消</button
        ><button
          class="primary"
          :disabled="!file || tab.busy || analysisDirty"
          @click="upload"
        >
          {{ tab.busy ? "匯入中…" : "確認匯入" }}
        </button>
      </div>
    </Modal>
    <Modal
      v-if="confirmation"
      title="刪除盤點批次"
      :busy="tab.busy"
      @cancel="confirmation = false"
      ><p>將刪除目前批次及其明細，無法復原。</p>
      <div class="dialog-actions">
        <button @click="confirmation = false" :disabled="tab.busy">取消</button
        ><button class="danger" @click="remove" :disabled="tab.busy">
          確認刪除
        </button>
      </div></Modal
    ><Modal v-if="saveFailed" title="儲存未完成" @cancel="saveFailed = false"
      ><p>{{ error }}</p>
      <p>編輯內容仍保留，可關閉此提示後修正或重試。</p>
      <div class="dialog-actions">
        <button class="primary" @click="saveFailed = false">返回編輯</button>
      </div></Modal
    >
  </section>
</template>

<style scoped>
.threshold-controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.threshold-controls label {
  display: grid;
  gap: 8px;
}
.threshold-controls input {
  width: 110px;
  box-sizing: border-box;
}
.cost-ratio {
  display: grid;
  gap: 5px;
}
.cost-ratio small {
  font-size: 12px;
}
.detail-filter-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.detail-filter-cards button {
  display: grid;
  gap: 8px;
  min-width: 170px;
  text-align: left;
  padding: 14px 18px;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.detail-filter-cards button span {
  font-size: 12px;
  color: var(--muted);
}
.detail-filter-cards button.active {
  border-color: var(--brand, #526b45);
  box-shadow: inset 4px 0 0 var(--brand, #526b45);
}
.sort-heading {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 4px 0;
  min-height: 32px;
  white-space: nowrap;
}
.sort-heading:hover {
  text-decoration: underline;
}
.numeric {
  font-variant-numeric: tabular-nums;
}
.detail-filter-cards button:focus-visible,
.sort-heading:focus-visible {
  outline: 2px solid var(--brand, #526b45);
  outline-offset: 2px;
}

.batch-information {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.batch-information p {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.batch-information button {
  flex-shrink: 0;
}
.category-analysis {
  margin: 24px 0;
  border-block: 1px solid var(--line);
  padding: 20px 0;
}
.category-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.category-heading h2 {
  font-size: 18px;
  margin: 0;
}
.category-heading h2 small {
  font-size: 13px;
  color: var(--muted);
  font-weight: 400;
  margin-left: 8px;
}
.category-heading p {
  margin: 6px 0 0;
}
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 14px;
}
.category-card {
  display: block;
  text-align: left;
  padding: 18px;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 6px;
  white-space: normal;
  min-width: 0;
}
.category-card:hover {
  border-color: var(--muted);
}
.category-card.selected {
  border-color: var(--brand, #526b45);
  box-shadow: inset 4px 0 0 var(--brand, #526b45);
}
.category-card:focus-visible {
  outline: 2px solid var(--brand, #526b45);
  outline-offset: 3px;
}
.category-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.category-title strong {
  font-size: 16px;
  overflow-wrap: anywhere;
}
.category-title > span {
  font-size: 12px;
  white-space: nowrap;
  color: var(--muted);
}
.category-counts {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin: 10px 0 14px;
  font-weight: 400;
}
.category-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.category-metrics > span {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.category-metrics > span > span {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}
.category-metrics strong {
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.category-metrics .net-cost strong {
  font-weight: 750;
}

.heading-actions,
.recount-import {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.recount-import {
  padding: 18px 0;
  border-block: 1px solid var(--border, #d9ddd2);
  margin: 16px 0;
}
.recount-import p {
  margin: 6px 0 0;
}
.import-file {
  display: grid;
  gap: 12px;
  margin: 20px 0;
}
.import-file input {
  max-width: 100%;
  box-sizing: border-box;
}
.check-label {
  display: flex !important;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.check-label input[type="checkbox"] {
  width: 18px;
  min-height: 18px;
  height: 18px;
}
.inventory-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 20px 0;
  border-block: 1px solid var(--border, #d9ddd2);
  margin: 20px 0;
}
.inventory-ranking {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.module-actions,
.module-filters {
  flex-wrap: wrap;
}
@media (max-width: 700px) {
  .inventory-ranking {
    grid-template-columns: 1fr;
  }
}
</style>
