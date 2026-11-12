<script setup lang="ts">
import { computed, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import InventoryPicker from "./InventoryPicker.vue";
import { newKey, num, type RequestRow } from "../../lib/ga-requests";

// 需求單庫存出庫（Q18）：出庫量不得超過剩餘需求量；料件要和需求單相同，替代料須填原因。同一個畫面開啟期間用同一個固定識別，連點或重送不會重複扣庫存。
const props = defineProps<{ request: RequestRow }>();
const emit = defineEmits<{ close: []; done: [] }>();
const key = newKey();
const locationId = ref("");
const partId = ref(props.request.part?.id || "");
const pickedPart = ref<any | null>(props.request.part ? { part_id: props.request.part.id, part: props.request.part } : null);
const quantity = ref(props.request.desired_quantity ? String(props.request.desired_quantity) : "");
const unitType = ref<"BASE" | "PURCHASE">("BASE");
const reason = ref("");
const notes = ref("");
const substitute = ref("");
const busy = ref(false);
const error = ref("");
const isSubstitute = computed(() => !!partId.value && !!props.request.part?.id && partId.value !== props.request.part.id);

async function submit() {
  if (busy.value) return;
  error.value = "";
  const q = Number(quantity.value);
  if (!locationId.value) { error.value = "請選擇出庫位置"; return; }
  if (!partId.value) { error.value = "請選擇料件"; return; }
  if (!Number.isFinite(q) || q <= 0) { error.value = "數量必須大於 0"; return; }
  if (isSubstitute.value && !substitute.value.trim()) { error.value = "出庫的料件和需求單的料件不同，請填寫替代原因"; return; }
  busy.value = true;
  try {
    await api(`general-affairs/requests/${props.request.id}/stock-issue`, {
      method: "POST",
      body: JSON.stringify({
        location_id: locationId.value, part_id: partId.value, quantity: q, input_unit_type: unitType.value, reason: reason.value.trim() || undefined,
        notes: notes.value.trim() || undefined, substitute_reason: isSubstitute.value ? substitute.value.trim() : undefined, idempotency_key: key,
      }),
    });
    emit("done");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "出庫失敗，請稍後重試";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="需求單庫存出庫" :busy="busy" @cancel="emit('close')">
    <form class="si" novalidate data-testid="stock-issue-form" @submit.prevent="submit">
      <p class="muted">需求單 {{ request.request_no }}：{{ request.part?.name }} × {{ num(request.desired_quantity) }} {{ request.desired_unit }}。出庫量不能超過剩餘需求量。</p>
      <InventoryPicker v-model="locationId" kind="locations" label="出庫位置" required :disabled="busy" />
      <InventoryPicker v-model="partId" kind="location-parts" label="料件" required :location-id="locationId" :disabled="busy || !locationId" :initial="pickedPart" placeholder="先選位置，再搜尋這個位置設定過的料件" @pick="pickedPart = $event" />
      <label>數量<input v-model="quantity" inputmode="decimal" data-testid="si-qty" aria-label="出庫數量" /></label>
      <label>單位<select v-model="unitType" data-testid="si-unit"><option value="BASE">基本單位</option><option value="PURCHASE">採購單位</option></select></label>
      <label v-if="isSubstitute">替代原因（必填）<input v-model="substitute" maxlength="200" data-testid="si-substitute" /></label>
      <label>出庫原因（選填）<input v-model="reason" maxlength="200" /></label>
      <label>備註（選填）<textarea v-model="notes" rows="2" maxlength="500" /></label>
      <p v-if="error" class="field-error" role="alert" data-testid="si-error">{{ error }}</p>
      <div class="dialog-actions"><button type="button" :disabled="busy" @click="emit('close')">取消</button><button type="submit" class="primary" :disabled="busy" data-testid="si-submit">{{ busy ? "出庫中…" : "確定出庫" }}</button></div>
    </form>
  </Modal>
</template>

<style scoped>
.si { display: grid; gap: 10px; min-width: 0; }
.si label { display: grid; gap: 4px; }
</style>
