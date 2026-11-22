<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import InventoryPicker from "./InventoryPicker.vue";
import { fmtNum, localInputValue, newKey } from "../../lib/ga-inventory-stock";
import {
  POST_TYPES, POST_TYPE_HELP, POST_TYPE_LABEL, previewPost, unitChoices, validatePostPayload, type PostType,
} from "../../../../lib/workspace/general-affairs/inventory-stock-rules";

// G12 過帳視窗（入庫、出庫、調增、調減）。同一個位置與料件的過帳由伺服端上鎖；畫面每次送出帶固定識別（內容不變就是同一筆，連點只會過帳一次）。
// C6：只有出庫、調減、或會變成負庫存時，先顯示摘要與「過帳後餘額」再按一次確認；入庫、調增直接送出。
// 缺「庫存交易管理」或「料件查看」時，直接說明缺哪個（Q13），不讓使用者填完才被擋。
const props = defineProps<{ problem: string }>();
const emit = defineEmits<{ close: []; posted: [any] }>();

const type = ref<PostType>("RECEIPT");
const locationId = ref("");
const location = ref<any | null>(null);
const partId = ref("");
const item = ref<any | null>(null);
const quantity = ref("");
const unit = ref<"BASE" | "PURCHASE">("BASE");
const reason = ref("");
const notes = ref("");
const occurredAt = ref("");
const key = ref(newKey());
const busy = ref(false);
const error = ref("");
const fieldErrors = ref<Record<string, string>>({});
const confirmStep = ref(false);
const result = ref<any | null>(null);
const catalogNote = ref("");

const part = computed(() => item.value?.part || null);
const choices = computed(() => unitChoices(part.value));
const before = computed(() => Number(item.value?.currentBalance?.quantity_base ?? 0));
const qtyNumber = computed(() => {
  const n = Number(quantity.value);
  return quantity.value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
});
const preview = computed(() => {
  if (!item.value || qtyNumber.value === null) return null;
  return previewPost({ type: type.value, quantity: qtyNumber.value, unitType: unit.value, part: part.value, before: before.value, allowNegative: !!location.value?.allow_negative_stock });
});
const nowLocal = computed(() => localInputValue());

// 內容有任何改動就換一個新的識別（舊識別只服務「同一份內容的重送」）。
watch([type, locationId, partId, quantity, unit, reason, notes, occurredAt], () => { key.value = newKey(); confirmStep.value = false; });
watch(partId, () => { unit.value = "BASE"; });

function build() {
  const occurred = occurredAt.value ? new Date(occurredAt.value).toISOString() : null;
  return validatePostPayload({
    transaction_type: type.value, location_id: locationId.value, part_id: partId.value, quantity: quantity.value, input_unit_type: unit.value,
    reason: reason.value, notes: notes.value, idempotency_key: key.value, occurred_at: occurred,
  });
}
function check(): ReturnType<typeof build> | null {
  fieldErrors.value = {};
  error.value = "";
  if (props.problem) { error.value = props.problem; return null; }
  if (!locationId.value) fieldErrors.value.location = "請選擇庫存位置";
  else if (!partId.value) fieldErrors.value.part = "請選擇料件";
  try {
    if (Object.keys(fieldErrors.value).length) return null;
    const payload = build();
    if (preview.value && preview.value.baseQuantity === null) { fieldErrors.value.quantity = "這個數量換算成基本單位後超過 4 位小數，或這個料件沒有採購單位換算率"; return null; }
    if (preview.value?.blocked) { error.value = `過帳後庫存會變成 ${fmtNum(preview.value.after)}，而這個位置不允許負庫存，無法過帳。`; return null; }
    return payload;
  } catch (e) {
    const msg = (e as Error).message;
    if (/數量/.test(msg)) fieldErrors.value.quantity = msg;
    else if (/原因/.test(msg)) fieldErrors.value.reason = msg;
    else if (/時間/.test(msg)) fieldErrors.value.occurred = msg;
    else error.value = msg;
    return null;
  }
}

