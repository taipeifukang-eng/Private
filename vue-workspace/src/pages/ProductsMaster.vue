<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import { downloadXlsx, pickColumns, readSheet } from "../lib/xlsx";
import { IMPORT_ALIASES, MAX_IMPORT_ROWS } from "../../../lib/products-master/rules";

// 商品主檔（M6 W27/W28）：清單（分頁、搜尋、顯示已停用）、單筆新增與編輯（編號不可改）、停用與重新啟用、
// Excel 匯入（先預覽再確認）。本頁只有 store.products_master.manage 的人看得到。
const props = defineProps<{ tab: WorkTab }>();
type Product = { id: string; product_code: string; product_name: string; unit: string; is_active: boolean };
type Counts = { total: number; inserted: number; updated: number; reactivated: number; skipped: number };
type Preview = {
  counts: Counts;
  inserts: { row: number; code: string; name: string; unit: string }[];
  updates: { row: number; code: string; name: string; unit: string; reactivate: boolean }[];
  skipped: { row: number; code: string; text: string }[];
  truncated: boolean;
};

const items = ref<Product[]>([]),
  total = ref(0),
  page = ref(1),
  pageCount = ref(1),
  search = ref(""),
  includeInactive = ref(false),
  loading = ref(false),
  error = ref(""),
  message = ref("");
const dialog = ref<"" | "create" | "edit" | "deactivate" | "reactivate">(""),
  target = ref<Product | null>(null),
  form = ref({ product_code: "", product_name: "", unit: "" }),
  baseline = ref(""),
  dialogError = ref(""),
  discard = ref(false);
const importFile = ref<File | null>(null),
  importRows = ref<{ row: number; code: string; name: string; unit: string }[]>([]),
  preview = ref<Preview | null>(null),
  importError = ref(""),
  fileInput = ref<HTMLInputElement>();

const formDirty = computed(() => (dialog.value === "create" || dialog.value === "edit") && JSON.stringify(form.value) !== baseline.value);
watch([formDirty, preview], () => (props.tab.dirty = formDirty.value || !!preview.value), { flush: "sync" });

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value) });
    if (search.value.trim()) q.set("q", search.value.trim());
    if (includeInactive.value) q.set("include_inactive", "1");
    const d = await api<any>("products-master?" + q);
    if (mine !== seq) return;
    items.value = d.items;
    total.value = d.total;
    pageCount.value = d.pageCount;
    if (page.value > d.pageCount) page.value = d.pageCount;
  } catch (e: any) {
    if (mine === seq) error.value = e.message;
  } finally {
    if (mine === seq) loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});
watch(includeInactive, () => {
  page.value = 1;
  void load();
});
onBeforeUnmount(() => clearTimeout(timer));
function go(n: number) {
  page.value = n;
  void load();
}

