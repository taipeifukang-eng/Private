<script setup lang="ts">
import { ref } from "vue";
import {
  readRows,
  normalize,
  integrate,
  finalRows,
  download,
  type Row,
} from "../lib/inventory-files";
const emit = defineEmits<{ dirty: [value: boolean] }>();
const files = ref<Record<string, Row[]>>({}),
  names = ref<Record<string, string>>({}),
  error = ref(""),
  busy = ref(false),
  step = ref(1),
  result = ref<ReturnType<typeof integrate> | null>(null),
  external = ref<Row[] | null>(null),
  final = ref<Row[] | null>(null);
const formats: Record<string, string> = {
  external: "品號、品名、條碼、盤點數量（品號不可重複）",
  fks: "品號、品名、條碼、盤點數量、盤點儲位",
  pre: "品號、盤點數量、盤點儲位",
  modified: "貨號、數量、貨架、棚板、序號（序號僅作來源欄位，盤點儲位不使用）",
  internal: "品號、庫存量、該儲位盤點數量",
  missing: "品號、庫存量、盤點數量",
};
const descriptions: Record<string, string> = {
  pre: "★ 可同時選擇多個檔案",
  internal: "模組二產生的內部複盤資料（修正後，已包含外盤數據）",
  missing: "模組二產生的未盤點檔案（修正後）",
};
const inputs = [
  { key: "base", label: "1F當日商品資料（必填）" },
  { key: "external", label: "外盤公司原始檔" },
  { key: "pre", label: "預盤資料（選填）" },
  { key: "fks", label: "FKS0701盤點紀錄" },
  { key: "modified", label: "外盤公司盤點Stock明細檔" },
  { key: "internal", label: "修改後內部複盤資料" },
  { key: "missing", label: "修改後未盤點檔案" },
];
async function upload(e: Event, key: string) {
  const selected = Array.from((e.target as HTMLInputElement).files || []);
  if (!selected.length) return;
  busy.value = true;
  error.value = "";
  try {
    const rows: Row[] = [];
    for (const f of selected)
      rows.push(...normalize(await readRows(f, key === "base"), key));
    files.value[key] = rows;
    names.value[key] = selected.map((f) => f.name).join("、");
    if (["base", "pre", "fks", "modified"].includes(key)) result.value = null;
    external.value = null;
    final.value = null;
    emit("dirty", true);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    (e.target as HTMLInputElement).value = "";
  }
}
function clear(key: string) {
  delete files.value[key];
  delete names.value[key];
  if (["base", "pre", "fks", "modified"].includes(key)) result.value = null;
  external.value = null;
  final.value = null;
  emit("dirty", Object.keys(files.value).length > 0);
}
function run() {
  error.value = "";
  try {
    if (step.value < 3 && !files.value.base)
      throw new Error("請先選擇共用商品資料");
    if (step.value === 1) {
      if (!files.value.external || !files.value.fks)
        throw new Error("請選擇外盤原始檔與 FKS0701");
      const x = integrate(files.value.base, [
        ...files.value.external,
        ...files.value.fks,
      ]);
      const codes = new Set(x.diff.map((r) => r.品號));
      external.value = files.value.external
        .filter((r) => codes.has(r.品號))
        .map((r) => ({ 品號: r.品號 }));
    } else if (step.value === 2) {
      result.value = integrate(files.value.base, [
        ...(files.value.pre || []),
        ...(files.value.fks || []),
        ...(files.value.modified || []),
      ]);
      final.value = null;
    } else {
      if (!files.value.internal && !files.value.missing)
        throw new Error("請選擇至少一個已填寫檔案");
      final.value = finalRows(
        result.value?.zero || [],
        files.value.internal || [],
        files.value.missing || [],
      );
    }
    emit("dirty", true);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function save(rows: Row[], name: string) {
  try {
    await download(rows, name);
    if (step.value === 3) emit("dirty", false);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="offline-inventory">
    <h2>離線盤點匯入匯出工具</h2>
    <p class="muted">
      檔案僅在此瀏覽器處理。各步驟保留資料；請完成下載後再關閉工作頁。
    </p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <label class="file-row"
      ><span>{{ inputs[0].label }}</span
      ><small
        >此檔案供三個模組共用，請先上傳後再使用各模組功能<br />檔案第二列為欄位標題。</small
      ><input
        type="file"
        accept=".xlsx,.xls"
        :disabled="busy"
        @change="upload($event, 'base')"
      /><small
        >{{ names.base || "尚未選檔" }} ·
        {{ files.base?.length || 0 }} 筆</small
      ></label
    >
    <div class="module-actions">
      <button
        v-for="(label, i) in [
          '產出外盤複盤清單',
          '產出內部+外盤公司資料整合之複盤表與未盤表',
          '產出DPOS匯入檔案',
        ]"
        :class="{ primary: step === i + 1 }"
        @click="step = i + 1"
      >
        {{ i + 1 }}. {{ label }}
      </button>
    </div>
    <template v-for="input in inputs.slice(1)" :key="input.key"
      ><label
        v-if="
          (step === 1 && ['external', 'fks'].includes(input.key)) ||
          (step === 2 && ['pre', 'fks', 'modified'].includes(input.key)) ||
          (step === 3 && ['internal', 'missing'].includes(input.key))
        "
        class="file-row"
        ><span>{{ input.label }}</span
        ><small v-if="descriptions[input.key]">{{
          descriptions[input.key]
        }}</small
        ><small v-if="!['internal', 'missing'].includes(input.key)"
          >欄位：{{ formats[input.key] }}</small
        ><input
          type="file"
          accept=".xlsx,.xls"
          :multiple="input.key === 'pre'"
          :disabled="busy"
          @change="upload($event, input.key)"
        /><small
          >{{ names[input.key] || "尚未選檔" }} ·
          {{ files[input.key]?.length || 0 }} 筆
          <button
            v-if="files[input.key]"
            type="button"
            :disabled="busy"
            @click.prevent="clear(input.key)"
          >
            移除此檔
          </button></small
        ></label
      ></template
    >
    <p v-if="step === 2" class="muted">
      預盤資料、FKS0701盤點紀錄、外盤公司盤點Stock明細檔依實際來源選填；全部未選時，產生所有有庫存商品的未盤表。外盤儲位依貨架與棚板合併數量。
    </p>
    <p v-if="step === 3" class="notice">
      本次整合保留 {{ result?.zero.length || 0 }} 筆無盤差商品，會一起匯出。{{
        !result ? "若需要納入無盤差商品，請先完成步驟 2。" : ""
      }}
    </p>
    <button class="primary" :disabled="busy" @click="run">
      {{ busy ? "讀取檔案…" : "產生結果" }}
    </button>
    <div v-if="step === 1 && external" class="module-actions">
      <span>需複盤 {{ external.length }} 項</span
      ><button
        :disabled="!external.length"
        @click="save(external, '外盤應複盤清單')"
      >
        下載外盤應複盤清單
      </button>
    </div>
    <div v-if="step === 2 && result" class="module-actions">
      <button
        :disabled="!result.diff.length"
        @click="save(result.diff, '內部盤點複盤資料')"
      >
        下載內部複盤（{{ result.diff.length }} 筆）</button
      ><button
        :disabled="!result.missing.length"
        @click="save(result.missing, '系統有庫存但未盤點檔案')"
      >
        下載未盤表（{{ result.missing.length }} 筆）</button
      ><span>無盤差 {{ result.zero.length }} 項已保留</span>
    </div>
    <div v-if="step === 3 && final" class="module-actions">
      <span>結果 {{ final.length }} 項</span
      ><button
        :disabled="!final.length"
        @click="
          save(
            final,
            `${new Date().getMonth() + 1}月${new Date().getDate()}日盤點結果檔`,
          )
        "
      >
        下載 DPOS 結果檔
      </button>
    </div>
  </section>
</template>
<style scoped>
.file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border, #d9ddd2);
}
.file-row small {
  grid-column: 1/-1;
  color: var(--muted, #687261);
  overflow-wrap: anywhere;
}
.file-row input[type="file"] {
  width: 100%;
  max-width: 640px;
  box-sizing: border-box;
}
.module-actions button {
  white-space: normal;
  text-align: left;
  overflow-wrap: anywhere;
}
.module-actions {
  margin: 22px 0;
  flex-wrap: wrap;
}
@media (max-width: 700px) {
  .file-row {
    grid-template-columns: 1fr;
  }
}
</style>
