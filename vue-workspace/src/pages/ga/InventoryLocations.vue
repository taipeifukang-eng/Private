<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../../components/Modal.vue";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import InventoryLocationParts from "../../components/ga/InventoryLocationParts.vue";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import {
  canBeDefault, emptyLocationForm, locationFormFromRow, locationPatch, storeText, validateLocationForm,
  type LocForm, type LocationRow,
} from "../../lib/ga-inventory";
import {
  impactSummary, isLocationFormDirty, LOCATION_LOCK_NOTE, LOCATION_TYPES, LOCATION_TYPE_LABEL, type LocationImpact,
} from "../../../../lib/workspace/general-affairs/inventory-rules";
import type { WorkTab } from "../../stores";

// G11 庫存位置與料件設定（Q14、C1、C2、C3、C12）。
// 清單：搜尋＋分頁＋精確統計卡；對話框：新增後不關閉，切到編輯讓你加料件；有交易的位置鎖定類型、門市、代碼（C3）。
// 停用／刪除：先看連帶筆數（庫存項數、進行中調撥、料件設定）；有進行中調撥一律擋，有庫存要再確認（C2）。
// 門市名單身分（店長、督導、區經理）唯讀：只看自己門市的位置，描述與內部備註不顯示（C12）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);

const rows = ref<LocationRow[]>([]);
const total = ref(0);
const stats = ref({ total: 0, active: 0, inactive: 0, defaults: 0 });
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const typeFilter = ref("");
const storeFilter = ref("");
const activeFilter = ref("");
const canManage = ref(false);
const readOnly = ref(true);
const internal = ref(false);
const canAddParts = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (typeFilter.value) q.set("locationType", typeFilter.value);
    if (storeFilter.value) q.set("storeId", storeFilter.value);
    if (activeFilter.value) q.set("isActive", activeFilter.value);
    const res = await api<{ data: LocationRow[]; total: number; stats: typeof stats.value; permissions: { manage: boolean; readOnly: boolean; internal: boolean; canAddParts: boolean } }>("general-affairs/inventory/locations?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    canManage.value = res.permissions.manage;
    readOnly.value = res.permissions.readOnly;
    internal.value = res.permissions.internal;
    canAddParts.value = res.permissions.canAddParts;
    loaded.value = true;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, typeFilter, storeFilter, activeFilter], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

const typeLabel = (t: string) => LOCATION_TYPE_LABEL[t as keyof typeof LOCATION_TYPE_LABEL] || t;

// ---- 新增／編輯／檢視對話框
const dialog = ref<"create" | "edit" | null>(null);
const editing = ref<LocationRow | null>(null);
const form = ref<LocForm>(emptyLocationForm());
const initial = ref<LocForm>(emptyLocationForm());
const formErrors = ref<Record<string, string>>({});
const formError = ref("");
const staleError = ref(false);
const saving = ref(false);
const leaveAsk = ref(false);
const negativeAsk = ref(false);
const defaultAsk = ref<{ name: string } | null>(null);
const stockAsk = ref<{ text: string } | null>(null);

const lockedByHistory = computed(() => dialog.value === "edit" && editing.value?.has_history === true);
const readonlyForm = computed(() => readOnly.value);
const dirty = computed(() => !readonlyForm.value && isLocationFormDirty(initial.value, form.value));

function openCreate() {
  notice.value = "";
  editing.value = null;
  form.value = emptyLocationForm();
  initial.value = emptyLocationForm();
  formErrors.value = {};
  formError.value = "";
  staleError.value = false;
  dialog.value = "create";
}
function openEdit(r: LocationRow) {
  notice.value = "";
  editing.value = r;
  form.value = locationFormFromRow(r);
  initial.value = locationFormFromRow(r);
  formErrors.value = {};
  formError.value = "";
  staleError.value = false;
  dialog.value = "edit";
}
function requestClose() {
  if (saving.value) return;
  if (dirty.value) { leaveAsk.value = true; return; }
  closeDialog();
}
function closeDialog() {
  leaveAsk.value = false;
  dialog.value = null;
  editing.value = null;
}
// 類型改成非門市時清掉門市；不能當預設的組合自動取消預設。
watch(() => form.value.location_type, (t) => { if (t !== "STORE") form.value.store_id = ""; });
watch(() => [form.value.location_type, form.value.is_active], () => { if (!canBeDefault(form.value)) form.value.is_default = false; });
function onNegativeChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.checked) {
    // 先還原畫面上的勾選（Vue 不會因為資料沒變就重畫），等使用者在確認視窗按「確定允許」才真的勾上。
    el.checked = false;
    negativeAsk.value = true;
    form.value.allow_negative_stock = false;
  }
}
function confirmNegative() {
  form.value.allow_negative_stock = true;
  negativeAsk.value = false;
}

