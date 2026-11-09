<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../../components/Modal.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { useDebounced, useGaGuard, useLatest, GA_TYPE_LABEL } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G02 三種分類樹（設備、設施、料件共用一頁，依頁籤種類決定）。
// Q4：停用前顯示精確筆數，底下還有啟用中的子分類或項目就不能停用；新增「刪除分類」（限完全沒有子分類與項目）。
// 舊版「筆數只算前 100 筆」改為伺服端精確筆數；清單改為逐層瀏覽 + 搜尋 + 分頁。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const type = computed(() => (props.tab.kind === "ga-equipment-categories" ? "equipment" : props.tab.kind === "ga-facility-categories" ? "facility" : "part") as "equipment" | "facility" | "part");
const noun = computed(() => GA_TYPE_LABEL[type.value]);

type Cat = {
  id: string; parent_id: string | null; name: string; code: string; description: string | null; sort_order: number; is_active: boolean;
  updated_at: string; path: string; child_count: number;
  requires_brand?: boolean; requires_model?: boolean; requires_serial_number?: boolean; requires_warranty?: boolean;
  default_base_unit?: string | null; is_recyclable_default?: boolean; manage_compatibility?: boolean;
};
const rows = ref<Cat[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const search = ref("");
const debounced = useDebounced(search, 300);
const activeFilter = ref("");
const stack = ref<Cat[]>([]); // 目前瀏覽到的路徑（最上層為空）
const canManage = ref(false);
const loading = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const parent = computed(() => stack.value[stack.value.length - 1] || null);

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ type: type.value, page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    else if (parent.value) q.set("parentId", parent.value.id);
    if (activeFilter.value) q.set("active", activeFilter.value);
    const res = await api<{ data: Cat[]; meta: { total: number }; permissions: { manage: boolean } }>("general-affairs/categories?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.meta.total;
    canManage.value = res.permissions.manage;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
function enter(c: Cat) {
  stack.value = [...stack.value, c];
  search.value = "";
  page.value = 1;
}
function goTo(index: number) {
  stack.value = stack.value.slice(0, index);
  page.value = 1;
}
watch([debounced, activeFilter], () => { page.value = 1; load(); });
watch([page, stack], load);
onMounted(load);
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

// ---- 新增與編輯
const form = reactive<any>({});
const editing = ref<Cat | null>(null);
const showForm = ref(false);
const formError = ref("");
const saving = ref(false);
function openCreate() {
  editing.value = null;
  Object.assign(form, { name: "", code: "", description: "", sort_order: 10, requires_brand: false, requires_model: false, requires_serial_number: false, requires_warranty: false, default_base_unit: "", is_recyclable_default: false, manage_compatibility: false });
  formError.value = "";
  showForm.value = true;
}
function openEdit(c: Cat) {
  editing.value = c;
  Object.assign(form, { ...c, description: c.description || "", default_base_unit: c.default_base_unit || "" });
  formError.value = "";
  showForm.value = true;
}
async function save() {
  if (saving.value) return;
  if (!String(form.name).trim()) { formError.value = "請輸入分類名稱"; return; }
  if (!String(form.code).trim()) { formError.value = "請輸入分類代碼"; return; }
  saving.value = true;
  formError.value = "";
  try {
    const body: any = {
      type: type.value, name: form.name, code: form.code, description: form.description, sort_order: Number(form.sort_order) || 0,
    };
    if (type.value === "equipment") Object.assign(body, { requires_brand: form.requires_brand, requires_model: form.requires_model, requires_serial_number: form.requires_serial_number, requires_warranty: form.requires_warranty });
    if (type.value === "part") Object.assign(body, { default_base_unit: form.default_base_unit, is_recyclable_default: form.is_recyclable_default, manage_compatibility: form.manage_compatibility });
    if (editing.value) {
      body.expected_updated_at = editing.value.updated_at;
      await api(`general-affairs/categories/${editing.value.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      body.parent_id = parent.value?.id || null;
      await api("general-affairs/categories", { method: "POST", body: JSON.stringify(body) });
    }
    showForm.value = false;
    notice.value = editing.value ? "已儲存分類" : "已新增分類";
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// ---- 停用／啟用／刪除（先查精確筆數）
type Action = { kind: "disable" | "enable" | "delete"; cat: Cat; text: string; blocked: boolean };
const action = ref<Action | null>(null);
const actionBusy = ref(false);
const actionError = ref("");
async function askAction(kind: Action["kind"], cat: Cat) {
  notice.value = "";
  error.value = "";
  if (kind === "enable") { action.value = { kind, cat, text: `確定重新啟用「${cat.name}」？`, blocked: false }; actionError.value = ""; return; }
  actionBusy.value = true;
  try {
    const res = await api<{ data: { children_total: number; children_active: number; items_total: number; items_active: number }; text: { disable: string; delete: string } }>(`general-affairs/categories/${cat.id}/usage?type=${type.value}`);
    const u = res.data;
    const blocked = kind === "disable" ? u.children_active + u.items_active > 0 : u.children_total + u.items_total > 0;
    action.value = { kind, cat, text: kind === "disable" ? res.text.disable : res.text.delete, blocked };
    actionError.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    actionBusy.value = false;
  }
}
async function confirmAction() {
  const a = action.value;
  if (!a || a.blocked) return;
  actionBusy.value = true;
  actionError.value = "";
  try {
    if (a.kind === "delete") await api(`general-affairs/categories/${a.cat.id}?type=${type.value}`, { method: "DELETE" });
    else await api(`general-affairs/categories/${a.cat.id}/active`, { method: "POST", body: JSON.stringify({ type: type.value, active: a.kind === "enable", expected_updated_at: a.cat.updated_at }) });
    notice.value = a.kind === "delete" ? `已刪除分類「${a.cat.name}」` : a.kind === "disable" ? `已停用分類「${a.cat.name}」` : `已啟用分類「${a.cat.name}」`;
    action.value = null;
    await load();
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    actionBusy.value = false;
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 資產與庫存</p>
      <h1>{{ noun }}分類</h1>
      <p class="muted">逐層瀏覽或用關鍵字搜尋分類。停用前會顯示底下的精確筆數；底下還有啟用中的子分類或項目時不能停用。</p>
    </div>
    <button v-if="canManage" class="primary" @click="openCreate">新增{{ parent ? "子" : "" }}分類</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', noun + '分類']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱、代碼或說明（可含逗號、括號）" /></label>
      <label>狀態<select v-model="activeFilter"><option value="">全部</option><option value="true">啟用中</option><option value="false">已停用</option></select></label>
    </div>
    <nav v-if="!debounced.trim()" class="cat-crumbs" aria-label="分類層級">
      <button type="button" :disabled="!stack.length" @click="goTo(0)">最上層</button>
      <template v-for="(c, i) in stack" :key="c.id"><span aria-hidden="true">›</span><button type="button" :disabled="i === stack.length - 1" @click="goTo(i + 1)">{{ c.name }}</button></template>
    </nav>
    <div class="list-meta"><span>共 {{ total }} 筆<template v-if="debounced.trim()">（跨層搜尋結果）</template></span><span v-if="loading" role="status">載入中…</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>名稱</th><th>代碼</th><th>狀態</th><th>子分類</th><th>排序</th><th v-if="canManage">操作</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.id">
            <td><strong>{{ c.name }}</strong><small v-if="c.path !== c.name">{{ c.path }}</small><small v-if="c.description">{{ c.description }}</small></td>
            <td>{{ c.code }}</td>
            <td><span class="state-text" :class="{ done: c.is_active }">{{ c.is_active ? "啟用中" : "已停用" }}</span></td>
            <td><button v-if="c.child_count" type="button" @click="enter(c)">{{ c.child_count }} 個 ›</button><template v-else>無</template></td>
            <td>{{ c.sort_order }}</td>
            <td v-if="canManage" class="actions">
              <button type="button" @click="openEdit(c)">編輯</button>
              <button v-if="c.is_active" type="button" :disabled="actionBusy" @click="askAction('disable', c)">停用</button>
              <button v-else type="button" :disabled="actionBusy" @click="askAction('enable', c)">啟用</button>
              <button type="button" class="danger" :disabled="actionBusy" @click="askAction('delete', c)">刪除</button>
              <button v-if="!debounced.trim() && !c.child_count" type="button" @click="enter(c)">新增子分類…</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="canManage ? 6 : 5" class="empty">{{ error ? "資料載入失敗" : debounced.trim() ? "找不到符合的分類" : "這一層還沒有分類" }}</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="showForm" :title="editing ? '編輯分類' : '新增' + (parent ? '子' : '') + '分類'" :busy="saving" @cancel="showForm = false">
      <p v-if="!editing && parent" class="muted">上層：{{ parent.path }}</p>
      <form class="ga-form" @submit.prevent="save">
        <label>名稱<span class="required"> 必填</span><input v-model="form.name" maxlength="80" autocomplete="off" /></label>
        <label>代碼<span class="required"> 必填（全公司唯一，含已停用的分類）</span><input v-model="form.code" maxlength="40" autocomplete="off" /></label>
        <label>說明<input v-model="form.description" maxlength="200" /></label>
        <label>排序<input v-model="form.sort_order" type="number" step="1" /></label>
        <template v-if="type === 'equipment'">
          <label class="check-row"><input v-model="form.requires_brand" type="checkbox" /> 設備必填品牌</label>
          <label class="check-row"><input v-model="form.requires_model" type="checkbox" /> 設備必填型號</label>
          <label class="check-row"><input v-model="form.requires_serial_number" type="checkbox" /> 設備必填序號</label>
          <label class="check-row"><input v-model="form.requires_warranty" type="checkbox" /> 設備必填保固</label>
        </template>
        <template v-if="type === 'part'">
          <label>預設基本單位<input v-model="form.default_base_unit" maxlength="20" /></label>
          <label class="check-row"><input v-model="form.is_recyclable_default" type="checkbox" /> 預設可回收</label>
          <label class="check-row"><input v-model="form.manage_compatibility" type="checkbox" /> 管理適用對象</label>
        </template>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="showForm = false">取消</button>
          <button type="submit" class="primary" :disabled="saving">{{ saving ? "儲存中…" : "儲存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="action" :title="action.kind === 'delete' ? '刪除分類' : action.kind === 'disable' ? '停用分類' : '啟用分類'" :busy="actionBusy" @cancel="action = null">
      <p><strong>{{ action.cat.name }}</strong>（{{ action.cat.code }}）</p>
      <p :class="{ 'field-error': action.blocked }" role="status">{{ action.text }}</p>
      <p v-if="action.kind === 'delete' && !action.blocked" class="muted">刪除後代碼會釋出給之後新增的分類使用，這個動作不能還原。</p>
      <p v-if="actionError" class="field-error" role="alert">{{ actionError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="actionBusy" @click="action = null">{{ action.blocked ? "關閉" : "取消" }}</button>
        <button v-if="!action.blocked" type="button" class="primary" :class="{ danger: action.kind === 'delete' }" :disabled="actionBusy" @click="confirmAction">
          {{ actionBusy ? "處理中…" : action.kind === "delete" ? "確認刪除" : action.kind === "disable" ? "確認停用" : "確認啟用" }}
        </button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.cat-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 14px 0 4px; }
.cat-crumbs button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.ga-form { display: grid; gap: 14px; }
.ga-form label { display: grid; gap: 4px; }
.ga-form .check-row { display: flex; align-items: center; gap: 8px; }
.ga-form .check-row input { width: auto; }
</style>
