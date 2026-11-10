<script setup lang="ts">
import { computed, ref } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import Modal from "../../components/Modal.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import { useSession, type WorkTab } from "../../stores";

// Excel 匯入既有設備與設施（Q29，總務桌機）：下載範本 -> 選 Excel -> 逐列預檢（錯誤列標出原因）-> 確認後整批寫入（任何一列有錯整批都不寫入）。
// 匯入後每台設備與設施自動進入各店的貼標待辦（設施比照設備，解讀 (b)）。檔案由伺服端解析，限 2MB、500 列。
const props = defineProps<{ tab: WorkTab }>();
useGaGuard(props.tab); // 沒有權限時 App.vue 會顯示說明，頁面本身不會有任何請求（沒有自動載入）
const session = useSession();
type Row = { row_no: number; kind: "EQUIPMENT" | "FACILITY" | null; store_code: string; category_code: string; name: string; code: string | null; ok: boolean; errors: string[]; warnings?: string[] };
type Summary = { total: number; okCount: number; errorCount: number; equipmentCount: number; facilityCount: number; storeCount: number; duplicateCount?: number };
type Result = { dryRun: boolean; committed: boolean; alreadyImported: boolean; batchId: string | null; fileName: string; canCommit: boolean; summary: Summary; rows: Row[] };

const MAX_ROWS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
const file = ref<File | null>(null);
const key = ref("");
const result = ref<Result | null>(null);
const done = ref<Result | null>(null);
const busy = ref(false);
const error = ref("");
const onlyErrors = ref(false);
const input = ref<HTMLInputElement>();
const caps = computed(() => session.data?.capabilities as Record<string, boolean> | undefined);

// 防重複識別碼由檔案內容的 SHA-256 決定：同一個檔案內容再匯一次不會重複建立資產（要再建一份請先修改內容）。
async function keyOf(f: File) {
  try {
    const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return "f-" + Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  } catch {
    return crypto.randomUUID();
  }
}

async function pick(event: Event) {
  const el = event.target as HTMLInputElement;
  const f = el.files?.[0] || null;
  el.value = "";
  result.value = null;
  done.value = null;
  error.value = "";
  if (!f) return;
  if (!/\.xlsx$/i.test(f.name)) { file.value = null; error.value = "只收 Excel（.xlsx）檔，請使用下載的範本"; return; }
  if (f.size > MAX_BYTES) { file.value = null; error.value = "檔案太大，上限 2MB"; return; }
  file.value = f;
  key.value = await keyOf(f);
  void check();
}

async function send(path: string) {
  const fd = new FormData();
  fd.set("file", file.value!);
  if (path === "commit") fd.set("idempotencyKey", key.value);
  return api<Result>("general-affairs/asset-import/" + path, { method: "POST", body: fd });
}

