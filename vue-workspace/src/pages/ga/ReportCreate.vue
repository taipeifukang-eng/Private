<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import ResourceAttachmentPanel from "../../components/ga/ResourceAttachmentPanel.vue";
import { openGaPage, useDebounced, useGaGuard } from "../../lib/ga";
import { newKey } from "../../lib/ga-requests";
import { RESOURCE_LABEL } from "../../../../lib/workspace/general-affairs/request-rules";
import { useSession, type WorkTab } from "../../stores";

// G14 新增需求（維修回報、添購補充）。支援 QR 掃描帶入（tab.payload.assetToken，沿用舊版 assetToken 參數）：帶入設備或設施與門市，類型固定為維修。
// 送出用固定識別防連點重複建立；建立後可立刻補傳照片。只能替自己管理的門市建立（總務、門市管理、員工管理權限者可替任何門市）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const session = useSession();

type Store = { id: string; store_code: string; store_name: string; short_name: string | null };
type Target = { id: string; kind: "EQUIPMENT" | "FACILITY"; name: string; code: string | null; sub: string };
const stores = ref<Store[]>([]);
const loadingStores = ref(true);
const type = ref<"REPAIR" | "PURCHASE_SUPPLEMENT">("REPAIR");
const f = reactive({
  storeId: "", repairKind: "EQUIPMENT" as "EQUIPMENT" | "FACILITY" | "UNKNOWN", targetId: "", resourceType: "PART", partId: "", title: "", description: "", impact: "", workaround: "",
  contactName: "", contactPhone: "", quantity: "", unit: "", spec: "",
});
const targets = ref<Target[]>([]);
const targetSearch = ref("");
const debouncedTarget = useDebounced(targetSearch, 300);
const partSearch = ref("");
const debouncedPart = useDebounced(partSearch, 300);
const parts = ref<Array<{ id: string; name: string; part_code: string | null; base_unit: string }>>([]);
const pickedPartLabel = ref("");
const prefillNote = ref("");
const prefillLabel = ref("");
const busy = ref(false);
const error = ref("");
const fieldErrors = reactive<Record<string, string>>({});
const created = ref<{ id: string; request_no: string } | null>(null);
let key = newKey();

const anyStore = computed(() => !!session.data?.capabilities?.gaRequests);

async function loadStores() {
  loadingStores.value = true;
  try {
    const res = await api<{ data: Store[] }>(`general-affairs/sites?type=store&scope=${anyStore.value ? "all" : "mine"}&pageSize=100`);
    stores.value = res.data;
    if (!f.storeId && stores.value.length === 1) f.storeId = stores.value[0].id;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingStores.value = false;
  }
}
async function loadTargets() {
  targets.value = [];
  if (!f.storeId || type.value !== "REPAIR" || f.repairKind === "UNKNOWN") return;
  try {
    const q = new URLSearchParams({ storeId: f.storeId });
    if (debouncedTarget.value.trim()) q.set("search", debouncedTarget.value.trim());
    const res = await api<{ equipment: any[]; facilities: any[] }>("general-affairs/request-targets?" + q);
    targets.value = f.repairKind === "EQUIPMENT"
      ? res.equipment.map((x) => ({ id: x.id, kind: "EQUIPMENT" as const, name: x.name, code: x.asset_code, sub: [x.brand, x.model, x.area, x.location_detail].filter(Boolean).join(" / ") }))
      : res.facilities.map((x) => ({ id: x.id, kind: "FACILITY" as const, name: x.name, code: x.facility_code, sub: [x.area, x.location_detail].filter(Boolean).join(" / ") }));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadParts() {
  if (type.value !== "PURCHASE_SUPPLEMENT" || f.resourceType !== "PART") return;
  try {
    const q = new URLSearchParams({ isActive: "true", pageSize: "20" });
    if (debouncedPart.value.trim()) q.set("search", debouncedPart.value.trim());
    const res = await api<{ data: any[] }>("general-affairs/parts?" + q);
    parts.value = res.data;
  } catch {
    parts.value = [];
  }
}
watch([() => f.storeId, () => f.repairKind, type, debouncedTarget], () => void loadTargets());
watch([debouncedPart, type, () => f.resourceType], () => void loadParts());
watch(type, () => { error.value = ""; Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k]); });