type SaveOptions = { replace_default?: boolean; confirm_stock?: boolean };
async function save(options: SaveOptions = {}) {
  if (saving.value) return;
  formErrors.value = validateLocationForm(form.value);
  if (Object.keys(formErrors.value).length) return;
  saving.value = true;
  formError.value = "";
  staleError.value = false;
  try {
    let saved: LocationRow;
    if (dialog.value === "create") {
      const body = { ...locationPatch(emptyLocationForm(), form.value), name: form.value.name.trim(), location_type: form.value.location_type, ...options };
      const res = await api<{ data: LocationRow }>("general-affairs/inventory/locations", { method: "POST", body: JSON.stringify(body) });
      saved = res.data;
      notice.value = `已新增位置「${saved.name}」，可以接著加入料件設定`;
    } else {
      const patch = locationPatch(initial.value, form.value);
      if (!Object.keys(patch).length) { closeDialog(); return; }
      const res = await api<{ data: LocationRow }>(`general-affairs/inventory/locations/${editing.value!.id}`, { method: "PATCH", body: JSON.stringify({ ...patch, expected_updated_at: editing.value!.updated_at, ...options }) });
      saved = res.data;
      notice.value = `已儲存位置「${saved.name}」`;
    }
    defaultAsk.value = null;
    stockAsk.value = null;
    await load();
    // 新增後不關閉：切到編輯，讓使用者接著加料件（C1）。
    const fresh = rows.value.find((r) => r.id === saved.id);
    editing.value = fresh || ({ ...(editing.value as LocationRow), ...saved, store: editing.value?.store ?? null, parts_count: 0, stock_items: null, open_transfers: null, has_history: false } as LocationRow);
    form.value = locationFormFromRow(editing.value);
    initial.value = locationFormFromRow(editing.value);
    dialog.value = "edit";
  } catch (e) {
    const err = e as ApiError;
    const code = err instanceof ApiError ? err.data?.code : "";
    if (code === "DEFAULT_CONFLICT") defaultAsk.value = { name: err.data?.existing?.name || "既有位置" };
    else if (code === "NEEDS_CONFIRM_STOCK") stockAsk.value = { text: err.message };
    else {
      formError.value = err.message;
      staleError.value = code === "STALE";
    }
  } finally {
    saving.value = false;
  }
}
async function reloadEditing() {
  const id = editing.value?.id;
  await load();
  const fresh = rows.value.find((r) => r.id === id);
  if (fresh) {
    editing.value = fresh;
    form.value = locationFormFromRow(fresh);
    initial.value = locationFormFromRow(fresh);
    formError.value = "";
    staleError.value = false;
  } else {
    closeDialog();
  }
}

// ---- 停用／啟用／刪除（先看連帶筆數）
type Pending = { row: LocationRow; action: "disable" | "delete"; impact: LocationImpact | null; busy: boolean; error: string; reason: string };
const pending = ref<Pending | null>(null);
const summary = computed(() => (pending.value?.impact ? impactSummary(pending.value.impact, pending.value.action) : null));
async function askImpact(row: LocationRow, action: "disable" | "delete") {
  notice.value = "";
  error.value = "";
  pending.value = { row, action, impact: null, busy: true, error: "", reason: "" };
  try {
    const res = await api<{ data: LocationImpact }>(`general-affairs/inventory/locations/${row.id}/impact`);
    if (pending.value) pending.value.impact = res.data;
  } catch (e) {
    if (pending.value) pending.value.error = (e as Error).message;
  } finally {
    if (pending.value) pending.value.busy = false;
  }
}
async function confirmPending() {
  const p = pending.value;
  if (!p || p.busy || !summary.value || summary.value.blocked) return;
  if (p.action === "delete" && !p.reason.trim()) { p.error = "請輸入刪除原因"; return; }
  p.busy = true;
  p.error = "";
  try {
    if (p.action === "delete") {
      await api(`general-affairs/inventory/locations/${p.row.id}`, { method: "DELETE", body: JSON.stringify({ deletion_reason: p.reason.trim(), expected_updated_at: p.row.updated_at }) });
      notice.value = `已刪除位置「${p.row.name}」`;
    } else {
      await api(`general-affairs/inventory/locations/${p.row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false, expected_updated_at: p.row.updated_at, confirm_stock: true }) });
      notice.value = `已停用位置「${p.row.name}」`;
    }
    pending.value = null;
    await load();
  } catch (e) {
    p.error = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") await load();
  } finally {
    if (pending.value) pending.value.busy = false;
  }
}
async function enable(row: LocationRow) {
  notice.value = "";
  error.value = "";
  try {
    await api(`general-affairs/inventory/locations/${row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: true, expected_updated_at: row.updated_at }) });
    notice.value = `已啟用位置「${row.name}」`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// 未存變更時關閉分頁／重新整理要警告。
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) { e.preventDefault(); e.returnValue = ""; }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

