<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { errorText } from "../../lib/ga-payments";
import { validatePayoutAccountPayload } from "../../../../lib/workspace/general-affairs/payee-rules";

// ga-improve-b1 G4：同仁匯款帳戶登錄。同仁本人在「我的代墊款」登錄自己的；會計（請款管理加廠商帳務檢視）可以代同仁登錄。
// 完整帳號只給本人與有廠商帳務檢視權限者看；事件紀錄只記哪些欄位變了與末四碼，不含帳號本文。
const props = defineProps<{ who: "own" | string; label?: string }>();
const emit = defineEmits<{ close: []; saved: [last4: string | null] }>();
const path = `general-affairs/payee-accounts/${props.who}`;
const f = reactive({ bank_name: "", bank_branch: "", bank_account: "", bank_account_name: "" });
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const last4 = ref<string | null>(null);
const hasAccount = ref(false);
onMounted(async () => {
  try {
    const res = await api<{ data: { account: Record<string, string | null> | null; account_last4?: string | null; masked?: boolean } }>(path);
    const a = res.data.account;
    if (a) {
      f.bank_name = a.bank_name || "";
      f.bank_branch = a.bank_branch || "";
      f.bank_account = a.bank_account || "";
      f.bank_account_name = a.bank_account_name || "";
      hasAccount.value = true;
    }
    last4.value = res.data.account_last4 ?? null;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
});
async function save() {
  if (busy.value) return;
  error.value = "";
  let payload: Record<string, unknown>;
  try {
    payload = validatePayoutAccountPayload({ ...f }, true);
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  busy.value = true;
  try {
    const res = await api<{ data: { account_last4?: string | null } }>(path, { method: "PUT", body: JSON.stringify(payload) });
    emit("saved", res.data.account_last4 ?? null);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="who === 'own' ? '我的匯款帳戶' : `代登錄匯款帳戶${label ? '：' + label : ''}`" :busy="busy" @cancel="emit('close')">
    <form class="pa" data-testid="payout-form" @submit.prevent="save">
      <p v-if="loading" role="status">載入中…</p>
      <p class="muted">公司把代墊款還給同仁時匯到這個帳戶。帳號只有同仁本人與有廠商帳務檢視權限的會計看得到完整內容，其他人只看到末四碼；異動紀錄不記帳號本文。</p>
      <p v-if="hasAccount && last4" class="muted" data-testid="payout-last4">目前已登錄，帳號末四碼 {{ last4 }}。</p>
      <label>銀行名稱<input v-model="f.bank_name" maxlength="60" data-testid="payout-bank" /></label>
      <label>分行（選填）<input v-model="f.bank_branch" maxlength="60" data-testid="payout-branch" /></label>
      <label>帳號（數字，可含連字號）<input v-model="f.bank_account" inputmode="numeric" maxlength="40" data-testid="payout-account" /></label>
      <label>戶名<input v-model="f.bank_account_name" maxlength="60" data-testid="payout-name" /></label>
      <p v-if="error" class="field-error" role="alert" data-testid="payout-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" data-testid="payout-cancel" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || loading" data-testid="payout-save">{{ busy ? "儲存中…" : "儲存帳戶" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.pa { display: grid; gap: 10px; min-width: 0; }
.pa label { display: grid; gap: 4px; min-width: 0; }
.pa p { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 700px) { .dialog-actions button { min-height: 44px; } }
</style>