async function check() {
  if (!file.value || busy.value) return;
  busy.value = true;
  error.value = "";
  result.value = null;
  onlyErrors.value = false;
  try {
    result.value = await send("check");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const confirmingDup = ref(false);
const dupCount = computed(() => result.value?.summary.duplicateCount ?? 0);
/** B10：有「可能重複」列時，先跳確認對話框多一句提醒；沒有就直接匯入。 */
function askCommit() {
  if (!file.value || !result.value?.canCommit || busy.value) return;
  if (dupCount.value > 0) { confirmingDup.value = true; return; }
  commit();
}
async function commit() {
  confirmingDup.value = false;
  if (!file.value || !result.value?.canCommit || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const res = await send("commit");
    if (res.committed) {
      done.value = res;
      result.value = null;
      file.value = null;
    } else {
      // 預檢後資料又有變動（例如編號被別人用掉）：回到預檢結果，讓使用者看到哪幾列有問題。
      result.value = { ...res, canCommit: false };
      error.value = "匯入沒有執行：有幾列在寫入前的最後檢查沒有通過，整批都沒有寫入。請看下方標示的列。";
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function downloadTemplate() {
  error.value = "";
  try {
    const res = await fetch("/api/workspace/general-affairs/asset-import/template", { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error || "範本下載失敗，請稍後重試");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "設備設施匯入範本.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const shownRows = computed(() => (result.value ? (onlyErrors.value && result.value.summary.errorCount > 0 ? result.value.rows.filter((r) => !r.ok) : result.value.rows) : []));
const kindText = (k: string | null) => (k === "EQUIPMENT" ? "設備" : k === "FACILITY" ? "設施" : "—");
function reset() { file.value = null; result.value = null; done.value = null; error.value = ""; }
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 建檔貼標</p>
      <h1>設備與設施 Excel 匯入</h1>
      <p class="muted">把既有的設備與設施一次匯入：先下載範本填好，上傳後系統會逐列檢查；全部通過才一次寫入，只要有一列有錯就整批都不匯入。單次最多 {{ MAX_ROWS }} 列。</p>
    </div>
    <div class="actions"><button type="button" data-testid="download-template" @click="downloadTemplate">下載範本</button></div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '建檔貼標', 'Excel 匯入']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <section v-if="done" class="done" role="status" data-testid="import-done">
      <h2>匯入完成</h2>
      <p v-if="done.alreadyImported">這個檔案內容已經匯入過了，沒有重複新增。如果要再建一份，請先修改檔案內容。</p>
      <p data-testid="done-summary">共匯入 {{ done.summary.total }} 筆：設備 {{ done.summary.equipmentCount }} 台、設施 {{ done.summary.facilityCount }} 項，涵蓋 {{ done.summary.storeCount }} 間門市。</p>
      <p class="muted">這些設備與設施已進入各店的「貼標待辦」。接下來：依門市列印 QR 標籤，貼好後請店長用手機上傳照片，再由總務複核。</p>
      <div class="buttons">
        <button v-if="caps?.gaOnboardingProgress" type="button" class="primary" @click="openGaPage('ga-onboarding-progress')">前往上線貼標進度</button>
        <button v-if="caps?.gaEquipmentLabels" type="button" @click="openGaPage('ga-equipment-labels')">列印設備標籤</button>
        <button v-if="caps?.gaFacilityLabels" type="button" @click="openGaPage('ga-facility-labels')">列印設施標籤</button>
        <button type="button" @click="reset">再匯入另一個檔案</button>
      </div>
    </section>

    <template v-else>
      <section class="steps" aria-label="匯入步驟">
        <ol>
          <li><strong>1. 下載範本</strong><span class="muted">第一個工作表是填寫資料處，「填寫說明」與「代碼對照」分頁可查欄位與門市、分類代碼。</span></li>
          <li><strong>2. 填好後上傳</strong><span class="muted">只收 .xlsx，2MB 以內；上傳後會立刻預檢，還不會寫入。</span></li>
          <li><strong>3. 確認預檢結果，再按「確認匯入」</strong><span class="muted">有錯誤的列會標出原因，改好 Excel 重新上傳即可。</span></li>
        </ol>
        <div class="pick">
          <input ref="input" type="file" class="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid="import-file" aria-hidden="true" tabindex="-1" @change="pick" />
          <button type="button" class="primary" :disabled="busy" @click="input?.click()">{{ file ? "重新選擇檔案" : "選擇 Excel 檔" }}</button>
          <span v-if="file" class="muted" data-testid="import-file-name">{{ file.name }}</span>
          <span v-if="busy" role="status" class="muted">處理中…</span>
        </div>
      </section>

      <section v-if="result" class="result" aria-label="預檢結果" data-testid="import-preview">
        <div class="summary" data-testid="import-summary">
          <div><span class="muted">總列數</span><strong>{{ result.summary.total }}</strong></div>
          <div><span class="muted">設備</span><strong>{{ result.summary.equipmentCount }}</strong></div>
          <div><span class="muted">設施</span><strong>{{ result.summary.facilityCount }}</strong></div>
          <div><span class="muted">門市數</span><strong>{{ result.summary.storeCount }}</strong></div>
          <div :class="{ bad: result.summary.errorCount > 0 }"><span class="muted">有問題的列</span><strong data-testid="error-count">{{ result.summary.errorCount }}</strong></div>
          <div :class="{ warned: dupCount > 0 }"><span class="muted">可能重複</span><strong data-testid="dup-count">{{ dupCount }}</strong></div>
        </div>
        <p v-if="result.summary.errorCount" class="notice error" role="alert">有 {{ result.summary.errorCount }} 列沒有通過檢查，整批都不會匯入。請依下方原因修改 Excel 後重新上傳。</p>
        <p v-else class="notice success" role="status">全部 {{ result.summary.total }} 列都通過檢查，可以匯入。匯入後會自動產生各店的貼標待辦。</p>
        <p v-if="result.rows.some((r) => r.ok && r.kind === 'EQUIPMENT' && !r.code)" class="notice warn" role="note">有些設備沒有資產編號（沒填購置日期，系統無法自動產生）：可以匯入，但列印標籤時會警告，建議之後補編號。</p>
        <p v-if="dupCount > 0" class="notice warn" role="note" data-testid="dup-notice">可能重複 {{ dupCount }} 列（沒填編號，且同門市已有同名的設備或設施，或同一份檔案內重複）：不影響匯入，請確認不是重複建檔；確定要建立新的就照常匯入。</p>
        <label class="check"><input v-model="onlyErrors" type="checkbox" :disabled="!result.summary.errorCount" /> 只看有問題的列</label>
        <div class="table-wrap">
          <table class="grid-table">
            <caption class="sr-only">逐列預檢結果</caption>
            <thead><tr><th>Excel 列</th><th>類型</th><th>門市</th><th>分類</th><th>名稱</th><th>預計編號</th><th>結果</th></tr></thead>
            <tbody>
              <tr v-for="r in shownRows" :key="r.row_no" :class="{ bad: !r.ok, dup: r.ok && !!r.warnings?.length }" data-testid="import-row" :data-ok="r.ok ? '1' : '0'" :data-dup="r.warnings?.length ? '1' : '0'">
                <td>{{ r.row_no }}</td><td>{{ kindText(r.kind) }}</td><td>{{ r.store_code }}</td><td>{{ r.category_code }}</td><td>{{ r.name }}</td><td>{{ r.code || "—" }}</td>
                <td><template v-if="r.ok"><span class="ok">通過</span><span v-if="r.warnings?.length" class="dup-text" data-testid="dup-text">{{ r.warnings[0] }}</span></template><template v-else><ul class="errs"><li v-for="(m, i) in r.errors" :key="i">{{ m }}</li></ul></template></td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="7" class="empty">沒有符合的資料列</td></tr>
            </tbody>
          </table>
        </div>
        <div class="buttons sticky">
          <button type="button" class="primary big" data-testid="commit-import" :disabled="!result.canCommit || busy" @click="askCommit">{{ busy ? "處理中…" : `確認匯入 ${result.summary.total} 筆` }}</button>
          <button type="button" class="big" :disabled="busy" @click="reset">取消</button>
        </div>
      </section>
    </template>
    <Modal v-if="confirmingDup" title="確認匯入" :busy="busy" @cancel="confirmingDup = false">
      <p>準備匯入 {{ result?.summary.total }} 筆。</p>
      <p class="notice warn" role="alert" data-testid="dup-confirm-text">其中 {{ dupCount }} 列可能重複（含同檔重複），確定仍要匯入？</p>
      <div class="dialog-actions">
        <button type="button" data-testid="dup-confirm-cancel" @click="confirmingDup = false">取消</button>
        <button type="button" class="primary" data-testid="dup-confirm-ok" :disabled="busy" @click="commit">仍要匯入</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.summary .warned { border-color: #ca8a04; }
tr.dup { background: #fefce8; }
:root[data-theme="dark"] tr.dup { background: #422006; }
.dup-text { display: block; color: #854d0e; font-size: 13px; }
:root[data-theme="dark"] .dup-text { color: #fde68a; }
.steps { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px; display: grid; gap: 12px; margin-bottom: 14px; }
.steps ol { margin: 0; padding-left: 0; list-style: none; display: grid; gap: 8px; }
.steps li { display: grid; gap: 2px; }
.pick { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 10px; }
.summary div { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 8px 12px; display: grid; gap: 2px; }
.summary strong { font-size: 20px; }
.summary .bad { border-color: var(--danger); }
.check { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
tr.bad { background: #fdecec; }
:root[data-theme="dark"] tr.bad { background: #4a1f1f; }
.ok { color: var(--primary); font-weight: 600; }
.errs { margin: 0; padding-left: 16px; color: var(--danger); }
.empty { text-align: center; color: var(--muted); padding: 18px; }
.buttons { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.sticky { position: sticky; bottom: 0; background: var(--surface); padding: 10px 0; }
.big { min-height: 44px; font-weight: 700; }
.done { border: 1px solid var(--primary); border-radius: 10px; background: var(--soft); padding: 16px; display: grid; gap: 8px; }
.done h2 { margin: 0; }
.done p { margin: 0; }
</style>
