<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import PoPicker from "./PoPicker.vue";
import { FULFIL_TEXT, newKey, num, taipeiToday, type PoDetail, type Receiving } from "../../lib/ga-purchase";
import { receiptLineProblem } from "../../../../lib/workspace/general-affairs/purchase-receipt-rules";

// 登錄到貨（D12 到貨與驗入合併一步）：登錄的同時驗入，入庫存的品項立刻增加總部倉庫存，直接建設備的品項直接建立設備送門市。
// 到貨量不得超過剩餘可收量（D13）；破損或拒收要填原因（分批到貨不用）；改收貨位置或改收替代料要填變更原因（D3）。送出時帶固定識別，重送不會重複入帳。
const props = defineProps<{ order: PoDetail; receiving: Receiving }>();
const emit = defineEmits<{ close: []; done: [{ order: PoDetail; receiving: Receiving; replay: boolean }] }>();
type Line = { po_item_id: string; on: boolean; delivered: string; accepted: string; reason: string; change: boolean; location_id: string; part_id: string; change_reason: string };
const rowsInfo = computed(() => props.receiving.items.filter((i) => i.remaining_qty > 0));
// ga-improve-b1 G3：還沒併入任何進貨單的調整列（運費、折扣等）會由第一張「品項金額加調整列大於 0」的進貨單承接；G1：已預付的採購單，驗入時自動核銷預付款。
const pendingAdj = computed(() => (props.order.adjustments || []).filter((a) => !a.receipt_no));
const adjText = computed(() => pendingAdj.value.map((a) => `${a.label} ${a.amount > 0 ? "+" : "−"}${Math.abs(a.amount).toLocaleString("en-US")}`).join("、"));
const prepayBalance = computed(() => Number(props.order.prepay?.balance || 0));
const lines = reactive<Line[]>(rowsInfo.value.map((i) => ({ po_item_id: i.po_item_id, on: true, delivered: String(i.remaining_qty), accepted: String(i.remaining_qty), reason: "", change: false, location_id: "", part_id: "", change_reason: "" })));
const header = reactive({ received_date: taipeiToday(), delivery_note_no: "", notes: "" });
const key = ref(newKey());
const busy = ref(false);
const error = ref("");
const info = (id: string) => props.receiving.items.find((i) => i.po_item_id === id)!;
const poItem = (id: string) => props.order.items.find((i) => i.id === id)!;
function onDelivered(l: Line) { l.accepted = l.delivered; }
function problem(l: Line): string {
  if (!l.on) return "";
  const i = info(l.po_item_id);
  const it = poItem(l.po_item_id);
  const delivered = Number(l.delivered);
  const accepted = l.accepted === "" ? delivered : Number(l.accepted);
  if (!Number.isFinite(delivered) || !Number.isFinite(accepted)) return `「${i.item_name}」的數量格式不正確`;
  const p = receiptLineProblem(
    { po_item_id: l.po_item_id, delivered_qty: delivered, accepted_qty: accepted, reason: l.reason.trim() || null, location_id: l.change && l.location_id ? l.location_id : null, received_part_id: l.change && l.part_id ? l.part_id : null, change_reason: l.change_reason.trim() || null },
    { item_name: i.item_name, ordered_qty: i.quantity, received_qty: i.received_qty, fulfil_mode: i.fulfil_mode as any, po_location_id: props.order.receiving_location_id, po_part_id: it.part_id },
  );
  return p ? p.message : "";
}
const picked = computed(() => lines.filter((l) => l.on));
async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!picked.value.length) { error.value = "請至少勾選一個品項"; return; }
  for (const l of picked.value) {
    // 品項的問題已顯示在該品項下方，這裡不重複放到表單底部（底部只放非品項的錯誤）。
    if (problem(l)) return;
  }
  busy.value = true;
  try {
    const res = await api<any>(`general-affairs/purchase-orders/${props.order.id}/receipts`, {
      method: "POST",
      body: JSON.stringify({
        header: { received_date: header.received_date || undefined, delivery_note_no: header.delivery_note_no.trim() || undefined, notes: header.notes.trim() || undefined },
        lines: picked.value.map((l) => ({
          po_item_id: l.po_item_id, delivered_qty: Number(l.delivered), accepted_qty: l.accepted === "" ? Number(l.delivered) : Number(l.accepted), reason: l.reason.trim() || undefined,
          location_id: l.change && l.location_id ? l.location_id : undefined, received_part_id: l.change && l.part_id ? l.part_id : undefined, change_reason: l.change && l.change_reason.trim() ? l.change_reason.trim() : undefined,
        })),
        idempotency_key: key.value,
      }),
    });
    emit("done", { order: res.order, receiving: res.receiving, replay: !!res.replay });
  } catch (e) {
    if ((e as any)?.data?.code === "IDEMPOTENCY_CONFLICT") key.value = newKey();
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="`登錄到貨　${order.po_no}`" :busy="busy" wide @cancel="emit('close')">
    <form class="rc" data-testid="receipt-form" @submit.prevent="submit">
      <p class="muted">登錄到貨的同時就是驗入：入庫存的品項會立刻增加總部倉庫存。到貨量不能超過剩餘可收量；有破損或拒收要填原因，分批到貨不用填。</p>
      <p v-if="pendingAdj.length" class="notice" role="status" data-testid="rc-adj-note">本次進貨單會併入調整列：{{ adjText }}（若本次品項金額加調整列合計不大於 0，會延後到下一張進貨單）。</p>
      <p v-if="prepayBalance > 0" class="notice" role="status" data-testid="rc-prepay-note">這張採購單還有預付款餘額 NT$ {{ prepayBalance.toLocaleString("en-US") }}，驗入後系統會自動核銷在這張進貨單上，之後一般請款只請差額。</p>
      <div class="rc-head">
        <label>到貨日期<input v-model="header.received_date" type="date" :max="taipeiToday()" required data-testid="rc-date" /></label>
        <label>廠商送貨單號（選填）<input v-model="header.delivery_note_no" maxlength="60" data-testid="rc-note-no" /></label>
        <label class="grow">備註（選填）<input v-model="header.notes" maxlength="500" data-testid="rc-notes" /></label>
      </div>
      <ul class="rc-lines" aria-label="到貨品項">
        <li v-for="(l, idx) in lines" :key="l.po_item_id" class="rc-line" :class="{ off: !l.on }" data-testid="rc-line">
          <label class="rc-pick"><input v-model="l.on" type="checkbox" :data-testid="'rc-on-' + idx" /> <strong>{{ info(l.po_item_id).item_name }}</strong></label>
          <p class="muted">{{ FULFIL_TEXT[info(l.po_item_id).fulfil_mode] }}；訂購 {{ num(info(l.po_item_id).quantity) }} {{ info(l.po_item_id).unit }}，已驗入 {{ num(info(l.po_item_id).received_qty) }}，剩餘可收 <strong data-testid="rc-remaining">{{ num(info(l.po_item_id).remaining_qty) }}</strong></p>
          <template v-if="l.on">
            <div class="rc-nums">
              <label>到貨量<input v-model="l.delivered" inputmode="decimal" :data-testid="'rc-delivered-' + idx" @input="onDelivered(l)" /></label>
              <label>驗入量（破損拒收的不算）<input v-model="l.accepted" inputmode="decimal" :data-testid="'rc-accepted-' + idx" /></label>
              <label class="grow">原因（有破損拒收時必填）<input v-model="l.reason" maxlength="200" :data-testid="'rc-reason-' + idx" /></label>
            </div>
            <template v-if="info(l.po_item_id).fulfil_mode === 'STOCK'">
              <label class="rc-check"><input v-model="l.change" type="checkbox" :data-testid="'rc-change-' + idx" /> 要改收貨位置或改收替代料（須填變更原因）</label>
              <div v-if="l.change" class="rc-change">
                <PoPicker v-model="l.location_id" kind="location" label="改收貨位置（不改就留空）" clearable :testid="'rc-location-' + idx" />
                <PoPicker v-model="l.part_id" kind="part" label="改收替代料（不改就留空）" clearable :testid="'rc-part-' + idx" />
                <label>變更原因（必填）<input v-model="l.change_reason" maxlength="200" :data-testid="'rc-change-reason-' + idx" /></label>
              </div>
            </template>
            <p v-if="problem(l)" class="field-error" role="alert" :data-testid="'rc-problem-' + idx">{{ problem(l) }}</p>
          </template>
        </li>
      </ul>
      <p v-if="!lines.length" class="muted">這張採購單的品項都已收齊。</p>
      <p v-if="error" class="field-error" role="alert" data-testid="rc-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="rc-cancel" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || !lines.length" data-testid="rc-submit">{{ busy ? "登錄中…" : "登錄到貨並驗入" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.rc { display: grid; gap: 12px; min-width: 0; }
.rc-head { display: flex; flex-wrap: wrap; gap: 10px; }
.rc-head label, .rc-nums label, .rc-change label { display: grid; gap: 4px; min-width: 0; }
.rc-head .grow, .rc-nums .grow { flex: 1 1 220px; }
.rc-lines { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rc-line { border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 8px; min-width: 0; }
.rc-line.off { opacity: 0.6; }
.rc-line p { margin: 0; overflow-wrap: anywhere; }
.rc-nums { display: flex; flex-wrap: wrap; gap: 10px; }
.rc-nums input { max-width: 140px; }
.rc-nums .grow input { max-width: none; }
.rc-pick, .rc-check { display: flex; gap: 8px; align-items: center; }
.rc-change { display: grid; gap: 8px; border-left: 3px solid var(--line); padding-left: 10px; }
@media (max-width: 700px) { .rc-nums input { max-width: none; } .dialog-actions button { min-height: 44px; } }
</style>
