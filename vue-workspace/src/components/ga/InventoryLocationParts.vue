<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import PartMultiPicker, { type PickedPart } from "./PartMultiPicker.vue";
import { useDebounced, useLatest } from "../../lib/ga";
import { draftPayload, fmtQty, type DraftItem, type LocationRow, type SettingRow } from "../../lib/ga-inventory";
import { ISSUE_UNIT_LABEL } from "../../../../lib/workspace/general-affairs/inventory-rules";

// G11 位置料件設定面板（位置對話框內）：清單（搜尋、分頁、精確筆數）、批次加入（C1：多選料件共用預設數字，加入前可逐筆調整）、
// 逐筆修改、停用／啟用、移除（C2：有庫存或進行中調撥由伺服端擋下，這裡顯示原因）。唯讀身分只看清單（內部備註由伺服端遮蔽）。
const props = defineProps<{ location: LocationRow; canManage: boolean; canAddParts: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const rows = ref<SettingRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const search = ref("");
const debounced = useDebounced(search, 300);
const activeFilter = ref("");
const loading = ref(false);
const error = ref("");
const notice = ref("");
const canSeeBalances = ref(false);
const internal = ref(false);
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    if (activeFilter.value) q.set("isActive", activeFilter.value);
    const res = await api<{ data: SettingRow[]; total: number; permissions: { canSeeBalances: boolean; internal: boolean } }>(`general-affairs/inventory/locations/${props.location.id}/parts?` + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    canSeeBalances.value = res.permissions.canSeeBalances;
    internal.value = res.permissions.internal;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, activeFilter], () => { page.value = 1; load(); });
watch(page, load);
watch(() => props.location.id, () => { page.value = 1; load(); });
load();

const partText = (p: SettingRow["part"]) => (p ? [p.part_code, p.brand, p.model, p.specification].filter(Boolean).join(" / ") : "");
const unitText = (r: SettingRow) => (r.preferred_issue_unit_type ? `${ISSUE_UNIT_LABEL[r.preferred_issue_unit_type]}（${r.resolvedPreferredIssueUnit || "—"}）` : "未指定");

// ---- 批次加入（C1）
const adding = ref(false);
const picked = ref<PickedPart[]>([]);
const items = ref<DraftItem[]>([]);
const shared = ref({ safety: "", reorder: "", maximum: "", unit: "", notes: "" });
const addError = ref("");
const addBusy = ref(false);
function openAdd() {
  adding.value = true;
  picked.value = [];
  items.value = [];
  shared.value = { safety: "", reorder: "", maximum: "", unit: "", notes: "" };
  addError.value = "";
}
// 選到的料件變動時，新加入的帶入共用預設數字，已調整過的保持不變。
watch(picked, (list) => {
  const keep = new Map(items.value.map((i) => [i.part_id, i]));
  items.value = list.map((p) => keep.get(p.id) || { part_id: p.id, name: p.name, part_code: p.part_code, base_unit: p.base_unit, ...shared.value });
}, { deep: true });
function applyShared() {
  items.value = items.value.map((i) => ({ ...i, ...shared.value }));
}
async function submitAdd() {
  if (addBusy.value) return;
  if (!items.value.length) { addError.value = "請先選擇要加入的料件"; return; }
  addBusy.value = true;
  addError.value = "";
  try {
    const res = await api<{ count: number }>(`general-affairs/inventory/locations/${props.location.id}/parts`, { method: "POST", body: JSON.stringify({ items: items.value.map(draftPayload) }) });
    notice.value = `已加入 ${res.count} 筆料件設定`;
    adding.value = false;
    page.value = 1;
    await load();
    emit("changed");
  } catch (e) {
    addError.value = (e as Error).message;
  } finally {
    addBusy.value = false;
  }
}

