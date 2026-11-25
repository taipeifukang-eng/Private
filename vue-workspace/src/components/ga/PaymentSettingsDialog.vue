<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../../api";
import Modal from "../Modal.vue";
import { errorText, money, newKey, timeText } from "../../lib/ga-payments";
import { validateBuyerCompanyPayload, type BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";

// 請款設定：尾差金額（0 至 100 的整數，預設 5 元）、買受人抬頭與統編（三聯式發票統編核對與請款單列印抬頭用）。檢視者唯讀，管理者可儲存；每次調整留紀錄。
// ga-improve-b1 G11：買受人可以有多家公司（名稱＋統編）。上面兩欄是「預設公司」的抬頭與統編（沒有預設公司就建立一家並設為預設）；下面的清單可新增其他公司、改名、設預設、停用。
// 每張採購單與請款單可選抬頭；請款單送出時凍結抬頭快照，公司之後改名不影響已送出的單據；三聯式發票統編可以是任一啟用公司的統編。
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
const companies = ref<BuyerCompany[]>([]);
const companiesUpdatedAt = ref<string | null>(null);
const canEditCompanies = ref(false);
const cBusy = ref(false);
const cError = ref("");
const newName = ref("");
const newTax = ref("");
const editId = ref("");
const editName = ref("");
const editTax = ref("");
async function loadCompanies() {
  try {
    const res = await api<{ data: BuyerCompany[]; updated_at: string | null; permissions: { canEdit: boolean } }>("general-affairs/buyer-companies");
    companies.value = res.data;
    companiesUpdatedAt.value = res.updated_at;
    canEditCompanies.value = !!res.permissions?.canEdit;
  } catch (e) {
    cError.value = errorText(e);
  }
}
async function companyCall(path: string, body?: Record<string, unknown>) {
  if (cBusy.value) return false;
  cError.value = "";
  cBusy.value = true;
  try {
    await api(`general-affairs/buyer-companies${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
    await Promise.all([loadCompanies(), load()]);
    return true;
  } catch (e) {
    cError.value = errorText(e);
    return false;
  } finally {
    cBusy.value = false;
  }
}
async function addCompany() {
  try { validateBuyerCompanyPayload({ name: newName.value, tax_id: newTax.value }); } catch (e) { cError.value = (e as Error).message; return; }
  if (await companyCall("", { name: newName.value.trim(), tax_id: newTax.value.trim(), idempotency_key: newKey() })) { newName.value = ""; newTax.value = ""; notice.value = "已新增買受人公司。"; }
}
function startEdit(c: BuyerCompany) { editId.value = c.id; editName.value = c.name; editTax.value = c.tax_id; cError.value = ""; }
async function saveEdit(c: BuyerCompany) {
  try { validateBuyerCompanyPayload({ id: c.id, name: editName.value, tax_id: editTax.value }); } catch (e) { cError.value = (e as Error).message; return; }
  if (await companyCall("", { id: c.id, name: editName.value.trim(), tax_id: editTax.value.trim(), expected_updated_at: c.updated_at, idempotency_key: newKey() })) { editId.value = ""; notice.value = "已更新買受人公司。"; }
}
async function setDefault(c: BuyerCompany) { if (await companyCall(`/${c.id}/default`)) notice.value = `已將「${c.name}」設為預設公司。`; }
async function deactivate(c: BuyerCompany) { if (await companyCall(`/${c.id}/deactivate`)) notice.value = `已停用「${c.name}」；已選用它的單據仍顯示。`; }
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
onMounted(() => { void load(); void loadCompanies(); });
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
    await Promise.all([load(), loadCompanies()]);
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
        <p class="muted" data-testid="ps-tol-hint">調低尾差後，尚未送出的草稿在送出時會用新的尾差重新檢查；已送出、已付款的請款單不受影響。</p>
        <label>預設買受人抬頭<input v-model="f.buyer_title" maxlength="100" :disabled="!data.can_edit" data-testid="ps-title" /></label>
        <label>預設買受人統一編號（8 碼數字）<input v-model="f.buyer_tax_id" inputmode="numeric" maxlength="8" :disabled="!data.can_edit" data-testid="ps-tax" /></label>
        <section class="ps-companies" data-testid="ps-companies">
          <h4>買受人公司清單</h4>
          <p class="muted">可以有多家公司（名稱＋統編）。採購單與請款單各自選抬頭，不選就用預設公司；請款單列印印出所選抬頭。上面兩欄是預設公司的抬頭與統編。</p>
          <ul class="ps-clist">
            <li v-for="c in companies" :key="c.id" :class="{ off: !c.is_active }" data-testid="ps-company">
              <template v-if="editId === c.id">
                <label>公司名稱<input v-model="editName" maxlength="100" data-testid="ps-company-edit-name" /></label>
                <label>統一編號<input v-model="editTax" inputmode="numeric" maxlength="8" data-testid="ps-company-edit-tax" /></label>
                <div class="ps-row"><button type="button" :disabled="cBusy" data-testid="ps-company-edit-save" @click="saveEdit(c)">儲存</button><button type="button" :disabled="cBusy" @click="editId = ''">取消</button></div>
              </template>
              <template v-else>
                <span class="ps-cname"><strong data-testid="ps-company-name">{{ c.name }}</strong>　{{ c.tax_id }}<span v-if="c.is_default" class="tag" data-testid="ps-company-default">預設</span><span v-if="!c.is_active" class="tag off" data-testid="ps-company-off">已停用</span><small v-if="c.usage_count" class="muted">　已有 {{ c.usage_count }} 張單據使用</small></span>
                <span v-if="canEditCompanies && c.is_active" class="ps-row">
                  <button type="button" :disabled="cBusy" :data-testid="'ps-company-edit-' + c.tax_id" @click="startEdit(c)">編輯</button>
                  <button v-if="!c.is_default" type="button" :disabled="cBusy" :data-testid="'ps-company-default-' + c.tax_id" @click="setDefault(c)">設為預設</button>
                  <button v-if="!c.is_default" type="button" :disabled="cBusy" :data-testid="'ps-company-deactivate-' + c.tax_id" @click="deactivate(c)">停用</button>
                </span>
              </template>
            </li>
            <li v-if="!companies.length" class="muted" data-testid="ps-company-empty">還沒有買受人公司。在上面填預設抬頭與統編後儲存，或在下面新增。</li>
          </ul>
          <div v-if="canEditCompanies" class="ps-add">
            <label>新增公司名稱<input v-model="newName" maxlength="100" data-testid="ps-company-new-name" /></label>
            <label>統一編號（8 碼數字）<input v-model="newTax" inputmode="numeric" maxlength="8" data-testid="ps-company-new-tax" /></label>
            <button type="button" :disabled="cBusy" data-testid="ps-company-add" @click="addCompany">新增公司</button>
          </div>
          <p v-if="cError" class="field-error" role="alert" data-testid="ps-company-error">{{ cError }}</p>
        </section>
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
.ps-companies { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; min-width: 0; }
.ps-companies h4 { margin: 0; }
.ps-companies p { margin: 0; overflow-wrap: anywhere; }
.ps-clist { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ps-clist li { border-bottom: 1px solid var(--line); padding-bottom: 8px; display: grid; gap: 6px; min-width: 0; }
.ps-clist li.off { opacity: 0.7; }
.ps-cname { overflow-wrap: anywhere; }
.ps-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-add { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; align-items: end; }
.tag { margin-left: 8px; border-radius: 6px; padding: 0 8px; font-size: 12px; border: 1px solid var(--line); background: var(--soft); }
.tag.off { color: var(--muted); }
@media (max-width: 700px) { .dialog-actions button, .ps-row button, .ps-add button { min-height: 44px; } }
</style>