// QR 掃描帶入（assetToken）：設備或設施 + 門市，類型固定維修。
async function applyAssetToken() {
  const token = String((props.tab.payload as { assetToken?: string } | undefined)?.assetToken || "").trim();
  if (!token) return;
  props.tab.payload = {};
  type.value = "REPAIR";
  prefillNote.value = "正在讀取 QR Code 維修標的…";
  try {
    const res = await api<{ data: any }>(`general-affairs/assets/scan/${encodeURIComponent(token)}`);
    const d = res.data;
    if (d.type !== "EQUIPMENT" && d.type !== "FACILITY") throw new Error("QR Code 對應的標的不是設備或設施");
    if (!d.id || !d.store?.id) throw new Error("QR Code 標的缺少門市或資產資料，請回設備主檔確認");
    if (!stores.value.some((s) => s.id === d.store.id)) stores.value = [...stores.value, { id: d.store.id, store_code: d.store.store_code || "", store_name: d.store.store_name || d.store.short_name || "", short_name: d.store.short_name || null }];
    f.storeId = d.store.id;
    f.repairKind = d.type;
    f.targetId = d.id;
    prefillLabel.value = [d.code, d.name].filter(Boolean).join(" - ");
    if (!f.title) f.title = `${d.name || "設備/設施"} 維修回報`;
    prefillNote.value = "已由 QR Code 帶入維修標的。";
    await loadTargets();
    if (!targets.value.some((t) => t.id === d.id)) targets.value = [{ id: d.id, kind: d.type, name: d.name, code: d.code, sub: "" }, ...targets.value];
  } catch (e) {
    prefillNote.value = "";
    error.value = (e as Error).message;
  }
}
onMounted(async () => { await loadStores(); await applyAssetToken(); });
watch(() => (props.tab.payload as { assetToken?: string } | undefined)?.assetToken, (v) => { if (v) void applyAssetToken(); });

