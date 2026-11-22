<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import InventoryPicker from "./InventoryPicker.vue";
import { openGaPage } from "../../lib/ga";
import { fmtNum, newKey } from "../../lib/ga-inventory-stock";
import { SHIPPING_METHODS, validateCreatePayload } from "../../../../lib/workspace/general-affairs/inventory-transfer-rules";

// G13 建調撥單：一張單一個料件（Q13）。目的位置沒設定這個料件就不能建單，並附「前往位置設定」捷徑（C8）；來源庫存不足只警告仍可建（Q14）。
// 每次送出帶固定識別（內容不變就是同一張，連點只會建一張）；網址帶入的內容由伺服端驗證，沒帶進來的欄位列在「未能帶入」。
type Prefill = { values: Record<string, any>; unresolved: { field: string; label: string; reason: string }[]; notices: string[]; shown: Record<string, any>; request: { id: string; request_no: string } | null } | null;
const props = defineProps<{ prefill?: Prefill; problem: string }>();
const emit = defineEmits<{ close: []; created: [any] }>();

const v = props.prefill?.values || {};
const sourceId = ref<string>(v.source_location_id || "");
const destId = ref<string>(v.destination_location_id || "");
const partId = ref<string>(v.part_id || "");
const partItem = ref<any | null>(props.prefill?.shown?.part || null);
const quantity = ref<string>(v.quantity ? String(v.quantity) : "");
const unit = ref<"BASE" | "PURCHASE">(v.input_unit_type === "PURCHASE" ? "PURCHASE" : "BASE");
const reason = ref<string>(v.reason || "");
const notes = ref<string>(v.notes || "");
const shipping = ref("");
const requestId = ref<string | null>(v.request_id || null);
const requestNo = ref<string | null>(v.request_no || props.prefill?.request?.request_no || null);
const key = ref(newKey());
const busy = ref(false);
const error = ref("");
const errorCode = ref("");
const fieldErrors = ref<Record<string, string>>({});
const result = ref<any | null>(null);

const part = computed(() => partItem.value?.part || null);
const destMissing = computed(() => !!partItem.value && !!destId.value && partItem.value.destination_configured === false);
const baseQty = computed(() => {
  const n = Number(quantity.value);
  if (!Number.isFinite(n) || n <= 0 || !part.value) return null;
  return unit.value === "PURCHASE" ? n * Number(part.value.purchase_to_base_rate || 0) : n;
});
const lowStock = computed(() => !!partItem.value && baseQty.value !== null && Number(partItem.value.source_balance) < baseQty.value);
const canPurchase = computed(() => !!part.value?.purchase_unit && Number(part.value?.purchase_to_base_rate) > 0);

watch([sourceId, destId, partId, quantity, unit, reason, notes, shipping], () => { key.value = newKey(); });
watch(partId, () => { if (!partId.value) partItem.value = null; });
watch(canPurchase, (ok) => { if (!ok) unit.value = "BASE"; });

