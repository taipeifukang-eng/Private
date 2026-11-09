<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../../components/Modal.vue";
import AssetCategoryPicker from "../../components/ga/AssetCategoryPicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import PartMultiPicker, { type PickedPart } from "../../components/ga/PartMultiPicker.vue";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G04 公司設備型號（equipment）與設施架型（facility）共用一頁，依頁籤種類決定。
// Q7：既有設備歸戶前逐台顯示「原值 → 新值」並提醒不可還原；用中的型號／架型只能停用，沒人用才能刪（須填原因）。
// G05：適用料件與型號一起儲存（一次請求，失敗全部回復）；被他人同時修改時提示重新載入。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const kind = computed(() => (props.tab.kind === "ga-equipment-templates" ? "equipment" : "facility") as "equipment" | "facility");
const noun = computed(() => (kind.value === "equipment" ? "設備型號" : "設施架型"));
const assetNoun = computed(() => (kind.value === "equipment" ? "設備" : "設施"));

type Tpl = Record<string, any> & { id: string; name: string; updated_at: string; is_active: boolean; asset_count: number; site_count: number; category?: { name: string } | null };
const rows = ref<Tpl[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const categoryId = ref("");
const activeFilter = ref("");
const canManage = ref(false);
const canManageParts = ref(false);
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
    if (activeFilter.value) q.set("active", activeFilter.value);
    const res = await api<{ data: Tpl[]; meta: { total: number }; permissions: { manage: boolean; manageParts: boolean } }>(`general-affairs/templates/${kind.value}?` + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.meta.total;
    canManage.value = res.permissions.manage;
    canManageParts.value = res.permissions.manageParts;
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

// ---- 新增／編輯（含適用料件）
const editing = ref<Tpl | null>(null);
const showForm = ref(false);
const form = reactive<any>({});
const parts = ref<PickedPart[]>([]);
const compatVersion = ref("");
const compatLoaded = ref(false);
const formError = ref("");
const saving = ref(false);
const formBusy = ref(false);
function blank() {
  return { name: "", code: "", category_id: "", brand: "", model: "", description: "", default_warranty_months: "", width_cm: "", height_cm: "", depth_cm: "", is_active: true };
}
async function openForm(t: Tpl | null) {
  editing.value = t;
  Object.assign(form, blank(), t ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? ""])) : {});
  parts.value = [];
  compatVersion.value = "";
  compatLoaded.value = !t;
  formError.value = "";
  showForm.value = true;
  if (t) {
    formBusy.value = true;
    try {
      const res = await api<{ data: Tpl; compat: { parts: any[]; version: string } | null }>(`general-affairs/templates/${kind.value}/${t.id}`);
      editing.value = res.data;
      if (res.compat) {
        parts.value = res.compat.parts.map((r) => r.part).filter(Boolean);
        compatVersion.value = res.compat.version;
        compatLoaded.value = true;
      }
    } catch (e) {
      formError.value = (e as Error).message;
    } finally {
      formBusy.value = false;
    }
  }
}
async function save() {
  if (saving.value) return;
  if (!String(form.name).trim()) { formError.value = `請輸入${noun.value}名稱`; return; }
  if (!form.category_id && kind.value === "equipment") { formError.value = "請選擇設備分類"; return; }
  if (kind.value === "facility" && !String(form.code).trim()) { formError.value = "請輸入架型代碼"; return; }
  saving.value = true;
  formError.value = "";
  try {
    const body: any = { name: form.name, category_id: form.category_id || null, brand: form.brand, model: form.model, description: form.description, is_active: form.is_active };
    if (kind.value === "equipment") body.default_warranty_months = form.default_warranty_months === "" ? null : Number(form.default_warranty_months);
    else Object.assign(body, { code: form.code, width_cm: form.width_cm, height_cm: form.height_cm, depth_cm: form.depth_cm });
    if (canManageParts.value && compatLoaded.value) {
      body.part_ids = parts.value.map((p) => p.id);
      if (editing.value) body.expected_compat_version = compatVersion.value;
    }
    if (editing.value) {
      body.expected_updated_at = editing.value.updated_at;
      await api(`general-affairs/templates/${kind.value}/${editing.value.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else await api(`general-affairs/templates/${kind.value}`, { method: "POST", body: JSON.stringify(body) });
    notice.value = `已儲存${noun.value}「${form.name}」`;
    showForm.value = false;
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function toggleActive(t: Tpl) {
  notice.value = "";
  error.value = "";
  try {
    await api(`general-affairs/templates/${kind.value}/${t.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !t.is_active, expected_updated_at: t.updated_at }) });
    notice.value = t.is_active ? `已停用${noun.value}「${t.name}」` : `已啟用${noun.value}「${t.name}」`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---- 刪除（用中只能停用）
const deleting = ref<Tpl | null>(null);
const deleteReason = ref("");
const deleteError = ref("");
const deleteBusy = ref(false);
function askDelete(t: Tpl) {
  notice.value = "";
  deleting.value = t;
  deleteReason.value = "";
  deleteError.value = "";
}
async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return;
  if (!deleteReason.value.trim()) { deleteError.value = "請輸入刪除原因"; return; }
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api(`general-affairs/templates/${kind.value}/${deleting.value.id}`, { method: "DELETE", body: JSON.stringify({ deletion_reason: deleteReason.value.trim() }) });
    notice.value = `已刪除${noun.value}「${deleting.value.name}」`;
    deleting.value = null;
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
  } finally {
    deleteBusy.value = false;
  }
}