async function submit(skipConfirm = false) {
  if (busy.value) return;
  const payload = check();
  if (!payload) return;
  if (!skipConfirm && preview.value?.risky && !confirmStep.value) { confirmStep.value = true; return; }
  busy.value = true;
  error.value = "";
  try {
    const res = await api<{ data: any; replay: boolean }>("general-affairs/inventory/transactions/post", { method: "POST", body: JSON.stringify(payload) });
    result.value = { ...res.data, replay: res.replay, base_unit: part.value?.base_unit, part_name: part.value?.name, location_name: location.value?.name };
    confirmStep.value = false;
    emit("posted", res.data);
  } catch (e) {
    confirmStep.value = false;
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "IDEMPOTENCY_CONFLICT") key.value = newKey();
  } finally {
    busy.value = false;
  }
}
function again() {
  result.value = null;
  quantity.value = "";
  reason.value = "";
  notes.value = "";
  occurredAt.value = "";
  partId.value = "";
  item.value = null;
  key.value = newKey();
  error.value = "";
}
const typeHelp = computed(() => POST_TYPE_HELP[type.value]);
</script>

<template>
  <Modal title="庫存過帳" wide :busy="busy" @cancel="emit('close')">
    <div v-if="result" class="post-result" role="status" data-testid="post-result">
      <p v-if="result.replay" class="notice" data-testid="post-replay">這筆交易已經過帳過了（重複送出），庫存沒有再變動。</p>
      <p v-else class="notice success">過帳完成。</p>
      <p><strong data-testid="post-result-line">{{ result.location_name }}・{{ result.part_name }}：庫存 {{ fmtNum(result.balance_before) }} → {{ fmtNum(result.balance_after) }} {{ result.base_unit }}</strong></p>
      <p class="muted">交易單號 {{ result.transaction_no }}　類型 {{ POST_TYPE_LABEL[result.transaction_type as PostType] }}　異動 {{ fmtNum(result.quantity_base) }}（基本單位）</p>
      <div class="dialog-actions"><button type="button" @click="again">再過一筆</button><button type="button" class="primary" @click="emit('close')">關閉</button></div>
    </div>
    <form v-else class="post-form" novalidate @submit.prevent="submit()">
      <p v-if="problem" class="notice error" role="alert" data-testid="post-problem">{{ problem }}</p>
      <fieldset class="types" :disabled="busy || !!problem">
        <legend>交易類型</legend>
        <label v-for="t in POST_TYPES" :key="t" class="type-opt" :class="{ on: type === t }"><input v-model="type" type="radio" name="post-type" :value="t" />{{ POST_TYPE_LABEL[t] }}</label>
        <small class="muted wide" data-testid="type-help">{{ typeHelp }}</small>
      </fieldset>
      <div class="grid">
        <div>
          <InventoryPicker v-model="locationId" kind="locations" label="庫存位置" required :disabled="busy || !!problem" @pick="location = $event" />
          <small v-if="fieldErrors.location" class="field-error">{{ fieldErrors.location }}</small>
        </div>
        <div>
          <InventoryPicker v-model="partId" kind="location-parts" label="料件" required :location-id="locationId" :disabled="busy || !!problem || !locationId" placeholder="先選位置，再搜尋這個位置設定過的料件" @pick="item = $event" @message="catalogNote = $event" />
          <small v-if="fieldErrors.part" class="field-error">{{ fieldErrors.part }}</small>
          <small v-if="catalogNote" class="field-error">{{ catalogNote }}</small>
        </div>
        <label>數量<input v-model="quantity" inputmode="decimal" :disabled="busy || !!problem" aria-label="數量" placeholder="例如 12 或 0.5" /><small v-if="fieldErrors.quantity" class="field-error">{{ fieldErrors.quantity }}</small></label>
        <label>單位<select v-model="unit" :disabled="busy || !!problem || !item" aria-label="單位"><option v-for="c in choices" :key="c.value" :value="c.value">{{ c.label }}</option></select></label>
        <label class="wide">原因（必填）<input v-model="reason" maxlength="300" :disabled="busy || !!problem" aria-label="原因" placeholder="例如：廠商到貨、門市領用、盤點差異" /><small v-if="fieldErrors.reason" class="field-error">{{ fieldErrors.reason }}</small></label>
        <label class="wide">備註（選填）<input v-model="notes" maxlength="500" :disabled="busy || !!problem" aria-label="備註" /></label>
        <label>發生時間（選填，不填就是現在）<input v-model="occurredAt" type="datetime-local" :max="nowLocal" :disabled="busy || !!problem" aria-label="發生時間" /><small class="muted">可補登過去的時間，不可晚於現在。</small><small v-if="fieldErrors.occurred" class="field-error">{{ fieldErrors.occurred }}</small></label>
        <div v-if="item" class="stock-now" data-testid="stock-now">
          <span class="muted">目前庫存</span><strong>{{ fmtNum(before) }} {{ part?.base_unit }}</strong>
          <template v-if="preview && preview.after !== null && !preview.risky"><span class="muted">過帳後</span><strong>{{ fmtNum(preview.after) }} {{ part?.base_unit }}</strong></template>
        </div>
      </div>
      <p v-if="error" class="field-error" role="alert" data-testid="post-error">{{ error }}</p>
      <div v-if="confirmStep && preview" class="confirm-box" role="alertdialog" aria-label="確認過帳" data-testid="post-confirm">
        <strong>請確認這筆過帳</strong>
        <p>{{ POST_TYPE_LABEL[type] }}：{{ location?.name }}・{{ part?.name }}，數量 {{ quantity }}（{{ unit === "PURCHASE" ? part?.purchase_unit : part?.base_unit }}）<template v-if="unit === 'PURCHASE'">＝ {{ fmtNum(preview.baseQuantity) }} {{ part?.base_unit }}</template></p>
        <p class="after" :class="{ neg: preview.negative }" data-testid="post-after">過帳後餘額：{{ fmtNum(preview.before) }} → <strong>{{ fmtNum(preview.after) }}</strong> {{ part?.base_unit }}</p>
        <p v-for="r in preview.reasons" :key="r" class="muted">{{ r }}</p>
        <p class="muted">實際以送出當下的庫存為準。</p>
        <div class="dialog-actions"><button type="button" :disabled="busy" @click="confirmStep = false">返回修改</button><button type="button" class="primary danger" :disabled="busy" data-testid="post-confirm-ok" @click="submit(true)">{{ busy ? "過帳中…" : "確認過帳" }}</button></div>
      </div>
      <div v-else class="dialog-actions">
        <button type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || !!problem" data-testid="post-submit">{{ busy ? "過帳中…" : preview?.risky ? "下一步：確認" : "過帳" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.post-form { display: grid; gap: 12px; }
.types { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 0; }
.types legend { font-size: 13px; padding: 0 4px; }
.type-opt { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; min-height: 40px; cursor: pointer; }
.type-opt.on { border-color: var(--primary); background: var(--soft); font-weight: 600; }
.type-opt input { width: auto; }
.wide { grid-column: 1 / -1; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.grid label { display: grid; gap: 4px; align-content: start; }
.stock-now { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; align-self: end; padding: 8px 0; }
.confirm-box { border: 2px solid var(--primary); border-radius: 10px; padding: 12px 14px; display: grid; gap: 6px; background: var(--soft); }
.confirm-box p { margin: 0; }
.after.neg strong { color: var(--danger, #b3261e); }
.post-result { display: grid; gap: 8px; }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } .type-opt { flex: 1 1 40%; justify-content: center; } }
</style>