function gotoLocations() {
  openGaPage("ga-inventory-locations");
  emit("close");
}
async function submit() {
  if (busy.value) return;
  fieldErrors.value = {};
  error.value = "";
  errorCode.value = "";
  if (props.problem) { error.value = props.problem; return; }
  if (!sourceId.value) { fieldErrors.value.source = "請選擇來源位置"; return; }
  if (!destId.value) { fieldErrors.value.dest = "請選擇目的位置"; return; }
  if (!partId.value) { fieldErrors.value.part = "請選擇料件"; return; }
  if (destMissing.value) { error.value = "目的位置還沒有設定這個料件，不能建立調撥單。"; errorCode.value = "DESTINATION_PART_NOT_CONFIGURED"; return; }
  let payload;
  try {
    payload = validateCreatePayload({
      source_location_id: sourceId.value, destination_location_id: destId.value, part_id: partId.value, quantity: quantity.value, input_unit_type: unit.value,
      reason: reason.value, notes: notes.value, shipping_method: shipping.value, request_id: requestId.value, idempotency_key: key.value,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/數量/.test(msg)) fieldErrors.value.quantity = msg;
    else if (/原因/.test(msg)) fieldErrors.value.reason = msg;
    else error.value = msg;
    return;
  }
  busy.value = true;
  try {
    const res = await api<{ data: any; replay: boolean; warnings: any[] }>("general-affairs/inventory/transfers", { method: "POST", body: JSON.stringify(payload) });
    result.value = { ...res.data, replay: res.replay, warnings: res.warnings || [] };
    emit("created", res.data);
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError) {
      errorCode.value = e.data?.code || "";
      if (e.data?.code === "IDEMPOTENCY_CONFLICT") key.value = newKey();
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="建立調撥單" wide :busy="busy" @cancel="emit('close')">
    <div v-if="result" class="create-result" role="status" data-testid="create-result">
      <p v-if="result.replay" class="notice" data-testid="create-replay">這張調撥單已經建立過了（重複送出），沒有再建立一張。</p>
      <p v-else class="notice success">調撥單已建立，等待來源確認交出。收貨之前目的位置的庫存不會增加。</p>
      <p><strong data-testid="created-no">{{ result.transfer_no }}</strong></p>
      <p v-for="w in result.warnings" :key="w.code" class="notice" role="alert" data-testid="create-warning">{{ w.message }}</p>
      <div class="dialog-actions"><button type="button" class="primary" @click="emit('close')">關閉</button></div>
    </div>
    <form v-else class="tr-form" novalidate @submit.prevent="submit">
      <p v-if="problem" class="notice error" role="alert" data-testid="create-problem">{{ problem }}</p>
      <p v-if="requestNo" class="notice" data-testid="create-request">這張調撥單會連結需求單 <strong>{{ requestNo }}</strong>，調撥數量不可超過需求單剩餘的需求量。</p>
      <div v-if="prefill?.unresolved?.length" class="notice error" role="alert" data-testid="prefill-unresolved">
        <strong>網址帶入的內容有幾項沒有帶進來，請自己確認：</strong>
        <ul><li v-for="u in prefill.unresolved" :key="u.field"><b>{{ u.label }}</b>：{{ u.reason }}</li></ul>
      </div>
      <p v-for="n in prefill?.notices || []" :key="n" class="notice" data-testid="prefill-notice">{{ n }}</p>
      <div class="grid">
        <div>
          <InventoryPicker v-model="sourceId" kind="transfer-locations" label="來源位置" required :disabled="busy || !!problem" :initial="prefill?.shown?.source" />
          <small v-if="fieldErrors.source" class="field-error">{{ fieldErrors.source }}</small>
        </div>
        <div>
          <InventoryPicker v-model="destId" kind="transfer-locations" label="目的位置" required :disabled="busy || !!problem" :initial="prefill?.shown?.destination" />
          <small v-if="fieldErrors.dest" class="field-error">{{ fieldErrors.dest }}</small>
        </div>
        <div class="wide">
          <InventoryPicker v-model="partId" kind="transfer-parts" label="料件" required :location-id="sourceId" :destination-id="destId" :disabled="busy || !!problem || !sourceId" placeholder="先選來源位置，再搜尋這個位置設定過的料件" :initial="partItem" @pick="partItem = $event" />
          <small v-if="fieldErrors.part" class="field-error">{{ fieldErrors.part }}</small>
        </div>
        <div v-if="destMissing" class="wide notice error" role="alert" data-testid="dest-missing">
          <strong>目的位置還沒有設定這個料件，收貨時會失敗，所以不能建立調撥單。</strong>
          <p class="muted">請先到「庫存位置」為目的位置加入這個料件的設定，再回來建單。</p>
          <button type="button" data-testid="goto-locations" @click="gotoLocations">前往位置設定</button>
        </div>
        <label>數量<input v-model="quantity" inputmode="decimal" :disabled="busy || !!problem" aria-label="調撥數量" placeholder="例如 12 或 0.5" /><small v-if="fieldErrors.quantity" class="field-error">{{ fieldErrors.quantity }}</small></label>
        <label>單位<select v-model="unit" :disabled="busy || !!problem || !part" aria-label="單位"><option value="BASE">{{ part?.base_unit || "基本單位" }}（基本單位）</option><option v-if="canPurchase" value="PURCHASE">{{ part?.purchase_unit }}（採購單位，1 = {{ fmtNum(part?.purchase_to_base_rate) }} {{ part?.base_unit }}）</option></select></label>
        <p v-if="lowStock" class="wide notice" role="alert" data-testid="low-stock-warning">來源位置目前庫存 {{ fmtNum(partItem.source_balance) }} {{ part?.base_unit }}，不足 {{ fmtNum(baseQty) }}。仍可建立調撥單，但交出時如果庫存還是不夠（且位置不允許負庫存）會失敗。</p>
        <label class="wide">調撥原因（必填）<input v-model="reason" maxlength="200" :disabled="busy || !!problem" aria-label="調撥原因" placeholder="例如：支援南港店耗材不足" /><small v-if="fieldErrors.reason" class="field-error">{{ fieldErrors.reason }}</small></label>
        <label>運送方式<select v-model="shipping" :disabled="busy || !!problem" aria-label="運送方式"><option value="">未定</option><option v-for="m in SHIPPING_METHODS" :key="m" :value="m">{{ m }}</option></select></label>
        <label class="wide">備註（選填，只有總務看得到）<textarea v-model="notes" rows="2" maxlength="500" :disabled="busy || !!problem" aria-label="備註" /></label>
      </div>
      <p v-if="error" class="field-error" role="alert" data-testid="create-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || !!problem || destMissing" data-testid="create-submit">{{ busy ? "建立中…" : "建立調撥單" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.tr-form { display: grid; gap: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.grid label { display: grid; gap: 4px; align-content: start; }
.wide { grid-column: 1 / -1; }
.notice ul { margin: 4px 0 0; padding-left: 20px; }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
</style>