const dialogTitle = computed(() => (dialog.value === "create" ? "新增庫存位置" : readonlyForm.value ? "庫存位置" : "編輯庫存位置"));
const hasFilter = computed(() => !!(search.value.trim() || typeFilter.value || storeFilter.value || activeFilter.value));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 庫存管理</p>
      <h1>庫存位置與料件設定</h1>
      <p class="muted">管理庫存放在哪些位置（總倉、門市、辦公室…），以及每個位置要管理哪些料件（安全庫存、補貨點、最高庫存）。沒有料件設定的位置不能過帳或調撥。</p>
    </div>
    <button v-if="canManage" class="primary" type="button" @click="openCreate">新增位置</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '庫存管理', '庫存位置與料件設定']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="loaded && readOnly && !internal" class="notice" role="status" data-testid="readonly-note">您目前是唯讀檢視：只會看到自己門市的庫存位置，位置描述與料件備註不顯示，也不能修改。</p>
    <p v-else-if="loaded && readOnly" class="notice" role="status" data-testid="readonly-note">您目前只有查看權限，不能新增或修改庫存位置與料件設定。</p>
    <ul class="stat-cards" aria-label="庫存位置統計">
      <li><span>全部位置</span><strong data-testid="stat-total">{{ stats.total }}</strong></li>
      <li><span>啟用中</span><strong data-testid="stat-active">{{ stats.active }}</strong></li>
      <li><span>已停用</span><strong data-testid="stat-inactive">{{ stats.inactive }}</strong></li>
      <li><span>預設位置</span><strong data-testid="stat-default">{{ stats.defaults }}</strong></li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" :placeholder="internal ? '名稱、代碼、描述（可含逗號、括號）' : '名稱、代碼'" /></label>
      <label>類型<select v-model="typeFilter" aria-label="位置類型"><option value="">全部類型</option><option v-for="t in LOCATION_TYPES" :key="t" :value="t">{{ LOCATION_TYPE_LABEL[t] }}</option></select></label>
      <div class="filter-pick"><AssetSitePicker v-model="storeFilter" label="門市" /></div>
      <label>狀態<select v-model="activeFilter" aria-label="位置狀態"><option value="">全部</option><option value="true">啟用中</option><option value="false">已停用</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll loc-table">
      <table>
        <thead><tr><th>位置</th><th>類型</th><th>門市</th><th>政策</th><th>料件設定／庫存</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="location-row">
            <td><strong>{{ r.name }}</strong><small class="sub">{{ r.code || "未設定代碼" }}</small></td>
            <td>{{ typeLabel(r.location_type) }}</td>
            <td>{{ storeText(r.store) }}</td>
            <td><span v-if="r.is_default" class="tag tone-green">預設</span> <span v-if="r.allow_negative_stock" class="tag tone-amber">允許負庫存</span><span v-if="!r.is_default && !r.allow_negative_stock" class="muted">—</span></td>
            <td>{{ r.parts_count }} 項設定<small v-if="r.stock_items !== null" class="sub">{{ r.stock_items }} 項有庫存<template v-if="r.open_transfers"> · {{ r.open_transfers }} 張進行中調撥</template></small></td>
            <td><span class="state-text" :class="{ done: r.is_active }">{{ r.is_active ? "啟用中" : "已停用" }}</span></td>
            <td><div class="actions">
              <button type="button" :aria-label="`${canManage ? '編輯' : '查看'} ${r.name}`" @click="openEdit(r)">{{ canManage ? "編輯／料件設定" : "查看" }}</button>
              <template v-if="canManage">
                <button v-if="r.is_active" type="button" :aria-label="`停用 ${r.name}`" @click="askImpact(r, 'disable')">停用</button>
                <button v-else type="button" :aria-label="`啟用 ${r.name}`" @click="enable(r)">啟用</button>
                <button type="button" class="danger" :aria-label="`刪除 ${r.name}`" @click="askImpact(r, 'delete')">刪除</button>
              </template>
            </div></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的庫存位置" : readOnly && loaded ? "沒有您可以查看的庫存位置" : "還沒有庫存位置" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="loc-cards" aria-label="庫存位置清單">
      <li v-for="r in rows" :key="r.id" class="loc-card" data-testid="location-card">
        <div class="card-title"><strong>{{ r.name }}</strong><small>{{ r.code || "未設定代碼" }}</small></div>
        <p class="card-line">{{ typeLabel(r.location_type) }} · {{ storeText(r.store) }}</p>
        <p class="card-line muted">{{ r.parts_count }} 項料件設定<template v-if="r.stock_items !== null"> · {{ r.stock_items }} 項有庫存</template><template v-if="r.open_transfers"> · {{ r.open_transfers }} 張進行中調撥</template></p>
        <div class="card-tags"><span class="state-text" :class="{ done: r.is_active }">{{ r.is_active ? "啟用中" : "已停用" }}</span><span v-if="r.is_default" class="tag tone-green">預設</span><span v-if="r.allow_negative_stock" class="tag tone-amber">允許負庫存</span></div>
        <div class="card-actions" :class="{ one: !canManage }">
          <button type="button" @click="openEdit(r)">{{ canManage ? "編輯／料件設定" : "查看料件設定" }}</button>
          <template v-if="canManage">
            <button v-if="r.is_active" type="button" @click="askImpact(r, 'disable')">停用</button>
            <button v-else type="button" @click="enable(r)">啟用</button>
            <button type="button" class="danger" @click="askImpact(r, 'delete')">刪除</button>
          </template>
        </div>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ error ? "資料載入失敗" : hasFilter ? "找不到符合的庫存位置" : readOnly && loaded ? "沒有您可以查看的庫存位置" : "還沒有庫存位置" }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="dialog" :title="dialogTitle" wide :busy="saving" @cancel="requestClose">
      <form class="loc-form" @submit.prevent="save()">
        <p v-if="lockedByHistory" class="notice" role="status" data-testid="lock-note">{{ LOCATION_LOCK_NOTE }}</p>
        <div class="grid">
          <label>位置類型<select v-model="form.location_type" :disabled="saving || readonlyForm || lockedByHistory" aria-label="位置類型"><option v-for="t in LOCATION_TYPES" :key="t" :value="t">{{ LOCATION_TYPE_LABEL[t] }}</option></select><small v-if="formErrors.location_type" class="field-error">{{ formErrors.location_type }}</small></label>
          <label>位置名稱<input v-model="form.name" :disabled="saving || readonlyForm" maxlength="100" aria-label="位置名稱" /><small v-if="formErrors.name" class="field-error">{{ formErrors.name }}</small></label>
          <label>位置代碼<input v-model="form.code" :disabled="saving || readonlyForm || lockedByHistory" maxlength="40" aria-label="位置代碼" placeholder="選填，存檔轉大寫，全公司唯一" /><small v-if="formErrors.code" class="field-error">{{ formErrors.code }}</small></label>
          <div v-if="form.location_type === 'STORE'" class="store-field">
            <AssetSitePicker v-model="form.store_id" label="所屬門市" required :initial="editing?.store" :disabled="saving || readonlyForm || lockedByHistory" :error="formErrors.store_id" />
          </div>
          <label class="wide" v-if="internal || dialog === 'create'">描述<input v-model="form.description" :disabled="saving || readonlyForm" maxlength="500" aria-label="位置描述" /></label>
        </div>
        <div class="checks">
          <div class="check-row">
            <label class="check"><input v-model="form.is_active" type="checkbox" :disabled="saving || readonlyForm || dialog === 'edit'" />啟用</label>
            <small v-if="dialog === 'edit'" class="muted hint">停用請用清單的「停用」，會先顯示影響範圍。</small>
          </div>
          <div class="check-row">
            <label class="check"><input v-model="form.is_default" type="checkbox" :disabled="saving || readonlyForm || !canBeDefault(form)" aria-label="預設位置" />預設位置</label>
            <small class="muted hint">只有啟用中的「門市」或「總倉」可設，每門市一個、全公司一個總倉。</small>
          </div>
          <div class="check-row">
            <label class="check"><input type="checkbox" :checked="form.allow_negative_stock" :disabled="saving || readonlyForm" aria-label="允許負庫存" @change="onNegativeChange" />允許負庫存</label>
            <small class="muted hint">出庫可讓庫存變成負數，請謹慎使用。</small>
          </div>
        </div>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <p v-if="staleError" class="field-error"><button type="button" @click="reloadEditing">重新載入這個位置</button></p>
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="requestClose">{{ readonlyForm ? "關閉" : "取消" }}</button>
          <button v-if="!readonlyForm" type="submit" class="primary" :disabled="saving">{{ saving ? "儲存中…" : dialog === 'create' ? "新增位置" : "儲存位置" }}</button>
        </div>
      </form>
      <InventoryLocationParts v-if="dialog === 'edit' && editing" :location="editing" :can-manage="canManage" :can-add-parts="canAddParts" @changed="load" />
      <p v-else-if="dialog === 'create'" class="muted">儲存位置後，就可以在這裡加入料件設定。</p>
    </Modal>

    <Modal v-if="leaveAsk" title="放棄未儲存的變更？" @cancel="leaveAsk = false">
      <p>位置資料有尚未儲存的變更，離開後會遺失。</p>
      <div class="dialog-actions">
        <button type="button" @click="leaveAsk = false">繼續編輯</button>
        <button type="button" class="primary danger" @click="closeDialog">放棄變更</button>
      </div>
    </Modal>

    <Modal v-if="negativeAsk" title="允許負庫存？" @cancel="negativeAsk = false">
      <p>允許負庫存後，這個位置出庫時即使庫存不夠也能過帳，帳面庫存會變成負數。確定要開啟嗎？</p>
      <div class="dialog-actions">
        <button type="button" @click="negativeAsk = false">取消</button>
        <button type="button" class="primary" @click="confirmNegative">確定允許</button>
      </div>
    </Modal>

    <Modal v-if="defaultAsk" title="改由這個位置成為預設？" :busy="saving" @cancel="defaultAsk = null">
      <p>已有預設位置「{{ defaultAsk.name }}」。確認後會取消它的預設，改由目前這個位置成為預設（過帳與調撥的預設選擇會跟著換）。</p>
      <div class="dialog-actions">
        <button type="button" :disabled="saving" @click="defaultAsk = null">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="save({ replace_default: true })">確認改為預設</button>
      </div>
    </Modal>

    <Modal v-if="stockAsk" title="位置仍有庫存" :busy="saving" @cancel="stockAsk = null">
      <p>{{ stockAsk.text }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="saving" @click="stockAsk = null">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="save({ confirm_stock: true })">確認</button>
      </div>
    </Modal>

    <Modal v-if="pending" :title="pending.action === 'delete' ? '刪除庫存位置' : '停用庫存位置'" :busy="pending.busy" @cancel="pending = null">
      <p><strong>{{ pending.row.name }}</strong> <small class="muted">{{ pending.row.code }}</small></p>
      <p v-if="pending.busy && !pending.impact" class="muted" role="status">檢查庫存與進行中調撥…</p>
      <template v-if="summary">
        <p data-testid="impact-text">{{ summary.text }}</p>
        <p v-if="summary.blocked" class="field-error" role="alert" data-testid="impact-blocked">{{ summary.blocked }}</p>
        <p v-else-if="summary.warn" class="notice" role="status" data-testid="impact-warn">{{ summary.warn }}</p>
        <template v-if="!summary.blocked">
          <p v-if="pending.action === 'delete'" class="muted">刪除後這個位置與它的料件設定不會再出現在清單，也不能還原。請填寫刪除原因。</p>
          <p v-else class="muted">停用後這個位置不能再過帳或調撥；之後可以重新啟用。</p>
          <label v-if="pending.action === 'delete'">刪除原因<input v-model="pending.reason" maxlength="200" aria-label="刪除原因" /></label>
        </template>
      </template>
      <p v-if="pending.error" class="field-error" role="alert">{{ pending.error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="pending.busy" @click="pending = null">{{ summary?.blocked ? "關閉" : "取消" }}</button>
        <button v-if="summary && !summary.blocked" type="button" class="primary danger" :disabled="pending.busy" @click="confirmPending">{{ pending.busy ? "處理中…" : pending.action === "delete" ? "確認刪除" : "確認停用" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 22px; }
.filter-pick { min-width: 220px; flex: 1; }
.sub { display: block; color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.tag { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.tone-green { background: var(--soft); color: var(--primary); }
.tone-amber { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
:root[data-theme="dark"] .tone-amber { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.loc-form { display: grid; gap: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.grid label { display: grid; gap: 4px; align-content: start; }
.grid .wide { grid-column: 1 / -1; }
.store-field { min-width: 0; }
.checks { display: grid; gap: 10px; }
.check-row { display: grid; gap: 2px; }
.check { display: flex; align-items: center; gap: 8px; }
.hint { margin-left: 26px; }
.check input { width: auto; }
.loc-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.loc-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 6px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-line { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.card-tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.card-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 4px; }
.card-actions.one { grid-template-columns: 1fr; }
.card-actions button { min-height: 44px; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; }
.empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .loc-table { display: none; }
  .loc-cards { display: grid; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-pick { min-width: 0; flex-basis: 100%; }
  .grid { grid-template-columns: 1fr; }
}
</style>