// ---- 逐筆修改
const editing = ref<SettingRow | null>(null);
const editForm = ref({ safety: "", reorder: "", maximum: "", unit: "", notes: "", is_active: true });
const editError = ref("");
const editBusy = ref(false);
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
function openEdit(r: SettingRow) {
  editing.value = r;
  editForm.value = { safety: s(r.safety_stock_qty), reorder: s(r.reorder_point_qty), maximum: s(r.maximum_stock_qty), unit: r.preferred_issue_unit_type || "", notes: r.notes || "", is_active: r.is_active };
  editError.value = "";
}
async function submitEdit() {
  if (!editing.value || editBusy.value) return;
  const f = editForm.value;
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  const body: Record<string, unknown> = {
    safety_stock_qty: n(f.safety), reorder_point_qty: n(f.reorder), maximum_stock_qty: n(f.maximum), preferred_issue_unit_type: f.unit || null,
    is_active: f.is_active, expected_updated_at: editing.value.updated_at,
  };
  if (internal.value) body.notes = n(f.notes);
  editBusy.value = true;
  editError.value = "";
  try {
    await api(`general-affairs/inventory/locations/${props.location.id}/parts/${editing.value.id}`, { method: "PATCH", body: JSON.stringify(body) });
    notice.value = `已儲存「${editing.value.part?.name || "料件"}」的設定`;
    editing.value = null;
    await load();
    emit("changed");
  } catch (e) {
    editError.value = (e as Error).message;
  } finally {
    editBusy.value = false;
  }
}

