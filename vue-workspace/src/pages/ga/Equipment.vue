<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../../components/Modal.vue";
import AssetCategoryPicker from "../../components/ga/AssetCategoryPicker.vue";
import AssetOnboardingBar from "../../components/ga/AssetOnboardingBar.vue";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import EquipmentFormFields from "../../components/ga/EquipmentFormFields.vue";
import GaShell from "../../components/ga/GaShell.vue";
import ResourceAttachmentPanel from "../../components/ga/ResourceAttachmentPanel.vue";
import {
  CRITICALITY_LABEL, EQUIPMENT_STATUS_LABEL, equipmentFormFromRow, equipmentPatch, formatDate, formatMoney, ONBOARDING_LABEL, ONBOARDING_STATUSES, storeLabel,
  validateEquipmentForm, WARRANTY_CLAIM_METHODS, WARRANTY_FILTER_OPTIONS, type EquipmentForm,
} from "../../lib/ga-assets";
import { openGaPage, useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G06 設備清冊：搜尋（含逗號、括號）、分頁（伺服端精確筆數）、保固與貼標篩選、詳情、編輯、刪除、更正所屬門市、恢復使用。
// Q5：店長身分（沒有設備查看／管理權限）只看自己門市的基本欄位；Q8：報廢後總務可恢復並沿用原 QR 標籤；Q10：有未結案單不能刪除，編輯不能改所屬門市。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Asset = Record<string, any> & { id: string; name: string; updated_at: string; status: string; store_id: string };
const rows = ref<Asset[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const stats = ref({ total: 0, attention: 0, warrantyAttention: 0 });
const canManage = ref(false);
const seeFull = ref(false);
const search = ref("");
const debounced = useDebounced(search, 300);
const storeId = ref("");
const categoryId = ref("");
const status = ref("");
const warranty = ref("");
const onboarding = ref("");
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
    if (storeId.value) q.set("storeId", storeId.value);
    if (categoryId.value) q.set("categoryId", categoryId.value);
    if (status.value) q.set("status", status.value);
    if (warranty.value) q.set("warranty", warranty.value);
    if (onboarding.value) q.set("onboardingStatus", onboarding.value);
    const res = await api<{ data: Asset[]; total: number; stats: typeof stats.value; permissions: { manage: boolean; seeFull: boolean } }>("general-affairs/equipment?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.total;
    stats.value = res.stats;
    canManage.value = res.permissions.manage;
    seeFull.value = res.permissions.seeFull;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, storeId, categoryId, status, warranty, onboarding], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);

// ------------------------------------------------------------------------------------------ 詳情與編輯
const detail = ref<Asset | null>(null);
const detailWarnings = ref<{ code: string; message: string }[]>([]);
const detailBusy = ref(false);
const detailError = ref("");
const mode = ref<"view" | "edit">("view");
const form = ref<EquipmentForm>(equipmentFormFromRow({}));
const original = ref<EquipmentForm>(equipmentFormFromRow({}));
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const discardAsk = ref(false);
const dirty = computed(() => mode.value === "edit" && JSON.stringify(form.value) !== JSON.stringify(original.value));
const events = ref<any[] | null>(null);
const eventsError = ref("");

async function openDetail(row: Asset) {
  notice.value = "";
  detail.value = { ...row };
  detailWarnings.value = [];
  detailError.value = "";
  mode.value = "view";
  events.value = null;
  eventsError.value = "";
  discardAsk.value = false;
  detailBusy.value = true;
  try {
    const res = await api<{ data: Asset; warnings: { code: string; message: string }[] }>(`general-affairs/equipment/${row.id}`);
    detail.value = res.data;
    detailWarnings.value = res.warnings;
  } catch (e) {
    detailError.value = (e as Error).message;
  } finally {
    detailBusy.value = false;
  }
}
function startEdit() {
  if (!detail.value) return;
  original.value = equipmentFormFromRow(detail.value);
  form.value = equipmentFormFromRow(detail.value);
  errors.value = {};
  detailError.value = "";
  mode.value = "edit";
}
function cancelEdit() {
  if (dirty.value && !discardAsk.value) { discardAsk.value = true; return; }
  discardAsk.value = false;
  mode.value = "view";
}
function closeDetail() {
  if (dirty.value && !discardAsk.value) { discardAsk.value = true; return; }
  discardAsk.value = false;
  detail.value = null;
}
async function save() {
  if (!detail.value || saving.value) return;
  errors.value = validateEquipmentForm(form.value);
  if (Object.keys(errors.value).length) return;
  const patch = equipmentPatch(original.value, form.value);
  if (!Object.keys(patch).length) { notice.value = "沒有修改任何欄位"; mode.value = "view"; return; }
  saving.value = true;
  detailError.value = "";
  try {
    const res = await api<{ data: Asset; warnings: { code: string; message: string }[] }>(`general-affairs/equipment/${detail.value.id}`, {
      method: "PATCH", body: JSON.stringify({ ...patch, expected_updated_at: detail.value.updated_at }),
    });
    detail.value = res.data;
    detailWarnings.value = res.warnings;
    mode.value = "view";
    notice.value = `已儲存設備「${res.data.name}」` + (res.warnings.some((w) => w.code === "LABEL_REPRINT") ? "。資產編號已修改，已印出的 QR 標籤編號要重新列印" : "");
    await load();
  } catch (e) {
    detailError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function loadEvents() {
  if (!detail.value) return;
  eventsError.value = "";
  try {
    events.value = (await api<{ data: any[] }>(`general-affairs/equipment/${detail.value.id}/events`)).data;
  } catch (e) {
    eventsError.value = (e as Error).message;
  }
}
const EVENT_LABEL: Record<string, string> = {
  TRANSFER_REQUESTED: "發起轉移", TRANSFER_HANDED_OVER: "確認交出", STORE_TRANSFER: "轉移完成", TRANSFER_CANCELLED: "取消轉移", STORE_CORRECTION: "更正所屬門市", QR_RESTORED: "恢復使用並重新啟用 QR",
};

// ------------------------------------------------------------------------------------------ 刪除（Q10）
type OpenOrders = { open_count: number; open_requests: number; open_work_orders: number; open_transfer_id: string | null };
const deleting = ref<Asset | null>(null);
const deleteReason = ref("");
const deleteError = ref("");
const deleteBusy = ref(false);
const deleteOrders = ref<OpenOrders | null>(null);
async function askDelete(a: Asset) {
  deleting.value = a;
  deleteReason.value = "";
  deleteError.value = "";
  deleteOrders.value = null;
  deleteBusy.value = true;
  try {
    deleteOrders.value = (await api<{ data: OpenOrders }>(`general-affairs/equipment/${a.id}/open-orders`)).data;
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
    await api(`general-affairs/equipment/${deleting.value.id}`, { method: "DELETE", body: JSON.stringify({ reason: deleteReason.value.trim(), expected_updated_at: deleting.value.updated_at }) });
    notice.value = `已刪除設備「${deleting.value.name}」`;
    deleting.value = null;
    detail.value = null;
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "OPEN_ORDERS") deleteOrders.value = { open_count: e.data.open_count, open_requests: 0, open_work_orders: 0, open_transfer_id: null };
  } finally {
    deleteBusy.value = false;
  }
}
/** 有未結案單時的替代做法：改為報廢（報廢會自動作廢 QR；之後仍可由總務恢復）。 */
async function scrapInstead() {
  if (!deleting.value || deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api(`general-affairs/equipment/${deleting.value.id}`, { method: "PATCH", body: JSON.stringify({ status: "SCRAPPED", expected_updated_at: deleting.value.updated_at }) });
    notice.value = `已將設備「${deleting.value.name}」改為報廢（QR 標籤已作廢，需要時可恢復使用）`;
    deleting.value = null;
    detail.value = null;
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
  } finally {
    deleteBusy.value = false;
  }
}

// ------------------------------------------------------------------------------------------ 更正所屬門市（建檔錯誤用）
const correcting = ref<Asset | null>(null);
const toStoreId = ref("");
const toStoreName = ref("");
const correctReason = ref("");
const correctError = ref("");
const correctBusy = ref(false);
const correctOrders = ref<OpenOrders | null>(null);
async function askCorrect(a: Asset) {
  correcting.value = a;
  toStoreId.value = "";
  toStoreName.value = "";
  correctReason.value = "";
  correctError.value = "";
  correctOrders.value = null;
  correctBusy.value = true;
  try {
    correctOrders.value = (await api<{ data: OpenOrders }>(`general-affairs/equipment/${a.id}/open-orders`)).data;
  } catch (e) {
    correctError.value = (e as Error).message;
  } finally {
    correctBusy.value = false;
  }
}
async function confirmCorrect() {
  if (!correcting.value || correctBusy.value) return;
  if (!toStoreId.value) { correctError.value = "請選擇新的所屬門市"; return; }
  if (!correctReason.value.trim()) { correctError.value = "請輸入更正原因"; return; }
  correctBusy.value = true;
  correctError.value = "";
  try {
    await api(`general-affairs/equipment/${correcting.value.id}/correct-store`, {
      method: "POST", body: JSON.stringify({ to_store_id: toStoreId.value, reason: correctReason.value.trim(), expected_updated_at: correcting.value.updated_at }),
    });
    notice.value = `已更正設備「${correcting.value.name}」的所屬門市為 ${toStoreName.value}，並寫入異動紀錄`;
    correcting.value = null;
    detail.value = null;
    await load();
  } catch (e) {
    correctError.value = (e as Error).message;
  } finally {
    correctBusy.value = false;
  }
}

// ------------------------------------------------------------------------------------------ 恢復使用（Q8）
const restoring = ref<Asset | null>(null);
const restoreReason = ref("");
const restoreError = ref("");
const restoreBusy = ref(false);
const needsRestore = (a: Asset) => a.status === "SCRAPPED" || !!a.qr_token_revoked_at;
function askRestore(a: Asset) { restoring.value = a; restoreReason.value = ""; restoreError.value = ""; }
async function confirmRestore() {
  if (!restoring.value || restoreBusy.value) return;
  if (!restoreReason.value.trim()) { restoreError.value = "請輸入恢復原因"; return; }
  restoreBusy.value = true;
  restoreError.value = "";
  try {
    await api(`general-affairs/equipment/${restoring.value.id}/restore`, { method: "POST", body: JSON.stringify({ reason: restoreReason.value.trim(), expected_updated_at: restoring.value.updated_at }) });
    notice.value = `已恢復使用設備「${restoring.value.name}」，原 QR 標籤可以繼續使用`;
    restoring.value = null;
    detail.value = null;
    await load();
  } catch (e) {
    restoreError.value = (e as Error).message;
  } finally {
    restoreBusy.value = false;
  }
}

const claimLabel = (v?: string) => WARRANTY_CLAIM_METHODS.find((m) => m.value === (v || ""))?.label || "未設定";
const where = (a: Asset) => [a.area, a.location_detail].filter(Boolean).join(" / ") || "—";
const emptyText = computed(() => (error.value ? "資料載入失敗" : search.value.trim() || storeId.value || categoryId.value || status.value || warranty.value || onboarding.value ? "找不到符合的設備" : "還沒有設備"));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 設備管理</p>
      <h1>設備清冊</h1>
      <p class="muted">用關鍵字搜尋（名稱、資產編號、品牌、型號、序號）或依分類、狀態、保固、貼標進度篩選。{{ seeFull ? "" : "店長身分只顯示自己門市設備的基本資料（名稱、位置、狀態、保固）。" }}</p>
    </div>
    <button v-if="canManage" class="primary" @click="openGaPage('ga-equipment-create')">新增設備</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '設備管理', '設備清冊']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <ul class="stat-cards" aria-label="設備統計">
      <li><span>符合條件的設備</span><strong>{{ stats.total }}</strong></li>
      <li><span>需留意狀態（暫停、退役、報廢）</span><strong>{{ stats.attention }}</strong></li>
      <li><span>保固需確認</span><strong>{{ stats.warrantyAttention }}</strong></li>
    </ul>
    <div class="filter-bar">
      <label class="grow">搜尋<input v-model="search" type="search" placeholder="名稱、資產編號、品牌、型號、序號（可含逗號、括號）" /></label>
      <div v-if="seeFull" class="filter-pick"><AssetSitePicker v-model="storeId" label="門市" /></div>
      <div class="filter-pick"><AssetCategoryPicker v-model="categoryId" type="equipment" label="分類" /></div>
      <label>狀態<select v-model="status"><option value="">全部</option><option v-for="(label, value) in EQUIPMENT_STATUS_LABEL" :key="value" :value="value">{{ label }}</option></select></label>
      <label>保固<select v-model="warranty"><option v-for="o in WARRANTY_FILTER_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option></select></label>
      <label>貼標進度<select v-model="onboarding"><option value="">全部</option><option v-for="s in ONBOARDING_STATUSES" :key="s" :value="s">{{ ONBOARDING_LABEL[s].equipment }}</option></select></label>
    </div>
    <div class="list-meta"><span>共 {{ total }} 筆</span><span v-if="loading" role="status">載入中…</span></div>

    <div class="table-scroll asset-table">
      <table>
        <thead><tr><th>設備</th><th>門市</th><th>位置</th><th>狀態</th><th>保固</th><th>貼標進度</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td class="who"><img v-if="a.thumbnail_url" :src="a.thumbnail_url" alt="" /><span class="who-text"><strong>{{ a.name }}</strong><small>{{ a.asset_code || "尚無資產編號" }}<template v-if="seeFull && (a.brand || a.model)"> · {{ [a.brand, a.model].filter(Boolean).join(" ") }}</template></small></span></td>
            <td>{{ storeLabel(a.store) }}</td>
            <td>{{ where(a) }}</td>
            <td><span class="state-text" :class="{ done: a.status === 'ACTIVE' }">{{ EQUIPMENT_STATUS_LABEL[a.status] || a.status }}</span></td>
            <td><span class="tag" :class="'tone-' + a.warranty.tone">{{ a.warranty.label }}</span></td>
            <td><span class="muted">{{ ONBOARDING_LABEL[a.onboarding_status as keyof typeof ONBOARDING_LABEL]?.equipment || a.onboarding_status }}</span></td>
            <td><button type="button" class="row-btn" @click="openDetail(a)">查看</button></td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">{{ emptyText }}</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="asset-cards" aria-label="設備清單">
      <li v-for="a in rows" :key="a.id" class="asset-card">
        <div class="card-top">
          <img v-if="a.thumbnail_url" :src="a.thumbnail_url" alt="" />
          <div class="card-title"><strong>{{ a.name }}</strong><small>{{ a.asset_code || "尚無資產編號" }}</small><small>{{ storeLabel(a.store) }} · {{ where(a) }}</small></div>
        </div>
        <div class="card-tags"><span class="state-text" :class="{ done: a.status === 'ACTIVE' }">{{ EQUIPMENT_STATUS_LABEL[a.status] || a.status }}</span><span class="tag" :class="'tone-' + a.warranty.tone">{{ a.warranty.label }}</span></div>
        <button type="button" class="card-btn" :aria-label="`查看 ${a.name}`" @click="openDetail(a)">查看詳情</button>
      </li>
      <li v-if="!rows.length && !loading" class="empty">{{ emptyText }}</li>
    </ul>
    <footer class="pagination">
      <span>第 {{ page }} / {{ pages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="page--">上一頁</button>
      <button :disabled="page >= pages || loading" @click="page++">下一頁</button>
    </footer>

    <!-- 詳情／編輯 -->
    <Modal v-if="detail" :title="mode === 'edit' ? '編輯設備' : '設備詳情'" wide :busy="saving" @cancel="closeDetail">
      <p v-if="detailBusy" class="muted" role="status">載入中…</p>
      <p v-if="detailError" class="notice error" role="alert">{{ detailError }}</p>
      <template v-if="mode === 'view'">
        <h3 class="d-name">{{ detail.name }}</h3>
        <p v-for="w in detailWarnings" :key="w.code" class="notice" role="status">{{ w.message }}</p>
        <p v-if="detail.open_transfer" class="notice" role="status">這台設備有進行中的轉移單 {{ detail.open_transfer.transfer_no }}（{{ detail.open_transfer.status === "PENDING_HANDOVER" ? "等轉出門市確認交出" : "等轉入門市確認收到" }}）。</p>
        <p v-if="needsRestore(detail)" class="notice" role="status">這台設備已報廢，QR 標籤目前作廢（掃描會顯示說明）。{{ canManage ? "若是誤操作，可以「恢復使用並重新啟用 QR」，原標籤會繼續可用。" : "如需恢復請洽總務。" }}</p>
        <dl class="info">
          <div><dt>所屬門市</dt><dd>{{ storeLabel(detail.store) }}</dd></div>
          <div><dt>狀態</dt><dd>{{ EQUIPMENT_STATUS_LABEL[detail.status] || detail.status }}</dd></div>
          <div><dt>資產編號</dt><dd>{{ detail.asset_code || "尚無" }}</dd></div>
          <div><dt>位置</dt><dd>{{ where(detail) }}</dd></div>
          <div><dt>分類</dt><dd>{{ detail.category?.name || "—" }}</dd></div>
          <div><dt>保固</dt><dd><span class="tag" :class="'tone-' + detail.warranty.tone">{{ detail.warranty.label }}</span><template v-if="detail.warranty.end_date"> 到期日 {{ detail.warranty.end_date }}</template></dd></div>
          <template v-if="seeFull">
            <div><dt>品牌／型號</dt><dd>{{ [detail.brand, detail.model].filter(Boolean).join(" / ") || "—" }}</dd></div>
            <div><dt>序號／條碼</dt><dd>{{ [detail.serial_number, detail.barcode].filter(Boolean).join(" / ") || "—" }}</dd></div>
            <div><dt>重要程度</dt><dd>{{ CRITICALITY_LABEL[detail.criticality] || detail.criticality }}</dd></div>
            <div><dt>用途</dt><dd>{{ detail.purpose || "—" }}</dd></div>
            <div><dt>購買日期／安裝日期</dt><dd>{{ formatDate(detail.purchased_at) }} / {{ formatDate(detail.installed_at) }}</dd></div>
            <div><dt>購買金額</dt><dd>{{ formatMoney(detail.purchase_amount) }}</dd></div>
            <div><dt>購買來源／供應商</dt><dd>{{ detail.specs?.purchase_source_supplier || "—" }}</dd></div>
            <div><dt>申請保固方式</dt><dd>{{ claimLabel(detail.specs?.warranty_claim_method) }}<template v-if="detail.specs?.warranty_claim_notes">（{{ detail.specs.warranty_claim_notes }}）</template></dd></div>
            <div><dt>型號（公司設備）</dt><dd>{{ detail.template?.name || "未歸戶" }}</dd></div>
            <div class="wide"><dt>備註</dt><dd>{{ detail.notes || "—" }}</dd></div>
          </template>
        </dl>
        <div class="onb-box"><AssetOnboardingBar :status="detail.onboarding_status" />
          <p v-if="detail.onboarding_review_note" class="muted">總務複核說明：{{ detail.onboarding_review_note }}</p></div>
        <ResourceAttachmentPanel v-if="seeFull" class="equip-attachments" resource-type="EQUIPMENT" :resource-id="detail.id" title="設備照片與文件" :can-upload="canManage" :can-delete="canManage" />
        <section v-if="seeFull" class="events">
          <button v-if="events === null" type="button" @click="loadEvents">查看異動紀錄</button>
          <template v-else>
            <h4>異動紀錄</h4>
            <p v-if="!events.length" class="muted">還沒有異動紀錄。</p>
            <ul v-else class="event-list"><li v-for="e in events" :key="e.id"><strong>{{ EVENT_LABEL[e.event_type] || e.event_type }}</strong> {{ formatDate(e.created_at) }} · {{ e.actor_name || "—" }}<template v-if="e.from_store_name || e.to_store_name"> · {{ e.from_store_name }} → {{ e.to_store_name }}</template><template v-if="e.reason">　原因：{{ e.reason }}</template><template v-if="e.open_request_count">　（當時還有 {{ e.open_request_count }} 張未結案單）</template></li></ul>
          </template>
          <p v-if="eventsError" class="field-error" role="alert">{{ eventsError }}</p>
        </section>
        <div class="dialog-actions">
          <template v-if="canManage">
            <button type="button" class="danger" :disabled="detailBusy" @click="askDelete(detail)">刪除</button>
            <button type="button" :disabled="detailBusy" @click="askCorrect(detail)">更正所屬門市</button>
            <button v-if="needsRestore(detail)" type="button" :disabled="detailBusy" @click="askRestore(detail)">恢復使用並重新啟用 QR</button>
            <button type="button" class="primary" :disabled="detailBusy" @click="startEdit">編輯</button>
          </template>
          <button type="button" @click="closeDetail">關閉</button>
        </div>
      </template>
      <form v-else @submit.prevent="save">
        <p class="notice" role="note">所屬門市（{{ storeLabel(detail.store) }}）不能在這裡修改：平常換店請發起「轉移單」，建檔選錯門市請用「更正所屬門市」。只會送出你有改的欄位。</p>
        <EquipmentFormFields v-model="form" mode="edit" :disabled="saving" :errors="errors" />
        <p v-if="discardAsk" class="notice" role="alertdialog" aria-label="放棄未儲存的修改">有尚未儲存的修改。要放棄這些修改嗎？
          <button type="button" class="danger" @click="discardAsk = false; mode = 'view'">放棄修改</button>
          <button type="button" @click="discardAsk = false">繼續編輯</button></p>
        <div class="dialog-actions">
          <button type="button" :disabled="saving" @click="cancelEdit">取消</button>
          <button type="submit" class="primary" :disabled="saving">{{ saving ? "儲存中…" : "儲存" }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="deleting" title="刪除設備" :busy="deleteBusy" @cancel="deleting = null">
      <p><strong>{{ deleting.name }}</strong>（{{ deleting.asset_code || "尚無資產編號" }}）</p>
      <p v-if="deleteBusy && !deleteOrders" class="muted" role="status">檢查未結案單中…</p>
      <p v-if="deleteOrders && deleteOrders.open_count > 0" class="notice error" role="alert">還有 {{ deleteOrders.open_count }} 張未結案單，不能刪除（可改為「報廢」）。</p>
      <p v-else-if="deleteOrders?.open_transfer_id" class="notice error" role="alert">這台設備有進行中的轉移單，請先完成或取消轉移單再刪除。</p>
      <template v-else-if="deleteOrders">
        <p class="muted">刪除後這台設備不會再出現在清冊，QR 標籤同時作廢，也不能還原。請填寫刪除原因。</p>
        <label>刪除原因<input v-model="deleteReason" maxlength="200" aria-label="刪除原因" /></label>
      </template>
      <p v-if="deleteError" class="field-error" role="alert">{{ deleteError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="deleteBusy" @click="deleting = null">{{ deleteOrders && (deleteOrders.open_count > 0 || deleteOrders.open_transfer_id) ? "關閉" : "取消" }}</button>
        <button v-if="deleteOrders && deleteOrders.open_count > 0" type="button" :disabled="deleteBusy" @click="scrapInstead">改為報廢</button>
        <button v-else-if="deleteOrders && !deleteOrders.open_transfer_id" type="button" class="primary danger" :disabled="deleteBusy" @click="confirmDelete">{{ deleteBusy ? "處理中…" : "確認刪除" }}</button>
      </div>
    </Modal>

    <Modal v-if="correcting" title="更正所屬門市（建檔錯誤用）" :busy="correctBusy" @cancel="correcting = null">
      <p class="muted">只用在「建檔時選錯門市」。設備真的搬到別的門市，請發起轉移單。這次更正會寫入異動紀錄。</p>
      <p><strong>{{ correcting.name }}</strong>　目前所屬：{{ storeLabel(correcting.store) }}</p>
      <p v-if="correctBusy && !correctOrders" class="muted" role="status">檢查未結案單中…</p>
      <p v-if="correctOrders?.open_transfer_id" class="notice error" role="alert">這台設備有進行中的轉移單，請先完成或取消轉移單再更正。</p>
      <template v-else>
        <AssetSitePicker v-model="toStoreId" label="更正為" required @select="(s) => (toStoreName = s ? `${s.store_code} ${s.short_name || s.store_name}` : '')" />
        <p v-if="toStoreId" class="notice" role="status">{{ storeLabel(correcting.store) }} → {{ toStoreName }}。目前還有 {{ correctOrders?.open_count ?? 0 }} 張未結案單<template v-if="correctOrders?.open_count">，這些單子仍屬原門市</template>。</p>
        <label>更正原因（必填）<input v-model="correctReason" maxlength="200" aria-label="更正原因" /></label>
      </template>
      <p v-if="correctError" class="field-error" role="alert">{{ correctError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="correctBusy" @click="correcting = null">取消</button>
        <button v-if="!correctOrders?.open_transfer_id" type="button" class="primary" :disabled="correctBusy" @click="confirmCorrect">{{ correctBusy ? "處理中…" : "確認更正" }}</button>
      </div>
    </Modal>

    <Modal v-if="restoring" title="恢復使用並重新啟用 QR" :busy="restoreBusy" @cancel="restoring = null">
      <p><strong>{{ restoring.name }}</strong>（{{ restoring.asset_code || "尚無資產編號" }}）</p>
      <p class="muted">狀態會改回「使用中」，原本貼在設備上的 QR 標籤可以繼續使用（網址不變）。這次操作會寫入異動紀錄。</p>
      <label>恢復原因（必填）<input v-model="restoreReason" maxlength="200" aria-label="恢復原因" /></label>
      <p v-if="restoreError" class="field-error" role="alert">{{ restoreError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="restoreBusy" @click="restoring = null">取消</button>
        <button type="button" class="primary" :disabled="restoreBusy" @click="confirmRestore">{{ restoreBusy ? "處理中…" : "確認恢復" }}</button>
      </div>
    </Modal>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.stat-cards span { font-size: 12px; color: var(--muted); }
.stat-cards strong { font-size: 22px; }
.filter-pick { min-width: 220px; flex: 1; }
.who { display: flex; align-items: center; gap: 10px; }
.who img { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; }
.who-text { display: grid; min-width: 0; }
.who-text small, .card-title small { color: var(--muted); display: block; }
.row-btn { min-height: 30px; padding: 3px 12px; font-size: 12px; }
.tag { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
.tone-green { background: var(--soft); color: var(--primary); }
.tone-amber { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
.tone-red { background: #fde3df; color: var(--danger); border-color: #f0b6ae; }
.tone-slate { color: var(--muted); }
:root[data-theme="dark"] .tone-amber { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
:root[data-theme="dark"] .tone-red { background: #4d2420; color: #ffb4a9; border-color: #7a3a33; }
.d-name { margin: 0 0 8px; }
.info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; margin: 12px 0; }
.info div { display: grid; gap: 2px; min-width: 0; }
.info .wide { grid-column: 1 / -1; }
.info dt { font-size: 12px; color: var(--muted); }
.info dd { margin: 0; overflow-wrap: anywhere; }
.onb-box { margin: 12px 0; padding: 12px; border: 1px solid var(--line); border-radius: 6px; }
.equip-attachments { margin-top: 14px; }
.events { margin-top: 14px; }
.event-list { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; }
.asset-cards { display: none; list-style: none; margin: 0; padding: 0; gap: 12px; }
.asset-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 12px; display: grid; gap: 10px; }
.card-top { display: flex; gap: 10px; align-items: center; min-width: 0; }
.card-top img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; flex: none; }
.card-title { min-width: 0; display: grid; gap: 2px; overflow-wrap: anywhere; }
.card-tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.card-btn { min-height: 44px; width: 100%; font-weight: 600; }
.empty { text-align: center; color: var(--muted); padding: 20px; }
@media (max-width: 700px) {
  .asset-table { display: none; }
  .asset-cards { display: grid; }
  .stat-cards { grid-template-columns: 1fr; }
  .info { grid-template-columns: 1fr; }
  .filter-pick { min-width: 0; flex-basis: 100%; }
}
</style>