function openDialog(kind: typeof dialog.value, p?: Product) {
  dialog.value = kind;
  target.value = p || null;
  form.value = { product_code: p?.product_code || "", product_name: p?.product_name || "", unit: p?.unit || "" };
  baseline.value = JSON.stringify(form.value);
  dialogError.value = "";
}
function closeDialog() {
  if (props.tab.busy) return;
  if (formDirty.value) {
    discard.value = true;
    return;
  }
  dialog.value = "";
}
async function saveForm() {
  if (props.tab.busy) return;
  dialogError.value = "";
  const f = form.value;
  if (dialog.value === "create" && !f.product_code.trim()) {
    dialogError.value = "請輸入商品編號";
    return;
  }
  if (!f.product_name.trim()) {
    dialogError.value = "請輸入商品名稱";
    return;
  }
  props.tab.busy = true;
  try {
    if (dialog.value === "create") {
      await api("products-master", { method: "POST", body: JSON.stringify(f) });
      message.value = `已新增商品「${f.product_code.trim()}」`;
    } else {
      await api("products-master/" + target.value!.id, { method: "PATCH", body: JSON.stringify({ product_name: f.product_name, unit: f.unit }) });
      message.value = `已更新商品「${target.value!.product_code}」`;
    }
    dialog.value = "";
    baseline.value = JSON.stringify(form.value);
    await load();
  } catch (e: any) {
    dialogError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}
async function toggleActive() {
  if (props.tab.busy || !target.value) return;
  const activating = dialog.value === "reactivate";
  props.tab.busy = true;
  dialogError.value = "";
  try {
    await api(`products-master/${target.value.id}/${activating ? "reactivate" : "deactivate"}`, { method: "POST" });
    message.value = `已${activating ? "重新啟用" : "停用"}商品「${target.value.product_code}」`;
    dialog.value = "";
    await load();
  } catch (e: any) {
    dialogError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}

async function downloadTemplate() {
  try {
    await downloadXlsx(
      [
        { 商品編號: "A001", 商品名稱: "感冒糖漿100ml", 單位: "瓶" },
        { 商品編號: "A002", 商品名稱: "維他命C發泡錠", 單位: "條" },
      ],
      "商品主檔範本.xlsx",
      "商品主檔",
    );
  } catch {
    error.value = "範本下載失敗，請重試";
  }
}
function resetImport() {
  importFile.value = null;
  importRows.value = [];
  preview.value = null;
  importError.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
async function chooseFile(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0];
  preview.value = null;
  importError.value = "";
  message.value = "";
  if (!f) return resetImport();
  if (!/\.xlsx?$/i.test(f.name)) {
    importError.value = "僅支援 .xlsx 或 .xls 檔案";
    importFile.value = null;
    return;
  }
  importFile.value = f;
  if (props.tab.busy) return;
  props.tab.busy = true;
  try {
    const rows = await readSheet(f);
    if (!rows.length) throw new Error("Excel 無資料");
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`單次最多匯入 ${MAX_IMPORT_ROWS} 筆，這個檔案有 ${rows.length} 筆，請分檔匯入`);
    importRows.value = rows.map((r, i) => ({ row: i + 2, ...pickColumns(r, IMPORT_ALIASES) }));
    if (!importRows.value.some((r) => r.code && r.name)) throw new Error("找不到有效資料，請確認欄位名稱（商品編號、商品名稱、單位）");
    const d = await api<any>("products-master/import/preview", { method: "POST", body: JSON.stringify({ rows: importRows.value }) });
    preview.value = d;
  } catch (e: any) {
    importRows.value = [];
    importError.value = e?.message || "無法讀取這個檔案，請確認是 Excel 檔";
  } finally {
    props.tab.busy = false;
  }
}
async function confirmImport() {
  if (props.tab.busy || !preview.value) return;
  props.tab.busy = true;
  importError.value = "";
  try {
    const d = await api<any>("products-master/import", { method: "POST", body: JSON.stringify({ rows: importRows.value }) });
    const c: Counts = d.counts;
    message.value = `匯入完成：新增 ${c.inserted} 筆、更新 ${c.updated} 筆（其中重新啟用 ${c.reactivated} 筆）、略過 ${c.skipped} 筆`;
    resetImport();
    page.value = 1;
    await load();
  } catch (e: any) {
    importError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="products-master-page">
    <header class="page-heading">
      <div>
        <small>跨部門 / 商品資料</small>
        <h1>商品主檔</h1>
        <p>維護商品編號、名稱與單位（缺貨回報的商品搜尋使用這份資料）</p>
      </div>
      <div class="actions">
        <button class="primary" :disabled="tab.busy" @click="openDialog('create')">新增商品</button>
        <button :disabled="loading || tab.busy" @click="load">重新整理</button>
      </div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>

    <section class="import-box" aria-label="Excel 匯入">
      <h2>匯入商品主檔（Excel）</h2>
      <p>
        欄位名稱：<code>商品編號</code>、<code>商品名稱</code>、<code>單位</code>（也接受「編號」「品名」「名稱」「product_code」「unit」）。只讀第一個工作表，單次最多
        {{ MAX_IMPORT_ROWS }} 筆。選檔後會先顯示預覽，確認後才寫入；編號相同的商品會更新名稱與單位，停用中的商品會重新啟用，不會刪除其他商品。
      </p>
      <div class="actions">
        <label class="file-label"
          >選擇 Excel 檔案<input ref="fileInput" type="file" accept=".xlsx,.xls" :disabled="tab.busy" @change="chooseFile"
        /></label>
        <button type="button" @click="downloadTemplate">下載範本</button>
        <button v-if="importFile" type="button" :disabled="tab.busy" @click="resetImport">清除</button>
      </div>
      <p v-if="importError" role="alert" class="notice error">{{ importError }}</p>
      <div v-if="preview" class="preview" aria-label="匯入預覽">
        <h3>匯入預覽（尚未寫入）</h3>
        <ul class="counts">
          <li>檔案共 <strong>{{ preview.counts.total }}</strong> 列</li>
          <li>將新增 <strong data-count="inserted">{{ preview.counts.inserted }}</strong> 筆</li>
          <li>將更新 <strong data-count="updated">{{ preview.counts.updated }}</strong> 筆（其中重新啟用 <strong data-count="reactivated">{{ preview.counts.reactivated }}</strong> 筆）</li>
          <li>略過 <strong data-count="skipped">{{ preview.counts.skipped }}</strong> 筆</li>
        </ul>
        <div v-if="preview.updates.some((u) => u.reactivate)" class="notice">
          下列停用中的商品會被重新啟用：{{ preview.updates.filter((u) => u.reactivate).map((u) => u.code).join("、") }}
        </div>
        <div v-if="preview.skipped.length" class="module-table">
          <table>
            <caption>略過的列與原因</caption>
            <thead><tr><th>列</th><th>商品編號</th><th>原因</th></tr></thead>
            <tbody>
              <tr v-for="s in preview.skipped" :key="s.row + s.text"><td>{{ s.row }}</td><td>{{ s.code || "—" }}</td><td>{{ s.text }}</td></tr>
            </tbody>
          </table>
        </div>
        <p v-if="preview.truncated"><small>列表只顯示前幾百筆，數量以上方統計為準。</small></p>
        <div class="actions">
          <button class="primary" :disabled="tab.busy || (!preview.counts.inserted && !preview.counts.updated)" @click="confirmImport">
            {{ tab.busy ? "匯入中…" : "確認匯入" }}
          </button>
          <button :disabled="tab.busy" @click="resetImport">取消</button>
        </div>
        <p v-if="!preview.counts.inserted && !preview.counts.updated" role="status">沒有需要新增或更新的資料。</p>
      </div>
    </section>

    <div class="toolbar">
      <label>搜尋商品<input v-model="search" type="search" placeholder="商品編號或名稱" /></label>
      <label class="check"><input v-model="includeInactive" type="checkbox" />顯示已停用</label>
      <span>{{ loading ? "載入中…" : `共 ${total} 筆` }}</span>
    </div>
    <div class="module-table">
      <table class="products-table">
        <thead>
          <tr><th>商品編號</th><th>商品名稱</th><th>單位</th><th>狀態</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in items" :key="p.id" :class="{ inactive: !p.is_active }">
            <td>{{ p.product_code }}</td>
            <td>{{ p.product_name }}</td>
            <td>{{ p.unit || "—" }}</td>
            <td>{{ p.is_active ? "啟用中" : "已停用" }}</td>
            <td>
              <div class="actions">
                <button :disabled="tab.busy" @click="openDialog('edit', p)">編輯</button>
                <button v-if="p.is_active" class="danger" :disabled="tab.busy" @click="openDialog('deactivate', p)">停用</button>
                <button v-else :disabled="tab.busy" @click="openDialog('reactivate', p)">重新啟用</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !items.length"><td colspan="5">沒有符合條件的商品</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="pager">
      <span>第 {{ page }} / {{ pageCount }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="go(page - 1)">上一頁</button>
      <button :disabled="page >= pageCount || loading" @click="go(page + 1)">下一頁</button>
    </footer>
  </section>

  <Modal v-if="dialog === 'create' || dialog === 'edit'" :title="dialog === 'create' ? '新增商品' : '編輯商品'" :busy="tab.busy" @cancel="closeDialog">
    <form @submit.prevent="saveForm">
      <p v-if="dialogError" role="alert" class="notice error">{{ dialogError }}</p>
      <fieldset :disabled="tab.busy">
        <label>商品編號<input v-model="form.product_code" :disabled="dialog === 'edit'" required maxlength="64" /></label>
        <small v-if="dialog === 'edit'">商品編號建立後不可修改，只能修改名稱與單位。</small>
        <label>商品名稱<input v-model="form.product_name" required maxlength="200" /></label>
        <label>單位<input v-model="form.unit" maxlength="20" placeholder="例如：瓶、盒、條" /></label>
      </fieldset>
      <footer class="actions">
        <button type="button" :disabled="tab.busy" @click="closeDialog">取消</button>
        <button class="primary" :disabled="tab.busy">{{ tab.busy ? "處理中…" : dialog === "create" ? "新增" : "儲存修改" }}</button>
      </footer>
    </form>
  </Modal>
  <Modal v-if="dialog === 'deactivate' || dialog === 'reactivate'" :title="dialog === 'deactivate' ? '停用商品' : '重新啟用商品'" :busy="tab.busy" @cancel="closeDialog">
    <p v-if="dialogError" role="alert" class="notice error">{{ dialogError }}</p>
    <p v-if="dialog === 'deactivate'">確定停用商品「{{ target?.product_code }}　{{ target?.product_name }}」？停用後商品搜尋不會再出現，之後可以重新啟用。</p>
    <p v-else>確定重新啟用商品「{{ target?.product_code }}　{{ target?.product_name }}」？啟用後商品搜尋會再出現。</p>
    <footer class="actions end">
      <button :disabled="tab.busy" @click="closeDialog">取消</button>
      <button :class="dialog === 'deactivate' ? 'danger' : 'primary'" :disabled="tab.busy" @click="toggleActive">
        {{ tab.busy ? "處理中…" : dialog === "deactivate" ? "確認停用" : "確認重新啟用" }}
      </button>
    </footer>
  </Modal>
  <Modal v-if="discard" title="放棄未儲存內容？" @cancel="discard = false">
    <p>尚未儲存的內容將被放棄。</p>
    <div class="actions">
      <button @click="discard = false">繼續編輯</button>
      <button
        class="danger"
        @click="
          discard = false;
          dialog = '';
        "
      >
        放棄
      </button>
    </div>
  </Modal>
</template>

<style scoped>
.page-heading,
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 22px;
}
.page-heading p,
small {
  color: var(--muted);
}
h1 {
  margin: 10px 0;
}
.actions {
  display: flex;
  align-items: end;
  gap: 9px;
  flex-wrap: wrap;
}
.actions.end {
  justify-content: flex-end;
  margin-top: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
label.check {
  flex-direction: row;
  align-items: center;
  min-width: 0;
}
.toolbar label {
  min-width: 220px;
}
.toolbar label.check {
  min-width: 0;
}
input:not([type="checkbox"]) {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
  background: var(--surface);
}
input:disabled {
  background: var(--soft);
}
small {
  display: block;
  margin-top: 6px;
}
.import-box {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 18px;
  margin-bottom: 26px;
  background: var(--surface);
}
.import-box h2 {
  margin: 0 0 8px;
  font-size: 1.1rem;
}
.counts {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  padding: 0;
  list-style: none;
}
.preview {
  margin-top: 16px;
}
code {
  background: var(--soft);
  padding: 1px 5px;
  border-radius: 3px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th {
  background: var(--soft);
  white-space: nowrap;
}
caption {
  text-align: left;
  font-weight: 600;
  padding: 8px 0;
}
.products-table {
  min-width: 640px;
}
tr.inactive td {
  color: var(--muted);
}
.danger,
.error {
  color: #a32a23;
}
.notice {
  padding: 12px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--soft);
  white-space: pre-line;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
}
.pager span {
  margin-right: auto;
}
fieldset {
  border: 0;
  padding: 12px 0;
  display: grid;
  gap: 16px;
}
form footer {
  justify-content: flex-end;
  margin-top: 18px;
}
</style>
