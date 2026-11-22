<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { useDebounced, useLatest } from "../../lib/ga";
import { REGION_TYPE_LABELS, REGION_TYPES } from "../../../../lib/workspace/general-affairs/vendor-rules";
import { descendantsOf, errorCodeOf, errorText, flattenTree, timeText, type TreeRow } from "../../lib/ga-vendors";

// G20 服務分類與服務區域維護（兩頁共用）：樹狀與列表兩種檢視、統計卡、搜尋與狀態篩選、新增與編輯（代碼建立後鎖定、上層不可是自己或子孫）、停用後仍顯示名稱。
// 沒有刪除：不用的請改為停用。區域的縣市與行政區固定資料由系統預先放入，總務可改名、排序與停用。
const props = defineProps<{ kind: "category" | "region"; canManage: boolean }>();
const isRegion = props.kind === "region";
const noun = isRegion ? "服務區域" : "服務分類";
const base = isRegion ? "general-affairs/service-regions" : "general-affairs/service-categories";
const view = ref<"tree" | "list">("tree");
const all = ref<TreeRow[]>([]);
const loadingAll = ref(false);
const error = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const regionType = ref("");
const expanded = ref<Record<string, boolean>>({});
// 列表檢視：伺服端搜尋與分頁。
const rows = ref<TreeRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loadingList = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const editing = ref<TreeRow | null>(null);
const creating = ref(false);
const form = reactive({ name: "", code: "", parent_id: "", status: "active", sort_order: "0", description: "", icon_key: "", common_items: "", region_type: "city", included_locations: "" });
const formError = ref("");
const busy = ref(false);
const savedMsg = ref("");

const stats = computed(() => {
  const s: Record<string, number> = { total: all.value.length, active: 0, inactive: 0 };
  for (const r of all.value) { if (r.status === "active") s.active += 1; else s.inactive += 1; if (isRegion && r.region_type) s[r.region_type] = (s[r.region_type] || 0) + 1; }
  return s;
});
const flat = computed(() => flattenTree(all.value));
const visibleTree = computed(() => {
  const byId = new Map(all.value.map((r) => [r.id, r]));
  const q = debounced.value.trim().toLowerCase();
  const matches = (r: TreeRow) => (!status.value || r.status === status.value) && (!regionType.value || r.region_type === regionType.value) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  const filtering = !!(q || status.value || regionType.value);
  if (filtering) return flat.value.filter(matches);
  const open = (r: TreeRow): boolean => {
    let p = r.parent_id ? byId.get(r.parent_id) : null;
    while (p) { if (!expanded.value[p.id]) return false; p = p.parent_id ? byId.get(p.parent_id) : null; }
    return true;
  };
  return flat.value.filter(open);
});
const hasKids = (id: string) => all.value.some((r) => r.parent_id === id);
const typeLabel = (t?: string) => (t ? (REGION_TYPE_LABELS as any)[t] || t : "");

async function loadAll() {
  loadingAll.value = true;
  error.value = "";
  try {
    all.value = (await api<{ data: TreeRow[] }>(`${base}?options=1`)).data;
  } catch (e) {
    all.value = [];
    error.value = errorText(e);
  } finally {
    loadingAll.value = false;
  }
}
async function loadList() {
  const n = latest.next();
  loadingList.value = true;
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (status.value) q.set("status", status.value);
    if (regionType.value) q.set("regionType", regionType.value);
    const res = await api<{ data: TreeRow[]; total: number }>(`${base}?${q}`);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; total.value = 0; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loadingList.value = false;
  }
}
async function reload() { await loadAll(); if (view.value === "list") await loadList(); }
watch([debounced, status, regionType], () => { page.value = 1; if (view.value === "list") void loadList(); });
watch(page, () => void loadList());
watch(view, (v) => { if (v === "list") void loadList(); });
onMounted(() => void loadAll());