function validate() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k]);
  if (!f.storeId) fieldErrors.store = "請選擇門市";
  if (!f.title.trim()) fieldErrors.title = "請填寫需求標題";
  if (f.description.trim().length < 5) fieldErrors.description = "請填寫較完整的需求說明（至少 5 個字）";
  if (type.value === "PURCHASE_SUPPLEMENT") {
    if (!(Number(f.quantity) > 0)) fieldErrors.quantity = "請填寫希望數量（大於 0）";
    if (f.resourceType === "PART" && !f.partId) fieldErrors.part = "請選擇要補充的料件";
  } else if (f.repairKind !== "UNKNOWN" && !f.targetId) {
    fieldErrors.target = "請選擇設備或設施；不確定可選「我不確定，讓總務判斷」";
  }
  return !Object.keys(fieldErrors).length;
}
async function submit() {
  if (busy.value || created.value) return;
  error.value = "";
  if (!validate()) return;
  busy.value = true;
  try {
    const repair = type.value === "REPAIR";
    const payload: Record<string, unknown> = {
      store_id: f.storeId, request_type: type.value, title: f.title.trim(), description: f.description.trim(), impact_description: f.impact.trim() || undefined,
      temporary_workaround: f.workaround.trim() || undefined, contact_name: f.contactName.trim() || undefined, contact_phone: f.contactPhone.trim() || undefined, idempotency_key: key,
    };
    if (repair) {
      if (f.repairKind !== "UNKNOWN") { payload.resource_type = f.repairKind; payload[f.repairKind === "EQUIPMENT" ? "equipment_id" : "facility_id"] = f.targetId; }
    } else {
      payload.resource_type = f.resourceType;
      payload.desired_quantity = Number(f.quantity);
      payload.desired_unit = f.unit.trim() || undefined;
      payload.desired_spec = f.spec.trim() || undefined;
      if (f.resourceType === "PART") payload.part_id = f.partId;
    }
    const res = await api<{ data: { id: string; request_no: string } }>("general-affairs/reports", { method: "POST", body: JSON.stringify(payload) });
    created.value = res.data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function another() {
  created.value = null;
  key = newKey();
  Object.assign(f, { targetId: "", partId: "", title: "", description: "", impact: "", workaround: "", quantity: "", unit: "", spec: "" });
  prefillNote.value = "";
  prefillLabel.value = "";
}
const PURCHASE_RESOURCES = ["PART", "GENERAL_SUPPLY", "OTHER_PURCHASE"] as const;
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 門市追蹤</p>
      <h1>新增需求</h1>
      <p class="muted">門市遇到設備、設施故障請選「維修回報」；需要補充料件或耗材請選「添購／補充」。送出後可在「我的追蹤」看進度。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '門市追蹤', '新增需求']">
    <section v-if="created" class="done" data-testid="create-done">
      <p class="notice success" role="status">需求已送出，單號 <strong data-testid="created-no">{{ created.request_no }}</strong>。可以現在補傳現場照片。</p>
      <ResourceAttachmentPanel resource-type="SERVICE_REQUEST" :resource-id="created.id" title="現場照片" />
      <div class="actions"><button type="button" class="primary" data-testid="go-mine" @click="openGaPage('ga-my-reports')">到我的追蹤</button><button type="button" data-testid="create-another" @click="another">再新增一筆</button></div>
    </section>
    <form v-else class="form" novalidate data-testid="report-form" @submit.prevent="submit">
      <p v-if="prefillNote" class="notice" role="status" data-testid="prefill-note">{{ prefillNote }}</p>
      <p v-if="error" class="notice error" role="alert" data-testid="create-error">{{ error }}</p>
      <fieldset class="kinds">
        <legend>需求類型</legend>
        <label class="kind"><input v-model="type" type="radio" value="REPAIR" name="rtype" data-testid="type-repair" /><span><strong>維修／現場狀況回報</strong><small>設備故障、設施或環境問題</small></span></label>
        <label class="kind"><input v-model="type" type="radio" value="PURCHASE_SUPPLEMENT" name="rtype" data-testid="type-purchase" /><span><strong>庶務／料件添購補充</strong><small>缺少料件、耗材或想添購</small></span></label>
      </fieldset>
      <label>門市
        <select v-model="f.storeId" :disabled="loadingStores" aria-label="門市" data-testid="f-store"><option value="">{{ loadingStores ? "載入中…" : "請選擇門市" }}</option><option v-for="s in stores" :key="s.id" :value="s.id">{{ s.short_name || s.store_name }}（{{ s.store_code }}）</option></select>
        <small v-if="fieldErrors.store" class="field-error" role="alert">{{ fieldErrors.store }}</small>
        <small v-if="!loadingStores && !stores.length" class="field-error" role="alert" data-testid="no-store">您目前沒有可建立需求的門市（只能替自己管理的門市建立）。</small>
      </label>

      <template v-if="type === 'REPAIR'">
        <label>壞的是什麼
          <select v-model="f.repairKind" aria-label="標的類型" data-testid="f-kind" @change="f.targetId = ''"><option value="EQUIPMENT">設備</option><option value="FACILITY">店內設施／環境</option><option value="UNKNOWN">我不確定，讓總務判斷</option></select>
        </label>
        <div v-if="f.repairKind !== 'UNKNOWN'" class="grp">
          <label>搜尋標的<input v-model="targetSearch" type="search" placeholder="名稱、資產編號、品牌、型號" data-testid="f-target-search" /></label>
          <p v-if="prefillLabel" class="muted" data-testid="prefill-label">QR 帶入：{{ prefillLabel }}</p>
          <label>標的
            <select v-model="f.targetId" aria-label="標的" data-testid="f-target"><option value="">{{ f.storeId ? "請選擇" : "請先選擇門市" }}</option><option v-for="t in targets" :key="t.id" :value="t.id">{{ t.code ? t.code + " - " : "" }}{{ t.name }}{{ t.sub ? "（" + t.sub + "）" : "" }}</option></select>
            <small v-if="fieldErrors.target" class="field-error" role="alert">{{ fieldErrors.target }}</small>
          </label>
        </div>
      </template>
      <template v-else>
        <label>要補充的是
          <select v-model="f.resourceType" aria-label="補充類型" data-testid="f-resource"><option v-for="r in PURCHASE_RESOURCES" :key="r" :value="r">{{ RESOURCE_LABEL[r] }}</option></select>
        </label>
        <div v-if="f.resourceType === 'PART'" class="grp">
          <label>搜尋料件<input v-model="partSearch" type="search" placeholder="名稱、料號、品牌" data-testid="f-part-search" /></label>
          <label>料件
            <select v-model="f.partId" aria-label="料件" data-testid="f-part" @change="pickedPartLabel = parts.find((p) => p.id === f.partId)?.name || ''; if (!f.unit) f.unit = parts.find((p) => p.id === f.partId)?.base_unit || ''"><option value="">請選擇料件</option><option v-for="p in parts" :key="p.id" :value="p.id">{{ p.name }}{{ p.part_code ? "（" + p.part_code + "）" : "" }}</option></select>
            <small v-if="fieldErrors.part" class="field-error" role="alert">{{ fieldErrors.part }}</small>
          </label>
        </div>
        <div class="row">
          <label>希望數量<input v-model="f.quantity" inputmode="decimal" data-testid="f-qty" /><small v-if="fieldErrors.quantity" class="field-error" role="alert">{{ fieldErrors.quantity }}</small></label>
          <label>單位<input v-model="f.unit" maxlength="20" placeholder="個、箱、組" data-testid="f-unit" /></label>
        </div>
        <label>規格說明（選填）<textarea v-model="f.spec" rows="2" maxlength="1000" placeholder="尺寸、品牌、參考用途；最終規格由總務決定。" /></label>
      </template>

      <label>需求標題<input v-model="f.title" maxlength="120" placeholder="例：櫃台上方漏水" data-testid="f-title" /><small v-if="fieldErrors.title" class="field-error" role="alert">{{ fieldErrors.title }}</small></label>
      <label>詳細說明<textarea v-model="f.description" rows="4" maxlength="2000" placeholder="發生什麼事、從什麼時候開始" data-testid="f-description" /><small v-if="fieldErrors.description" class="field-error" role="alert">{{ fieldErrors.description }}</small></label>
      <label>對營運的影響（選填）<textarea v-model="f.impact" rows="2" maxlength="1000" /></label>
      <label v-if="type === 'REPAIR'">暫時的處理方式（選填）<textarea v-model="f.workaround" rows="2" maxlength="1000" /></label>
      <div class="row">
        <label>聯絡人（選填）<input v-model="f.contactName" maxlength="80" /></label>
        <label>聯絡電話（選填）<input v-model="f.contactPhone" maxlength="40" inputmode="tel" /></label>
      </div>
      <div class="actions"><button type="submit" class="primary" :disabled="busy || loadingStores" data-testid="create-submit">{{ busy ? "送出中…" : "送出需求" }}</button></div>
    </form>
  </GaShell>
</template>

<style scoped>
.form, .done { display: grid; gap: 14px; max-width: 760px; min-width: 0; }
.form label { display: grid; gap: 4px; min-width: 0; }
.kinds { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; display: grid; gap: 8px; }
.kind { display: flex !important; gap: 10px; align-items: flex-start; }
.kind span { display: grid; }
.kind small { color: var(--muted); }
.grp { display: grid; gap: 10px; border-left: 3px solid var(--line); padding-left: 12px; }
.row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
@media (max-width: 700px) {
  .row { grid-template-columns: minmax(0, 1fr); }
  .actions button { min-height: 44px; flex: 1; }
}
</style>
