<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../../components/Modal.vue";
import AssetCategoryPicker from "../../components/ga/AssetCategoryPicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import PartForm from "../../components/ga/PartForm.vue";
import { openGaPage, useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import { partFromRow, partPayload, validatePartForm, type PartFormValue } from "../../lib/ga-parts";
import type { WorkTab } from "../../stores";

// G03 料件主檔：搜尋、分頁（伺服端、精確筆數）、編輯、停用、刪除。
// Q5：只有店長身分時看不到內部備註。Q6：刪除須填原因且無庫存、無未結單；有庫存或交易後單位欄位鎖定。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Part = Record<string, any> & { id: string; name: string; updated_at: string; is_active: boolean; category?: { name: string } | null };
const rows = ref<Part[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const categoryId = ref("");
const activeFilter = ref("");
const canManage = ref(false);
const seeNotes = ref(false);
const loading = ref(false);
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
    if (categoryId.value) q.set("categoryId", categoryId.value);
    if (activeFilter.value) q.set("isActive", activeFilter.value);
    const res = await api<{ data: Part[]; meta: { total: number }; permissions: { manage: boolean; seeNotes: boolean } }>("general-affairs/parts?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.meta.total;
    canManage.value = res.permissions.manage;
    seeNotes.value = res.permissions.seeNotes;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, categoryId, activeFilter], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

// ---- 編輯
const editing = ref<Part | null>(null);
const form = ref<PartFormValue>(partFromRow({}));
const unitLocked = ref(false);
const formErrors = ref<Record<string, string>>({});
const formError = ref("");
const saving = ref(false);
const detailBusy = ref(false);
async function openEdit(p: Part) {
  editing.value = p;
  form.value = partFromRow(p);
  unitLocked.value = false;
  formErrors.value = {};
  formError.value = "";
  if (!canManage.value) return;
  detailBusy.value = true;
  try {
    const u = await api<{ data: { unit_locked: boolean } }>(`general-affairs/parts/${p.id}/usage`);
    unitLocked.value = u.data.unit_locked;
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    detailBusy.value = false;
  }
}
async function save() {
  if (!editing.value || saving.value) return;
  formErrors.value = validatePartForm(form.value);
  if (unitLocked.value) { delete formErrors.value.base_unit; delete formErrors.value.purchase_to_base_rate; }
  if (Object.keys(formErrors.value).length) return;
  saving.value = true;
  formError.value = "";
  try {
    const body = { ...partPayload(form.value, { canSeeNotes: seeNotes.value, unitLocked: unitLocked.value }), expected_updated_at: editing.value.updated_at };
    await api(`general-affairs/parts/${editing.value.id}`, { method: "PATCH", body: JSON.stringify(body) });
    notice.value = `已儲存料件「${form.value.name}」`;
    editing.value = null;
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// ---- 停用／啟用
async function toggleActive(p: Part) {
  notice.value = "";
  error.value = "";
  try {
    await api(`general-affairs/parts/${p.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !p.is_active, expected_updated_at: p.updated_at }) });
    notice.value = p.is_active ? `已停用料件「${p.name}」` : `已啟用料件「${p.name}」`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---- 刪除
const deleting = ref<Part | null>(null);
const deleteReason = ref("");
const deleteBlock = ref("");
const deleteError = ref("");
const deleteBusy = ref(false);
async function askDelete(p: Part) {
  notice.value = "";
  deleting.value = p;
  deleteReason.value = "";
  deleteError.value = "";
  deleteBlock.value = "";
  deleteBusy.value = true;
  try {
    const u = await api<{ deleteBlock: string }>(`general-affairs/parts/${p.id}/usage`);
    deleteBlock.value = u.deleteBlock;
  } catch (e) {
    deleteError.value = (e as Error).message;
  } finally {
    deleteBusy.value = false;
  }
}
async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return;
  if (!deleteReason.value.trim()) { deleteError.value = "請輸入刪除原因"; return; }
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api(`general-affairs/parts/${deleting.value.id}`, { method: "DELETE", body: JSON.stringify({ deletion_reason: deleteReason.value.trim() }) });
    notice.value = `已刪除料件「${deleting.value.name}」`;
    deleting.value = null;
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.usage) deleteBlock.value = (e as ApiError).message;
  } finally {
    deleteBusy.value = false;
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 料件管理</p>
      <h1>料件列表</h1>
      <p class="muted">用關鍵字搜尋（名稱、代碼、條碼、品牌、型號、規格）或依分類篩選。{{ seeNotes || !rows.length ? "" : "店長身分只顯示料件基本資料，不含內部備註。" }}</p>
    </div>
    <button v-if="canManage" class="primary" @click="openGaPage('ga-part-create')">新增料件</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '料件管理', '料件列表']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱、代碼、條碼、品牌、型號、規格（可含逗號、括號）" /></label>
      <div class="filter-cat"><AssetCategoryPicker v-model="categoryId" type="part" label="分類" /></div>
      <label>狀態<select v-model="activeFilter"><option value="">全部</option><option value="true">啟用中</option><option value="false">已停用</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>料件</th><th>品牌／型號／規格</th><th>分類</th><th>單位</th><th>狀態</th><th v-if="seeNotes">內部備註</th><th v-if="canManage">操作</th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.id">
            <td><strong>{{ p.name }}</strong><small>{{ [p.part_code, p.barcode].filter(Boolean).join(" / ") || "未設定代碼" }}</small></td>
            <td>{{ [p.brand, p.model, p.specification].filter(Boolean).join(" / ") || "—" }}</td>
            <td>{{ p.category?.name || "—" }}</td>
            <td>{{ p.base_unit }}<small v-if="p.purchase_unit">採購：{{ p.purchase_unit }}（×{{ p.purchase_to_base_rate }}）</small></td>
            <td><span class="state-text" :class="{ done: p.is_active }">{{ p.is_active ? "啟用中" : "已停用" }}</span></td>
            <td v-if="seeNotes">{{ p.notes || "—" }}</td>
            <td v-if="canManage" class="actions">
              <button type="button" @click="openEdit(p)">編輯</button>
              <button type="button" @click="toggleActive(p)">{{ p.is_active ? "停用" : "啟用" }}</button>
              <button type="button" class="danger" @click="askDelete(p)">刪除</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="4 + (seeNotes ? 1 : 0) + (canManage ? 1 : 0) + 1" class="empty">{{ error ? "資料載入失敗" : search.trim() || categoryId || activeFilter ? "找不到符合的料件" : "還沒有料件" }}</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="editing" title="編輯料件" wide :busy="saving" @cancel="editing = null">
      <form @submit.prevent="save">
        <PartForm v-model="form" :unit-locked="unitLocked" :can-see-notes="seeNotes" :disabled="saving || detailBusy" :errors="formErrors" />
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="editing = null">取消</button>
          <button type="submit" class="primary" :disabled="saving || detailBusy">{{ saving ? "儲存中…" : "儲存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="deleting" title="刪除料件" :busy="deleteBusy" @cancel="deleting = null">
      <p><strong>{{ deleting.name }}</strong></p>
      <p v-if="deleteBusy && !deleteBlock" class="muted" role="status">檢查庫存與未結單中…</p>
      <p v-if="deleteBlock" class="field-error" role="alert">{{ deleteBlock }}</p>
      <template v-else-if="!deleteBusy">
        <p class="muted">刪除後這個料件不會再出現在列表，也不能還原。請填寫刪除原因。</p>
        <label>刪除原因<input v-model="deleteReason" maxlength="200" aria-label="刪除原因" /></label>
      </template>
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="deleteBusy" @click="deleting = null">{{ deleteBlock ? "關閉" : "取消" }}</button>
        <button v-if="!deleteBlock" type="button" class="primary danger" :disabled="deleteBusy" @click="confirmDelete">{{ deleteBusy ? "處理中…" : "確認刪除" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.filter-cat { min-width: 240px; flex: 1; }
</style>