// ---- 停用／啟用
async function toggle(r: SettingRow) {
  notice.value = "";
  error.value = "";
  try {
    await api(`general-affairs/inventory/locations/${props.location.id}/parts/${r.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !r.is_active, expected_updated_at: r.updated_at }) });
    notice.value = r.is_active ? `已停用「${r.part?.name}」的設定` : `已啟用「${r.part?.name}」的設定`;
    await load();
    emit("changed");
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---- 移除
const removing = ref<SettingRow | null>(null);
const removeReason = ref("");
const removeError = ref("");
const removeBusy = ref(false);
function askRemove(r: SettingRow) {
  notice.value = "";
  removing.value = r;
  removeReason.value = "";
  removeError.value = "";
}
async function confirmRemove() {
  if (!removing.value || removeBusy.value) return;
  if (!removeReason.value.trim()) { removeError.value = "請輸入移除原因"; return; }
  removeBusy.value = true;
  removeError.value = "";
  try {
    await api(`general-affairs/inventory/locations/${props.location.id}/parts/${removing.value.id}`, { method: "DELETE", body: JSON.stringify({ deletion_reason: removeReason.value.trim(), expected_updated_at: removing.value.updated_at }) });
    notice.value = `已移除「${removing.value.part?.name}」的設定`;
    removing.value = null;
    await load();
    emit("changed");
  } catch (e) {
    removeError.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 409 && e.data?.code === "STALE") await load();
  } finally {
    removeBusy.value = false;
  }
}
</script>

<template>
  <section class="parts-panel" aria-label="位置料件設定" data-testid="location-parts">
    <div class="panel-head">
      <h3>料件設定 <small class="muted">（共 {{ total }} 筆）</small></h3>
      <button v-if="canManage && canAddParts" type="button" class="primary" :disabled="!location.is_active" :title="location.is_active ? '' : '位置已停用，不能新增料件設定'" @click="openAdd">加入料件</button>
    </div>
    <p v-if="canManage && !canAddParts" class="muted">您有位置管理權限，但缺少「料件查看」權限，無法新增位置料件設定（仍可修改、停用既有設定）。</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div class="panel-filter">
      <label class="grow">搜尋料件<input v-model="search" type="search" placeholder="名稱、代碼、條碼、品牌、型號、規格" /></label>
      <label>狀態<select v-model="activeFilter" aria-label="設定狀態"><option value="">全部</option><option value="true">啟用中</option><option value="false">已停用</option></select></label>
    </div>
    <p v-if="loading" class="muted" role="status">載入中…</p>
    <div class="table-scroll part-table">
      <table>
        <thead><tr><th>料件</th><th>安全／補貨／最高</th><th>偏好領用單位</th><th v-if="canSeeBalances">目前庫存</th><th>狀態</th><th v-if="internal">備註</th><th v-if="canManage">操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-testid="setting-row">
            <td><strong>{{ r.part?.name || "（無法讀取料件）" }}</strong><small class="sub">{{ partText(r.part) }}</small></td>
            <td>{{ fmtQty(r.safety_stock_qty) }} ／ {{ fmtQty(r.reorder_point_qty) }} ／ {{ fmtQty(r.maximum_stock_qty) }}</td>
            <td>{{ unitText(r) }}</td>
            <td v-if="canSeeBalances">{{ r.stock_qty ?? 0 }} {{ r.part?.base_unit }}</td>
            <td><span class="state-text" :class="{ done: r.is_active }">{{ r.is_active ? "啟用中" : "已停用" }}</span></td>
            <td v-if="internal">{{ r.notes || "—" }}</td>
            <td v-if="canManage"><div class="actions">
              <button type="button" :aria-label="`修改 ${r.part?.name} 的設定`" @click="openEdit(r)">修改</button>
              <button type="button" :aria-label="`${r.is_active ? '停用' : '啟用'} ${r.part?.name} 的設定`" @click="toggle(r)">{{ r.is_active ? "停用" : "啟用" }}</button>
              <button type="button" class="danger" :aria-label="`移除 ${r.part?.name} 的設定`" @click="askRemove(r)">移除</button>
            </div></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="4 + (canSeeBalances ? 1 : 0) + (internal ? 1 : 0) + (canManage ? 1 : 0)" class="empty">{{ search.trim() || activeFilter ? "找不到符合的設定" : "這個位置還沒有料件設定（沒有設定的料件不能過帳或調撥進來）" }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="setting-cards" aria-label="料件設定清單">
      <li v-for="r in rows" :key="r.id" class="setting-card">
        <div class="card-title"><strong>{{ r.part?.name || "（無法讀取料件）" }}</strong><small>{{ partText(r.part) }}</small></div>
        <p class="card-line">安全 {{ fmtQty(r.safety_stock_qty) }}／補貨 {{ fmtQty(r.reorder_point_qty) }}／最高 {{ fmtQty(r.maximum_stock_qty) }}</p>
        <p class="card-line muted">領用單位：{{ unitText(r) }}<template v-if="canSeeBalances"> · 庫存 {{ r.stock_qty ?? 0 }} {{ r.part?.base_unit }}</template></p>
        <p v-if="internal && r.notes" class="card-line muted">備註：{{ r.notes }}</p>
        <span class="state-text" :class="{ done: r.is_active }">{{ r.is_active ? "啟用中" : "已停用" }}</span>
        <div v-if="canManage" class="card-actions">
          <button type="button" @click="openEdit(r)">修改</button>
          <button type="button" @click="toggle(r)">{{ r.is_active ? "停用" : "啟用" }}</button>
          <button type="button" class="danger" @click="askRemove(r)">移除</button>
        </div>
      </li>
      <li v-if="!rows.length && !loading" class="card-empty">{{ search.trim() || activeFilter ? "找不到符合的設定" : "這個位置還沒有料件設定" }}</li>
    </ul>
    <footer v-if="pages > 1" class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button type="button" :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <Modal v-if="adding" title="加入料件設定" wide :busy="addBusy" @cancel="adding = false">
      <p class="muted">一次可選多個料件，共用同一組預設數字；加入前可以逐筆調整。沒有設定的料件，這個位置不能過帳或調撥進來。</p>
      <PartMultiPicker v-model="picked" :disabled="addBusy" />
      <fieldset class="shared" :disabled="addBusy">
        <legend>共用預設（新選的料件會帶入；改完可按「套用到全部」）</legend>
        <label>安全庫存<input v-model="shared.safety" inputmode="decimal" aria-label="共用安全庫存" /></label>
        <label>補貨點<input v-model="shared.reorder" inputmode="decimal" aria-label="共用補貨點" /></label>
        <label>最高庫存<input v-model="shared.maximum" inputmode="decimal" aria-label="共用最高庫存" /></label>
        <label>偏好領用單位<select v-model="shared.unit" aria-label="共用偏好領用單位"><option value="">未指定</option><option value="BASE">基本單位</option><option value="PURCHASE">採購單位（料件要有採購單位）</option></select></label>
        <label class="wide">備註<input v-model="shared.notes" maxlength="500" aria-label="共用備註" /></label>
        <button type="button" :disabled="!items.length" @click="applyShared">套用到全部 {{ items.length }} 筆</button>
      </fieldset>
      <div v-if="items.length" class="table-scroll item-table">
        <table>
          <thead><tr><th>料件</th><th>安全</th><th>補貨點</th><th>最高</th><th>偏好單位</th><th>備註</th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in items" :key="it.part_id" data-testid="draft-row">
              <td><strong>{{ it.name }}</strong><small class="sub">{{ it.part_code }}</small></td>
              <td><input v-model="it.safety" inputmode="decimal" :aria-label="`${it.name} 安全庫存`" /></td>
              <td><input v-model="it.reorder" inputmode="decimal" :aria-label="`${it.name} 補貨點`" /></td>
              <td><input v-model="it.maximum" inputmode="decimal" :aria-label="`${it.name} 最高庫存`" /></td>
              <td><select v-model="it.unit" :aria-label="`${it.name} 偏好領用單位`"><option value="">未指定</option><option value="BASE">基本單位</option><option value="PURCHASE">採購單位</option></select></td>
              <td><input v-model="it.notes" maxlength="500" :aria-label="`${it.name} 備註`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="addError" class="field-error" role="alert">{{ addError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="addBusy" @click="adding = false">取消</button>
        <button type="button" class="primary" :disabled="addBusy || !items.length" @click="submitAdd">{{ addBusy ? "加入中…" : `加入 ${items.length} 筆` }}</button>
      </div>
    </Modal>

    <Modal v-if="editing" :title="`修改設定：${editing.part?.name || ''}`" :busy="editBusy" @cancel="editing = null">
      <form class="edit-form" @submit.prevent="submitEdit">
        <p class="muted">料件與位置不能更換；要換請先移除這筆設定再重新加入。</p>
        <label>安全庫存<input v-model="editForm.safety" inputmode="decimal" aria-label="安全庫存" /></label>
        <label>補貨點<input v-model="editForm.reorder" inputmode="decimal" aria-label="補貨點" /></label>
        <label>最高庫存<input v-model="editForm.maximum" inputmode="decimal" aria-label="最高庫存" /></label>
        <label>偏好領用單位<select v-model="editForm.unit" aria-label="偏好領用單位"><option value="">未指定</option><option value="BASE">基本單位</option><option value="PURCHASE">採購單位（料件要有採購單位）</option></select></label>
        <label v-if="internal">備註<input v-model="editForm.notes" maxlength="500" aria-label="備註" /></label>
        <label class="check"><input v-model="editForm.is_active" type="checkbox" />啟用（停用後不能過帳或調撥進來）</label>
        <p v-if="editError" class="field-error" role="alert">{{ editError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="editBusy" @click="editing = null">取消</button>
          <button type="submit" class="primary" :disabled="editBusy">{{ editBusy ? "儲存中…" : "儲存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="removing" title="移除料件設定" :busy="removeBusy" @cancel="removing = null">
      <p><strong>{{ removing.part?.name }}</strong></p>
      <p class="muted">移除後這個位置不能再過帳或調撥這個料件進來（可以重新加入）。位置仍有此料件庫存或進行中調撥時不能移除。請填寫移除原因。</p>
      <label>移除原因<input v-model="removeReason" maxlength="200" aria-label="移除原因" /></label>
      <p v-if="removeError" class="field-error" role="alert">{{ removeError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="removeBusy" @click="removing = null">取消</button>
        <button type="button" class="primary danger" :disabled="removeBusy" @click="confirmRemove">{{ removeBusy ? "處理中…" : "確認移除" }}</button>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.parts-panel { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 14px; display: grid; gap: 10px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.panel-head h3 { margin: 0; }
.panel-filter { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
.panel-filter label { display: grid; gap: 4px; }
.panel-filter .grow { flex: 1; min-width: 200px; }
.sub { display: block; color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.shared { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: end; margin: 10px 0; }
.shared legend { font-size: 12px; color: var(--muted); padding: 0 6px; }
.shared label { display: grid; gap: 4px; }
.shared .wide { grid-column: span 3; }
.item-table input, .item-table select { min-width: 72px; width: 100%; }
.edit-form { display: grid; gap: 10px; }
.edit-form label { display: grid; gap: 4px; }
.edit-form .check { display: flex; align-items: center; gap: 8px; }
.edit-form .check input { width: auto; }
.setting-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 10px; }
.setting-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 10px; display: grid; gap: 6px; min-width: 0; }
.card-title { display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-title small { color: var(--muted); }
.card-line { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.card-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.card-actions button { min-height: 44px; }
.card-empty { text-align: center; color: var(--muted); padding: 16px; }
.empty { text-align: center; color: var(--muted); padding: 16px; }
@media (max-width: 700px) {
  .part-table { display: none; }
  .setting-cards { display: grid; }
  .shared { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .shared .wide { grid-column: span 2; }
}
</style>