const parentOptions = computed(() => {
  const self = editing.value?.id;
  const banned = new Set(self ? [self, ...descendantsOf(all.value, self)] : []);
  return flat.value.filter((r) => !banned.has(r.id));
});
function openNew(parent?: TreeRow) {
  Object.assign(form, { name: "", code: "", parent_id: parent?.id || "", status: "active", sort_order: "0", description: "", icon_key: "", common_items: "", region_type: parent ? (parent.region_type === "city" ? "district" : "city") : "city", included_locations: "" });
  formError.value = "";
  editing.value = null;
  creating.value = true;
}
async function openEdit(r: TreeRow) {
  formError.value = "";
  try {
    const d = (await api<{ data: TreeRow }>(`${base}/${r.id}`)).data;
    Object.assign(form, {
      name: d.name, code: d.code, parent_id: d.parent_id || "", status: d.status, sort_order: String(d.sort_order ?? 0), description: d.description || "", icon_key: d.icon_key || "",
      common_items: (d.common_items || []).join("、"), region_type: d.region_type || "city", included_locations: (d.included_locations || []).join("、"),
    });
    editing.value = d;
    creating.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}
const list = (s: string) => Array.from(new Set(s.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean)));
async function save() {
  if (busy.value) return;
  formError.value = "";
  if (!form.name.trim()) { formError.value = `請填寫${noun}名稱`; return; }
  if (!editing.value && !form.code.trim()) { formError.value = "請填寫代碼（英文字母、數字、底線與連字號）"; return; }
  if (!/^-?\d{1,5}$/.test(form.sort_order.trim() || "0")) { formError.value = "排序要是整數"; return; }
  busy.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(), parent_id: form.parent_id || null, status: form.status, sort_order: Number(form.sort_order || 0), description: form.description,
    };
    if (!editing.value) payload.code = form.code.trim();
    if (isRegion) { payload.region_type = form.region_type; payload.included_locations = list(form.included_locations); }
    else { payload.icon_key = form.icon_key; payload.common_items = list(form.common_items); }
    if (editing.value) await api(`${base}/${editing.value.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expected_updated_at: editing.value.updated_at }) });
    else await api(base, { method: "POST", body: JSON.stringify(payload) });
    savedMsg.value = `已儲存「${form.name.trim()}」。`;
    creating.value = false;
    editing.value = null;
    await reload();
  } catch (e) {
    formError.value = errorText(e);
    if (errorCodeOf(e) === "STALE") await reload();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ul class="stat-cards" :aria-label="noun + '統計'">
    <li><div data-testid="card-total"><span>全部</span><strong data-testid="stat-total">{{ stats.total }}</strong></div></li>
    <li><div><span>啟用中</span><strong data-testid="stat-active">{{ stats.active }}</strong></div></li>
    <li><div><span>已停用</span><strong data-testid="stat-inactive">{{ stats.inactive }}</strong></div></li>
    <template v-if="isRegion"><li v-for="t in REGION_TYPES" :key="t"><div><span>{{ typeLabel(t) }}</span><strong>{{ stats[t] || 0 }}</strong></div></li></template>
  </ul>
  <div class="toolbar">
    <div class="seg" role="group" aria-label="檢視方式">
      <button type="button" :class="{ on: view === 'tree' }" :aria-pressed="view === 'tree'" data-testid="view-tree" @click="view = 'tree'">樹狀</button>
      <button type="button" :class="{ on: view === 'list' }" :aria-pressed="view === 'list'" data-testid="view-list" @click="view = 'list'">列表</button>
    </div>
    <button v-if="canManage" type="button" class="primary" data-testid="new-item" @click="openNew()">新增{{ noun }}</button>
  </div>
  <div class="filter-bar">
    <label class="grow">搜尋<input v-model="search" type="search" :placeholder="'名稱、代碼' + (view === 'list' ? '、說明' : '')" data-testid="tree-search" /></label>
    <label>狀態<select v-model="status" data-testid="tree-status"><option value="">全部</option><option value="active">啟用</option><option value="inactive">停用</option><option v-if="isRegion" value="archived">封存</option></select></label>
    <label v-if="isRegion">類型<select v-model="regionType" data-testid="tree-region-type"><option value="">全部</option><option v-for="t in REGION_TYPES" :key="t" :value="t">{{ typeLabel(t) }}</option></select></label>
  </div>
  <p v-if="savedMsg" class="notice success" role="status" data-testid="tree-saved">{{ savedMsg }}</p>
  <p v-if="error" class="notice error" role="alert" data-testid="tree-error">{{ error }}<button type="button" @click="reload">重新載入</button></p>
  <p v-if="loadingAll" role="status">載入中…</p>

  <template v-if="view === 'tree'">
    <div class="list-meta"><span data-testid="tree-total">顯示 {{ visibleTree.length }} / {{ all.length }} 筆</span></div>
    <ul class="tree" :aria-label="noun + '樹狀清單'">
      <li v-for="r in visibleTree" :key="r.id" class="tree-row" :class="{ off: r.status !== 'active' }" data-testid="tree-row" :style="{ paddingLeft: (r as any).depth * 20 + 8 + 'px' }">
        <button v-if="hasKids(r.id)" type="button" class="tog" :aria-expanded="!!expanded[r.id]" :aria-label="(expanded[r.id] ? '收合' : '展開') + r.name" @click="expanded[r.id] = !expanded[r.id]">{{ expanded[r.id] ? "▾" : "▸" }}</button>
        <span v-else class="tog" aria-hidden="true" />
        <span class="nm" data-testid="tree-name">{{ r.name }}</span>
        <small class="code">{{ r.code }}</small>
        <small v-if="isRegion && r.region_type" class="tag">{{ typeLabel(r.region_type) }}</small>
        <small v-if="r.status !== 'active'" class="tag off" data-testid="tree-off">{{ r.status === "archived" ? "封存" : "已停用" }}</small>
        <small v-if="!isRegion && r.vendor_count != null" class="muted">{{ r.vendor_count }} 家廠商</small>
        <span class="spacer" />
        <button v-if="canManage && isRegion" type="button" class="link" :data-testid="'add-child-' + r.name" @click="openNew(r)">新增下層</button>
        <button type="button" :data-testid="'edit-' + r.name" @click="openEdit(r)">{{ canManage ? "編輯" : "查看" }}</button>
      </li>
      <li v-if="!visibleTree.length && !loadingAll" class="card-empty">{{ error ? "資料載入失敗" : all.length ? "找不到符合的項目" : `還沒有${noun}` + (canManage ? "，請按「新增」建立" : "") }}</li>
    </ul>
  </template>
  <template v-else>
    <div class="list-meta"><span data-testid="tree-total">共 {{ total }} 筆</span><span v-if="loadingList" role="status">載入中…</span></div>
    <div class="table-wrap">
      <table class="tree-table" :aria-label="noun + '列表'">
        <thead><tr><th>名稱</th><th>代碼</th><th>上層</th><th v-if="isRegion">類型</th><th>狀態</th><th>排序</th><th><span class="sr-only">操作</span></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="list-row">
            <td>{{ r.name }}</td><td>{{ r.code }}</td><td>{{ r.parent_name || "—" }}</td><td v-if="isRegion">{{ typeLabel(r.region_type) }}</td>
            <td>{{ r.status === "active" ? "啟用" : r.status === "archived" ? "封存" : "停用" }}</td><td>{{ r.sort_order }}</td>
            <td><button type="button" :data-testid="'list-edit-' + r.name" @click="openEdit(r)">{{ canManage ? "編輯" : "查看" }}</button></td>
          </tr>
          <tr v-if="!rows.length && !loadingList"><td :colspan="isRegion ? 7 : 6" class="card-empty">找不到符合的項目</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loadingList" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loadingList" @click="page++">下一頁</button>
    </footer>
  </template>

  <Modal v-if="creating" :title="(editing ? (canManage ? '編輯' : '查看') : '新增') + noun" :busy="busy" @cancel="creating = false">
    <form class="tf" novalidate data-testid="tree-form" @submit.prevent="save">
      <p v-if="formError" class="notice error pre" role="alert" data-testid="tf-error">{{ formError }}</p>
      <fieldset :disabled="!canManage || busy" class="tf-fields">
        <label>名稱（必填）<input v-model="form.name" maxlength="50" data-testid="tf-name" /></label>
        <label>代碼{{ editing ? "（建立後不能修改）" : "（必填，會轉成大寫）" }}<input v-model="form.code" maxlength="30" :disabled="!!editing" data-testid="tf-code" /></label>
        <label>上層<select v-model="form.parent_id" data-testid="tf-parent"><option value="">（無，最上層）</option><option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ "　".repeat((p as any).depth) }}{{ p.name }}{{ p.status !== "active" ? "（停用）" : "" }}</option></select></label>
        <label v-if="isRegion">區域類型<select v-model="form.region_type" data-testid="tf-region-type"><option v-for="t in REGION_TYPES" :key="t" :value="t">{{ typeLabel(t) }}</option></select></label>
        <label>狀態<select v-model="form.status" data-testid="tf-status"><option value="active">啟用</option><option value="inactive">停用（既有廠商仍顯示名稱，新增時不能勾選）</option><option v-if="isRegion" value="archived">封存</option></select></label>
        <label>排序（數字小的在前）<input v-model="form.sort_order" inputmode="numeric" data-testid="tf-sort" /></label>
        <label v-if="!isRegion">圖示代號（選填）<input v-model="form.icon_key" maxlength="40" /></label>
        <label v-if="!isRegion">常用項目（用頓號分隔）<input v-model="form.common_items" /></label>
        <label v-if="isRegion">包含地點（用頓號分隔）<input v-model="form.included_locations" /></label>
        <label>說明<textarea v-model="form.description" rows="2" maxlength="500" data-testid="tf-desc" /></label>
      </fieldset>
      <p v-if="editing" class="muted">最後修改：{{ timeText(editing.updated_at) }}</p>
      <div class="dialog-actions">
        <button type="button" data-testid="tf-cancel" :disabled="busy" @click="creating = false">{{ canManage ? "取消" : "關閉" }}</button>
        <button v-if="canManage" type="submit" class="primary" :disabled="busy" data-testid="tf-save">{{ busy ? "儲存中…" : "儲存" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li > div { display: grid; gap: 2px; padding: 8px 12px; min-height: 56px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 20px; }
.toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: var(--surface); padding: 6px 16px; }
.seg button.on { background: var(--soft); color: var(--primary); font-weight: 700; }
.tree { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.tree-row { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); padding-top: 4px; padding-bottom: 4px; padding-right: 8px; min-width: 0; flex-wrap: wrap; }
.tree-row:last-child { border-bottom: 0; }
.tree-row.off .nm { color: var(--muted); }
.tog { width: 24px; min-height: 24px; border: 0; background: none; padding: 0; text-align: center; flex: none; }
.nm { font-weight: 600; overflow-wrap: anywhere; }
.code { color: var(--muted); }
.tag { border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; font-size: 11px; }
.tag.off { color: #b3261e; border-color: #d9a3a0; }
.spacer { flex: 1; }
.link { border: 0; background: none; color: var(--primary); text-decoration: underline; padding: 4px; }
.card-empty { text-align: center; color: var(--muted); padding: 20px; list-style: none; }
.table-wrap { overflow-x: auto; }
.tree-table { width: 100%; border-collapse: collapse; }
.tree-table th, .tree-table td { text-align: left; border-bottom: 1px solid var(--line); padding: 6px 8px; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.tf { display: grid; gap: 10px; min-width: 0; }
.tf-fields { border: 0; padding: 0; margin: 0; display: grid; gap: 10px; min-width: 0; }
.tf-fields label { display: grid; gap: 4px; min-width: 0; }
.pre { white-space: pre-line; }
@media (max-width: 700px) {
  .tree-row button, .dialog-actions button, .seg button { min-height: 44px; }
  .stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