// ---- 既有設備歸戶（Q7）
type Unlinked = { id: string; name: string; asset_code: string; brand: string | null; model: string | null; updated_at: string; store?: { store_code: string; short_name: string | null; store_name: string } | null };
type PreviewItem = { id: string; asset_code: string; updated_at: string; already_linked: boolean; store?: Unlinked["store"]; diff: { field: string; label: string; from: string | null; to: string | null; changed: boolean }[] };
const rehome = ref<Tpl | null>(null);
const rhSearch = ref("");
const rhDebounced = useDebounced(rhSearch, 300);
const rhRows = ref<Unlinked[]>([]);
const rhPage = ref(1);
const rhTotal = ref(0);
const rhLoading = ref(false);
const rhSelected = reactive(new Map<string, Unlinked>());
const rhPreview = ref<PreviewItem[] | null>(null);
const rhConfirm = ref(false);
const rhError = ref("");
const rhBusy = ref(false);
const rhPages = computed(() => Math.max(1, Math.ceil(rhTotal.value / 20)));
async function rhLoad() {
  if (!rehome.value) return;
  rhLoading.value = true;
  rhError.value = "";
  try {
    const q = new URLSearchParams({ page: String(rhPage.value), pageSize: "20" });
    if (rhDebounced.value.trim()) q.set("search", rhDebounced.value.trim());
    const res = await api<{ data: Unlinked[]; meta: { total: number } }>("general-affairs/unlinked-equipment?" + q);
    rhRows.value = res.data;
    rhTotal.value = res.meta.total;
  } catch (e) {
    rhError.value = (e as Error).message;
  } finally {
    rhLoading.value = false;
  }
}
function openRehome(t: Tpl) {
  rehome.value = t;
  rhSearch.value = "";
  rhPage.value = 1;
  rhSelected.clear();
  rhPreview.value = null;
  rhConfirm.value = false;
  rhLoad();
}
watch([rhDebounced], () => { rhPage.value = 1; rhLoad(); });
watch(rhPage, rhLoad);
function rhToggle(e: Unlinked, on: boolean) {
  if (on) {
    if (rhSelected.size >= 100) { rhError.value = "單次最多整理 100 台設備"; return; }
    rhSelected.set(e.id, e);
  } else rhSelected.delete(e.id);
}
async function rhShowPreview() {
  if (!rehome.value || !rhSelected.size) return;
  rhBusy.value = true;
  rhError.value = "";
  try {
    const ids = Array.from(rhSelected.keys()).join(",");
    const res = await api<{ items: PreviewItem[] }>(`general-affairs/templates/equipment/${rehome.value.id}/link-preview?ids=${ids}`);
    rhPreview.value = res.items;
    rhConfirm.value = false;
  } catch (e) {
    rhError.value = (e as Error).message;
  } finally {
    rhBusy.value = false;
  }
}
async function rhApply() {
  if (!rehome.value || !rhPreview.value || !rhConfirm.value || rhBusy.value) return;
  rhBusy.value = true;
  rhError.value = "";
  try {
    const items = rhPreview.value.map((i) => ({ id: i.id, updated_at: i.updated_at }));
    const res = await api<{ data: { linked_count: number } }>(`general-affairs/templates/equipment/${rehome.value.id}/link`, { method: "POST", body: JSON.stringify({ items, confirmed: true }) });
    notice.value = `已將 ${res.data.linked_count} 台既有設備歸戶至「${rehome.value.name}」`;
    rehome.value = null;
    await load();
  } catch (e) {
    rhError.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 409) rhPreview.value = null; // 內容已變動：回到選取畫面重新預覽
  } finally {
    rhBusy.value = false;
  }
}
const storeLabel = (s?: Unlinked["store"]) => (s ? `${s.store_code} ${s.short_name || s.store_name}` : "—");
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / {{ kind === "equipment" ? "設備管理" : "設施管理" }}</p>
      <h1>公司{{ noun }}</h1>
      <p class="muted">{{ kind === "equipment" ? "統一管理公司採用的設備型號與適用料件。" : "統一管理公司採用的設施架型、尺寸與適用料件。" }}已有{{ assetNoun }}在使用的{{ noun }}只能停用，沒人使用才能刪除。</p>
    </div>
    <button v-if="canManage" class="primary" @click="openForm(null)">新增{{ noun }}</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', kind === 'equipment' ? '設備管理' : '設施管理', '公司' + noun]">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" :placeholder="kind === 'equipment' ? '名稱、品牌、型號' : '代碼、名稱、品牌、型號'" /></label>
      <div class="filter-cat"><AssetCategoryPicker v-model="categoryId" :type="kind" label="分類" /></div>
      <label>狀態<select v-model="activeFilter"><option value="">全部</option><option value="true">啟用中</option><option value="false">已停用</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>{{ noun }}</th><th>品牌／型號</th><th>分類</th><th v-if="kind === 'facility'">尺寸（寬×高×深 cm）</th><th>使用中</th><th>狀態</th><th v-if="canManage">操作</th></tr></thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id">
            <td><strong>{{ t.name }}</strong><small v-if="t.code">{{ t.code }}</small></td>
            <td>{{ [t.brand, t.model].filter(Boolean).join(" / ") || "—" }}</td>
            <td>{{ t.category?.name || "—" }}</td>
            <td v-if="kind === 'facility'">{{ [t.width_cm, t.height_cm, t.depth_cm].map((v) => v ?? "—").join(" × ") }}</td>
            <td>{{ t.asset_count }} 筆{{ assetNoun }}<small>{{ t.site_count }} 個據點</small></td>
            <td><span class="state-text" :class="{ done: t.is_active }">{{ t.is_active ? "啟用中" : "已停用" }}</span></td>
            <td v-if="canManage" class="actions">
              <button type="button" @click="openForm(t)">編輯</button>
              <button type="button" @click="toggleActive(t)">{{ t.is_active ? "停用" : "啟用" }}</button>
              <button v-if="kind === 'equipment' && t.is_active" type="button" @click="openRehome(t)">整理既有設備歸戶</button>
              <button type="button" class="danger" @click="askDelete(t)">刪除</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="canManage ? 7 : 6" class="empty">{{ error ? "資料載入失敗" : search.trim() || categoryId || activeFilter ? "找不到符合的" + noun : "還沒有" + noun }}</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="showForm" :title="(editing ? '編輯' : '新增') + noun" wide :busy="saving" @cancel="showForm = false">
      <form class="ga-form" @submit.prevent="save">
        <label>{{ noun }}名稱<span class="required"> 必填</span><input v-model="form.name" maxlength="120" autocomplete="off" /></label>
        <label v-if="kind === 'facility'">架型代碼<span class="required"> 必填</span><input v-model="form.code" maxlength="40" autocomplete="off" /></label>
        <AssetCategoryPicker v-model="form.category_id" :type="kind" :label="(kind === 'equipment' ? '設備' : '設施') + '分類'" :required="kind === 'equipment'" />
        <div class="two"><label>品牌<input v-model="form.brand" maxlength="60" /></label><label>型號<input v-model="form.model" maxlength="60" /></label></div>
        <label v-if="kind === 'equipment'">預設保固月數<input v-model="form.default_warranty_months" type="number" min="0" step="1" /></label>
        <div v-else class="three">
          <label>寬度 cm<input v-model="form.width_cm" inputmode="decimal" /></label>
          <label>高度 cm<input v-model="form.height_cm" inputmode="decimal" /></label>
          <label>深度 cm<input v-model="form.depth_cm" inputmode="decimal" /></label>
        </div>
        <label>說明<input v-model="form.description" maxlength="300" /></label>
        <label class="check-row"><input v-model="form.is_active" type="checkbox" /> 啟用中</label>
        <fieldset v-if="canManageParts" class="compat">
          <legend>適用料件（和{{ noun }}一起儲存）</legend>
          <p v-if="formBusy" class="muted" role="status">載入適用料件…</p>
          <PartMultiPicker v-else v-model="parts" :disabled="saving" />
        </fieldset>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="showForm = false">取消</button>
          <button type="submit" class="primary" :disabled="saving || formBusy">{{ saving ? "儲存中…" : "儲存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="deleting" :title="'刪除' + noun" :busy="deleteBusy" @cancel="deleting = null">
      <p><strong>{{ deleting.name }}</strong></p>
      <p v-if="deleting.asset_count" class="notice error" role="status">已有 {{ deleting.asset_count }} 筆{{ assetNoun }}在使用，不能刪除；請改用「停用」。</p>
      <template v-else>
        <p class="muted">沒有{{ assetNoun }}在使用，可以刪除。刪除後不會再出現在列表，不能還原。</p>
        <label>刪除原因<input v-model="deleteReason" maxlength="200" aria-label="刪除原因" /></label>
      </template>
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="deleteBusy" @click="deleting = null">{{ deleting.asset_count ? "關閉" : "取消" }}</button>
        <button v-if="!deleting.asset_count" type="button" class="primary danger" :disabled="deleteBusy" @click="confirmDelete">{{ deleteBusy ? "處理中…" : "確認刪除" }}</button>
      </div>
    </Modal>

    <Modal v-if="rehome" :title="'整理既有設備歸戶：' + rehome.name" wide :busy="rhBusy" @cancel="rehome = null">
      <template v-if="!rhPreview">
        <p class="muted">挑選還沒歸戶的既有設備（最多 100 台，可跨頁挑選），下一步會逐台顯示「原值 → 新值」。</p>
        <label>搜尋設備<input v-model="rhSearch" type="search" placeholder="名稱、編號、品牌、型號、序號" /></label>
        <p v-if="rhError" class="field-error" role="alert">{{ rhError }}</p>
        <p v-if="rhLoading" class="muted" role="status">載入中…</p>
        <div class="table-scroll rh-table">
          <table>
            <thead><tr><th>選取</th><th>設備</th><th>據點</th><th>品牌／型號</th></tr></thead>
            <tbody>
              <tr v-for="e in rhRows" :key="e.id">
                <td><input type="checkbox" :checked="rhSelected.has(e.id)" :aria-label="'選取 ' + e.name" @change="rhToggle(e, ($event.target as HTMLInputElement).checked)" /></td>
                <td><strong>{{ e.name }}</strong><small>{{ e.asset_code }}</small></td>
                <td>{{ storeLabel(e.store) }}</td>
                <td>{{ [e.brand, e.model].filter(Boolean).join(" / ") || "—" }}</td>
              </tr>
              <tr v-if="!rhRows.length && !rhLoading"><td colspan="4" class="empty">沒有符合的未歸戶設備</td></tr>
            </tbody>
          </table>
        </div>
        <footer class="pagination"><span>已選 {{ rhSelected.size }} 台；共 {{ rhTotal }} 台未歸戶</span><button :disabled="rhPage <= 1" @click="rhPage--">上一頁</button><button :disabled="rhPage >= rhPages" @click="rhPage++">下一頁</button></footer>
        <div class="dialog-actions"><button type="button" @click="rehome = null">取消</button><button type="button" class="primary" :disabled="!rhSelected.size || rhBusy" @click="rhShowPreview">預覽改動（{{ rhSelected.size }} 台）</button></div>
      </template>
      <template v-else>
        <p class="notice" role="alert"><strong>歸戶會把這些設備的名稱、品牌、型號、分類，全部改成「{{ rehome.name }}」的內容，改了之後不能還原。</strong>請逐台確認下列改動。</p>
        <div class="table-scroll rh-table">
          <table>
            <thead><tr><th>設備</th><th>欄位</th><th>原值</th><th>新值</th></tr></thead>
            <tbody>
              <template v-for="i in rhPreview" :key="i.id">
                <tr v-for="(d, idx) in i.diff" :key="i.id + d.field">
                  <td v-if="idx === 0" :rowspan="i.diff.length"><strong>{{ i.asset_code }}</strong><small>{{ storeLabel(i.store) }}</small></td>
                  <td>{{ d.label }}</td>
                  <td :class="{ muted: !d.changed }">{{ d.from ?? "（空）" }}</td>
                  <td :class="{ 'state-text': d.changed }">{{ d.changed ? (d.to ?? "（空）") : "不變" }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <label class="check-row"><input v-model="rhConfirm" type="checkbox" /> 我已看過上列改動，了解歸戶後不能還原</label>
        <p v-if="rhError" class="field-error" role="alert">{{ rhError }}</p>
        <div class="dialog-actions"><button type="button" :disabled="rhBusy" @click="rhPreview = null">回上一步</button><button type="button" class="primary" :disabled="!rhConfirm || rhBusy" @click="rhApply">{{ rhBusy ? "處理中…" : "確認歸戶" }}</button></div>
      </template>
    </Modal>
  </GaShell>
</template>

<style scoped>
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.filter-cat { min-width: 240px; flex: 1; }
.ga-form { display: grid; gap: 14px; }
.ga-form label { display: grid; gap: 4px; }
.ga-form .check-row, .check-row { display: flex; align-items: center; gap: 8px; }
.ga-form .check-row input, .check-row input { width: auto; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.compat { border: 1px solid var(--line); border-radius: 6px; padding: 14px; margin: 0; }
.rh-table { max-height: 46vh; margin: 12px 0; }
@media (max-width: 640px) { .two, .three { grid-template-columns: 1fr; } }
</style>
