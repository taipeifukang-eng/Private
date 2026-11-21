<script setup lang="ts">
import { ref } from "vue";
import {
  readRows,
  normalize,
  integrate,
  finalRows,
  download,
  buildInventoryFileName,
  processFilesIndividually,
  summarizePerFile,
  mergeOkFiles,
  conflictsToText,
  type Conflict,
  type Row,
} from "../lib/inventory-files";
const emit = defineEmits<{ dirty: [value: boolean] }>();
const files = ref<Record<string, Row[]>>({}),
  names = ref<Record<string, string>>({}),
  error = ref(""),
  info = ref(""),
  warn = ref(""),
  conflicts = ref<Conflict[]>([]),
  copied = ref(false),
  preFiles = ref<Record<string, Row[]>>({}),
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
function resetOutputs(key: string) {
  if (["base", "pre", "fks", "modified"].includes(key)) result.value = null;
  external.value = null;
  final.value = null;
  conflicts.value = [];
  info.value = "";
}
function syncPre() {
  const names_ = Object.keys(preFiles.value);
  if (names_.length) {
    files.value.pre = names_.flatMap((n) => preFiles.value[n]);
    names.value.pre = names_.join("、");
  } else {
    delete files.value.pre;
    delete names.value.pre;
  }
}
async function upload(e: Event, key: string) {
  const selected = Array.from((e.target as HTMLInputElement).files || []);
  if (!selected.length) return;
  busy.value = true;
  error.value = "";
  warn.value = "";
  try {
    if (key === "pre") {
      // 預盤可多檔：每個檔案各自處理，壞檔跳過並列出原因；已成功的檔案保留，失敗檔可單獨重傳。
      const r = await processFilesIndividually(
        selected.map((f) => ({ name: f.name, read: () => readRows(f) })),
        "pre",
      );
      const s = summarizePerFile(r);
      if (s.level === "error") error.value = s.text;
      else {
        preFiles.value = mergeOkFiles(preFiles.value, r.okFiles);
        syncPre();
        resetOutputs(key);
        emit("dirty", true);
        if (s.level === "warn") warn.value = s.text;
        else info.value = s.text;
      }
    } else {
      const rows: Row[] = [];
      for (const f of selected)
        rows.push(...normalize(await readRows(f, key === "base"), key));
      files.value[key] = rows;
      names.value[key] = selected.map((f) => f.name).join("、");
      resetOutputs(key);
      emit("dirty", true);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    (e.target as HTMLInputElement).value = "";
  }
}
function removePre(name: string) {
  const next = { ...preFiles.value };
  delete next[name];
  preFiles.value = next;
  syncPre();
  resetOutputs("pre");
  warn.value = "";
  emit("dirty", Object.keys(files.value).length > 0);
}
function clear(key: string) {
  delete files.value[key];
  delete names.value[key];
  if (key === "pre") preFiles.value = {};
  resetOutputs(key);
  warn.value = "";
  emit("dirty", Object.keys(files.value).length > 0);
}
function run() {
  error.value = "";
  info.value = "";
  conflicts.value = [];
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
      if (!external.value.length) info.value = "沒有需要複盤的品項";
    } else if (step.value === 2) {
      result.value = integrate(files.value.base, [
        ...(files.value.pre || []),
        ...(files.value.fks || []),
        ...(files.value.modified || []),
      ]);
      final.value = null;
      if (!result.value.diff.length && !result.value.missing.length)
        info.value = "無盤差且無未盤點品項";
    } else {
      if (!files.value.internal && !files.value.missing)
        throw new Error("請選擇至少一個已填寫檔案");
      const r = finalRows(
        result.value?.zero || [],
        files.value.internal || [],
        files.value.missing || [],
      );
      if (r.ok) final.value = r.rows;
      else {
        // 有衝突就不產出檔案，一次列出全部衝突。
        final.value = null;
        conflicts.value = r.conflicts;
      }
    }
    emit("dirty", true);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function copyConflicts() {
  try {
    await navigator.clipboard.writeText(conflictsToText(conflicts.value));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    error.value = "無法複製，請自行選取清單文字";
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
    <p v-if="warn" class="notice warn" role="status" data-testid="per-file-summary">{{ warn }}</p>
    <p v-if="info" class="notice" role="status" data-testid="offline-info">{{ info }}</p>
    <section
      v-if="conflicts.length"
      class="notice error conflicts"
      role="alert"
      data-testid="final-conflicts"
    >
      <p>
        <strong>發現 {{ conflicts.length }} 項衝突，未產出檔案。</strong
        >請修正後重新上傳。
        <button type="button" @click="copyConflicts">
          {{ copied ? "已複製" : "複製清單" }}
        </button>
      </p>
      <ul>
        <li v-for="(c, i) in conflicts" :key="c.code + c.kind + i">
          <strong>{{ c.code }}</strong> {{ c.detail }}：<span
            v-for="(p, j) in c.places"
            :key="j"
            >{{ j ? "；" : "" }}{{ p.source }}（庫存量 {{ p.stock ?? "-"
            }}<template v-if="p.qty != null">、盤點量 {{ p.qty }}</template
            >）</span
          >
        </li>
      </ul>
    </section>
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
        ><small v-if="input.key === 'pre' && Object.keys(preFiles).length"
          >已收下：<span
            v-for="(rows_, n) in preFiles"
            :key="n"
            class="pre-file"
            >{{ n }}（{{ rows_.length }} 筆）<button
              type="button"
              :disabled="busy"
              :aria-label="'移除 ' + n"
              @click.prevent="removePre(n)"
            >
              ×
            </button></span
          ></small
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
        @click="save(external, buildInventoryFileName('externalRecount'))"
      >
        下載外盤應複盤清單
      </button>
    </div>
    <div v-if="step === 2 && result" class="module-actions">
      <button
        :disabled="!result.diff.length"
        @click="save(result.diff, buildInventoryFileName('internalRecount'))"
      >
        下載內部複盤（{{ result.diff.length }} 筆）</button
      ><button
        :disabled="!result.missing.length"
        @click="save(result.missing, buildInventoryFileName('uninventoried'))"
      >
        下載未盤表（{{ result.missing.length }} 筆）</button
      ><span>無盤差 {{ result.zero.length }} 項已保留</span>
    </div>
    <div v-if="step === 3 && final" class="module-actions">
      <span>結果 {{ final.length }} 項</span
      ><button
        :disabled="!final.length"
        @click="save(final, buildInventoryFileName('result'))"
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
.notice {
  white-space: pre-line;
}
.conflicts ul {
  margin: 8px 0 0;
  padding-left: 20px;
  max-height: 320px;
  overflow: auto;
}
.pre-file {
  display: inline-block;
  margin-right: 10px;
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
