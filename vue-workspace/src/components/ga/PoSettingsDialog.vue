<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { money } from "../../lib/ga-purchase";

// 採購核准設定（限持「採購核准」權限者）：核准門檻（含稅總額超過才需核准）、稅率、歷史價筆數。只影響之後送出的單（送核准時才快照門檻）；每次調整都留紀錄。
const emit = defineEmits<{ close: [] }>();
type Settings = { approval_enabled: boolean; approval_threshold: number; tax_rate: number; price_history_limit: number; updated_at: string | null; can_edit: boolean; history: Array<{ setting_key: string; old_value: number | null; new_value: number | null; actor_name: string | null; created_at: string }> };
const data = ref<Settings | null>(null);
const f = reactive({ approval_enabled: true, approval_threshold: "5000", tax_rate: "0.05", price_history_limit: "5" });
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
function fill(s: Settings) {
  data.value = s;
  f.approval_enabled = s.approval_enabled;
  f.approval_threshold = String(s.approval_threshold);
  f.tax_rate = String(s.tax_rate);
  f.price_history_limit = String(s.price_history_limit);
}
async function load() {
  loading.value = true;
  try {
    fill((await api<{ data: Settings }>("general-affairs/purchase-orders/settings")).data);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function save() {
  if (busy.value || !data.value) return;
  error.value = "";
  notice.value = "";
  busy.value = true;
  try {
    const res = await api<{ data: Settings }>("general-affairs/purchase-orders/settings", {
      method: "PATCH",
      body: JSON.stringify({
        approval_enabled: f.approval_enabled, approval_threshold: Number(f.approval_threshold), tax_rate: Number(f.tax_rate), price_history_limit: Number(f.price_history_limit),
        expected_updated_at: data.value.updated_at,
      }),
    });
    fill(res.data);
    notice.value = "設定已儲存，只影響之後送出核准的採購單。";
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE") await load();
  } finally {
    busy.value = false;
  }
}
const KEY: Record<string, string> = { po_approval_enabled: "啟用核准", po_approval_threshold: "核准門檻", po_tax_rate: "稅率", po_price_history_limit: "歷史價筆數" };
</script>

<template>
  <Modal title="採購核准設定" :busy="busy" @cancel="emit('close')">
    <form class="ps" data-testid="settings-form" @submit.prevent="save">
      <p v-if="loading" role="status">載入中…</p>
      <template v-if="data">
        <p class="muted">含稅總額「超過」門檻的採購單要先經核准才能下訂（剛好等於門檻免核准）。目前門檻 {{ money(data.approval_threshold) }}。</p>
        <label class="ps-check"><input v-model="f.approval_enabled" type="checkbox" data-testid="st-enabled" /> 啟用採購核准</label>
        <label>核准門檻（含稅總額，元）<input v-model="f.approval_threshold" inputmode="decimal" data-testid="st-threshold" /></label>
        <label>稅率（0.05 代表 5%）<input v-model="f.tax_rate" inputmode="decimal" data-testid="st-tax" /></label>
        <label>歷史價顯示筆數（1 至 20）<input v-model="f.price_history_limit" inputmode="numeric" data-testid="st-history" /></label>
        <p v-if="notice" class="notice success" role="status" data-testid="st-notice">{{ notice }}</p>
        <p v-if="error" class="field-error" role="alert" data-testid="st-error">{{ error }}</p>
        <h4>最近調整紀錄</h4>
        <ul class="ps-hist" data-testid="st-history-list">
          <li v-for="(h, i) in data.history" :key="i">{{ KEY[h.setting_key] || h.setting_key }}：{{ h.old_value ?? "（預設）" }} → {{ h.new_value }}　{{ h.actor_name || "" }} {{ fmtTime(h.created_at) }}</li>
          <li v-if="!data.history.length" class="muted">還沒有調整紀錄</li>
        </ul>
      </template>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="st-close" @click="emit('close')">關閉</button>
        <button type="submit" class="primary" :disabled="busy || !data" data-testid="st-save">{{ busy ? "儲存中…" : "儲存設定" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.ps { display: grid; gap: 10px; min-width: 0; }
.ps label { display: grid; gap: 4px; }
.ps-check { display: flex !important; gap: 8px; align-items: center; }
.ps-hist { margin: 0; padding-left: 18px; font-size: 13px; }
@media (max-width: 700px) { .dialog-actions button { min-height: 44px; } }
</style>
