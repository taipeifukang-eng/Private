<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import { errorText, money, timeText } from "../../lib/ga-payments";

// 請款設定：尾差金額（0 至 100 的整數，預設 5 元）、買受人抬頭與統編（三聯式發票統編核對與請款單列印抬頭用）。檢視者唯讀，管理者可儲存；每次調整留紀錄。
const emit = defineEmits<{ close: [] }>();
type Settings = {
  tolerance_amount: number; buyer_title: string | null; buyer_tax_id: string | null; updated_at: string | null; can_edit: boolean;
  history: Array<{ setting_key: string; old_value: number | null; new_value: number | null; note: string | null; actor_name: string | null; created_at: string }>;
};
const data = ref<Settings | null>(null);
const f = reactive({ tolerance_amount: "5", buyer_title: "", buyer_tax_id: "" });
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
function fill(s: Settings) {
  data.value = s;
  f.tolerance_amount = String(s.tolerance_amount);
  f.buyer_title = s.buyer_title ?? "";
  f.buyer_tax_id = s.buyer_tax_id ?? "";
}
async function load() {
  loading.value = true;
  try {
    fill((await api<{ data: Settings }>("general-affairs/payment-settings")).data);
  } catch (e) {
    error.value = errorText(e);
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
    await api("general-affairs/payment-settings", {
      method: "PUT",
      body: JSON.stringify({ tolerance_amount: f.tolerance_amount, buyer_title: f.buyer_title.trim() || null, buyer_tax_id: f.buyer_tax_id.trim() || null, expected_updated_at: data.value.updated_at }),
    });
    await load();
    notice.value = "設定已儲存。";
  } catch (e) {
    error.value = errorText(e);
    if (e instanceof ApiError && e.data?.code === "STALE") await load();
  } finally {
    busy.value = false;
  }
}
const KEY: Record<string, string> = { pay_tolerance_amount: "尾差金額", pay_buyer_title: "買受人抬頭", pay_buyer_tax_id: "買受人統編" };
</script>

<template>
  <Modal title="請款設定" :busy="busy" @cancel="emit('close')">
    <form class="ps" data-testid="pay-settings-form" @submit.prevent="save">
      <p v-if="loading" role="status">載入中…</p>
      <template v-if="data">
        <p class="muted">請款與發票金額相差在尾差內（含）視為尾差，免填原因；超過要填原因但仍可送出。累計請款超過累計進貨含稅額加尾差會直接擋下。目前尾差 {{ money(data.tolerance_amount) }}。</p>
        <p v-if="!data.can_edit" class="notice" role="status" data-testid="ps-readonly">你只有查看權限，不能調整設定。</p>
        <label>尾差金額（元，0 到 100 的整數）<input v-model="f.tolerance_amount" inputmode="numeric" :disabled="!data.can_edit" data-testid="ps-tol" /></label>
        <label>買受人抬頭<input v-model="f.buyer_title" maxlength="100" :disabled="!data.can_edit" data-testid="ps-title" /></label>
        <label>買受人統一編號（8 碼數字）<input v-model="f.buyer_tax_id" inputmode="numeric" maxlength="8" :disabled="!data.can_edit" data-testid="ps-tax" /></label>
        <p v-if="notice" class="notice success" role="status" data-testid="ps-notice">{{ notice }}</p>
        <p v-if="error" class="field-error" role="alert" data-testid="ps-error">{{ error }}</p>
        <h4>最近調整紀錄</h4>
        <ul class="ps-hist" data-testid="ps-history">
          <li v-for="(h, i) in data.history" :key="i">{{ KEY[h.setting_key] || h.setting_key }}<template v-if="h.new_value !== null">：{{ h.old_value ?? "（預設）" }} → {{ h.new_value }}</template>　{{ h.actor_name || "" }} {{ timeText(h.created_at) }}</li>
          <li v-if="!data.history.length" class="muted">還沒有調整紀錄</li>
        </ul>
      </template>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="ps-close" @click="emit('close')">關閉</button>
        <button v-if="data?.can_edit" type="submit" class="primary" :disabled="busy" data-testid="ps-save">{{ busy ? "儲存中…" : "儲存設定" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.ps { display: grid; gap: 10px; min-width: 0; }
.ps label { display: grid; gap: 4px; }
.ps-hist { margin: 0; padding-left: 18px; font-size: 13px; }
@media (max-width: 700px) { .dialog-actions button { min-height: 44px; } }
</style>
