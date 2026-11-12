<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import PoPicker from "./PoPicker.vue";
import { newKey, num, type PoDetail, type Receiving } from "../../lib/ga-purchase";
import { MAX_DISPATCH_QTY, duplicateSerials, normalizeSerials } from "../../../../lib/workspace/general-affairs/purchase-receipt-rules";

// 配發為設備（D15、D14）：從總部倉出庫 N，同一個交易為該門市建立 N 筆設備（資產編號、連結採購單與進貨紀錄、保固起算日 = 該批到貨日）。可分次；序號可空白，由店長貼標時補。
const props = defineProps<{ order: PoDetail; receiving: Receiving }>();
const emit = defineEmits<{ close: []; done: [{ order: PoDetail; receiving: Receiving; replay: boolean; data: any }] }>();
const candidates = computed(() => props.receiving.items.filter((i) => i.fulfil_mode === "STOCK" && i.dispatchable_base > 0));
const itemId = ref(candidates.value[0]?.po_item_id || "");
const storeId = ref("");
const quantity = ref("1");
const changeTemplate = ref(false);
const templateId = ref("");
const templateReason = ref("");
const serialsText = ref("");
const notes = ref("");
const key = ref(newKey());
const busy = ref(false);
const error = ref("");
const item = computed(() => props.receiving.items.find((i) => i.po_item_id === itemId.value));
const mapped = computed(() => item.value?.part_equipment_template_id || null);
const n = computed(() => Number(quantity.value));
const serials = computed(() => serialsText.value.split(/\r?\n/).map((s) => s.trim()));
function check(): string {
  if (!item.value) return "請選擇要配發的品項";
  if (!storeId.value) return "請選擇配發的門市";
  if (!Number.isInteger(n.value) || n.value < 1 || n.value > MAX_DISPATCH_QTY) return `配發數量必須是 1 至 ${MAX_DISPATCH_QTY} 的整數（每台設備一筆）`;
  if (n.value > item.value.dispatchable_base + 1e-9) return `配發數量超過目前可配發量 ${num(item.value.dispatchable_base)}（已驗入且尚未配發）`;
  if (!mapped.value && !templateId.value) return "這個料件還沒有對應的設備型號，請選擇要建立的設備型號（也可先到料件頁設定對應）";
  if (mapped.value && changeTemplate.value && templateId.value && templateId.value !== mapped.value && !templateReason.value.trim()) return "改選別的設備型號必須填寫原因";
  try {
    const list = normalizeSerials(serials.value.filter((s, i) => s || i < n.value), n.value);
    const dup = duplicateSerials(list);
    if (dup.length) return `序號重複：${dup.join("、")}`;
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}
async function submit() {
  if (busy.value) return;
  error.value = check();
  if (error.value) return;
  busy.value = true;
  try {
    const list = normalizeSerials(serials.value.filter((s, i) => s || i < n.value), n.value);
    const res = await api<any>(`general-affairs/purchase-orders/${props.order.id}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        po_item_id: itemId.value, store_id: storeId.value, quantity: n.value,
        equipment_template_id: (!mapped.value || changeTemplate.value) && templateId.value ? templateId.value : undefined,
        template_change_reason: mapped.value && changeTemplate.value && templateReason.value.trim() ? templateReason.value.trim() : undefined,
        serials: list, notes: notes.value.trim() || undefined, idempotency_key: key.value,
      }),
    });
    emit("done", { order: res.order, receiving: res.receiving, replay: !!res.replay, data: res.data });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="`配發為設備　${order.po_no}`" :busy="busy" @cancel="emit('close')">
    <form class="dp" data-testid="dispatch-form" @submit.prevent="submit">
      <p class="muted">配發會從總部倉出庫，並同時為該門市建立同數量的設備（有資產編號、連結這張採購單）。序號可先空白，由店長貼標時補填。</p>
      <p v-if="!candidates.length" class="notice" role="status" data-testid="dp-none">目前沒有可配發的品項（要先登錄到貨並驗入入庫存的品項）。</p>
      <template v-else>
        <label>配發品項
          <select v-model="itemId" data-testid="dp-item">
            <option v-for="c in candidates" :key="c.po_item_id" :value="c.po_item_id">第 {{ c.line_no }} 項　{{ c.item_name }}（可配發 {{ num(c.dispatchable_base) }}）</option>
          </select>
        </label>
        <PoPicker v-model="storeId" kind="store" label="配發到哪間門市" required testid="dp-store" />
        <label>配發數量（台）<input v-model="quantity" inputmode="numeric" data-testid="dp-qty" /></label>
        <template v-if="mapped">
          <p class="muted" data-testid="dp-template-mapped">設備型號沿用料件對應的型號。</p>
          <label class="dp-check"><input v-model="changeTemplate" type="checkbox" data-testid="dp-change-template" /> 要改選別的型號（須填原因）</label>
        </template>
        <PoPicker v-if="!mapped || changeTemplate" v-model="templateId" kind="template" label="設備型號" :required="!mapped" testid="dp-template" />
        <label v-if="mapped && changeTemplate">改型號原因（必填）<input v-model="templateReason" maxlength="200" data-testid="dp-template-reason" /></label>
        <label>序號（選填，每行一個，依順序對應每台；可留空）<textarea v-model="serialsText" rows="3" data-testid="dp-serials" /></label>
        <label>備註（選填）<input v-model="notes" maxlength="500" data-testid="dp-notes" /></label>
      </template>
      <p v-if="error" class="field-error" role="alert" data-testid="dp-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="dp-cancel" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || !candidates.length" data-testid="dp-submit">{{ busy ? "配發中…" : "配發並建立設備" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.dp { display: grid; gap: 12px; min-width: 0; }
.dp label { display: grid; gap: 4px; min-width: 0; }
.dp-check { display: flex !important; gap: 8px; align-items: center; }
@media (max-width: 700px) { .dialog-actions button { min-height: 44px; } }
</style>
