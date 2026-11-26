<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import { errorText } from "../../lib/ga-payments";
import { selectableCompanies, type BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";

// ga-improve-b1 G4／G11：請款單草稿的「付款對象」（廠商或同仁代墊）與「買受人抬頭」。採購、預付與水電請款單共用。
// 付款對象選同仁時，從在職同仁清單挑選（只顯示姓名、員編、部門與是否已登錄匯款帳戶，不含帳戶內容）；廠商仍記在請款單上。
// 買受人抬頭下拉只列啟用中的公司，單據目前已選的（即使已停用）仍保留顯示；不選就沿用預設公司。
const props = withDefaults(defineProps<{
  editing: boolean; prefix: string; showPayee?: boolean;
  payeeType: "VENDOR" | "EMPLOYEE"; payeeProfileId: string; payeeName: string; buyerCompanyId: string; companies: BuyerCompany[];
}>(), { showPayee: true });
const emit = defineEmits<{
  "update:payeeType": [v: "VENDOR" | "EMPLOYEE"]; "update:payeeProfileId": [v: string]; "update:payeeName": [v: string]; "update:buyerCompanyId": [v: string]; change: [];
}>();
type Opt = { id: string; full_name: string; employee_code: string | null; department: string | null; has_account: boolean };
const q = ref("");
const opts = ref<Opt[]>([]);
const loading = ref(false);
const error = ref("");
const pickerOpen = ref(false);
const showPayeeBlock = computed(() => props.showPayee !== false);
const companyOptions = computed(() => selectableCompanies(props.companies, props.buyerCompanyId || null));
const defaultCompany = computed(() => props.companies.find((c) => c.is_default && c.is_active) || null);
let timer: ReturnType<typeof setTimeout> | null = null;
async function search() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: Opt[] }>("general-affairs/payee-options?" + new URLSearchParams({ q: q.value.trim() }));
    opts.value = res.data;
  } catch (e) {
    error.value = errorText(e);
    opts.value = [];
  } finally {
    loading.value = false;
  }
}
watch(q, () => { if (timer) clearTimeout(timer); timer = setTimeout(search, 300); });
onMounted(() => { if (props.payeeType === "EMPLOYEE" && !props.payeeProfileId) void search(); });
function setType(t: "VENDOR" | "EMPLOYEE") {
  emit("update:payeeType", t);
  if (t === "VENDOR") { emit("update:payeeProfileId", ""); emit("update:payeeName", ""); } else { pickerOpen.value = true; void search(); }
  emit("change");
}
function pick(o: Opt) {
  emit("update:payeeProfileId", o.id);
  emit("update:payeeName", `${o.full_name}${o.employee_code ? "（" + o.employee_code + "）" : ""}`);
  pickerOpen.value = false;
  emit("change");
}
function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
  if (pickerOpen.value) void search();
}
</script>

<template>
  <div class="pbf" :data-testid="prefix + '-payee-buyer'">
    <fieldset v-if="showPayeeBlock" class="pbf-box" :disabled="!editing">
      <legend>付款對象</legend>
      <div class="pbf-radios" role="radiogroup" aria-label="付款對象">
        <label><input type="radio" :name="prefix + '-payee-type'" :checked="payeeType === 'VENDOR'" :data-testid="prefix + '-payee-vendor'" @change="setType('VENDOR')" /> 付給廠商</label>
        <label><input type="radio" :name="prefix + '-payee-type'" :checked="payeeType === 'EMPLOYEE'" :data-testid="prefix + '-payee-employee'" @change="setType('EMPLOYEE')" /> 同仁代墊（錢還給同仁）</label>
      </div>
      <template v-if="payeeType === 'EMPLOYEE'">
        <p class="pbf-picked" :data-testid="prefix + '-payee-picked'">代墊同仁：<strong>{{ payeeName || "（尚未選擇）" }}</strong><button v-if="editing && payeeProfileId" type="button" class="link" :data-testid="prefix + '-payee-change'" @click="togglePicker">更換</button></p>
        <div v-if="editing && (pickerOpen || !payeeProfileId)" class="pbf-picker">
          <label>搜尋同仁（姓名或員工編號）<input v-model="q" type="search" :data-testid="prefix + '-payee-search'" /></label>
          <p v-if="loading" role="status" class="muted">搜尋中…</p>
          <p v-if="error" class="field-error" role="alert" :data-testid="prefix + '-payee-error'">{{ error }}</p>
          <ul class="pbf-list" :data-testid="prefix + '-payee-list'">
            <li v-for="o in opts" :key="o.id">
              <button type="button" :data-testid="prefix + '-payee-opt'" @click="pick(o)">{{ o.full_name }}<span class="muted">　{{ o.employee_code || "無員編" }}　{{ o.department || "" }}</span><span class="tag" :class="{ warn: !o.has_account }">{{ o.has_account ? "已登錄匯款帳戶" : "尚未登錄匯款帳戶" }}</span></button>
            </li>
            <li v-if="!opts.length && !loading" class="muted">找不到在職同仁。</li>
          </ul>
        </div>
        <p class="muted pbf-hint">付款對象是同仁，錢還給同仁；廠商仍記在單據上。送出前同仁要先登錄匯款帳戶；標已付款不能是同仁本人，付款方式限轉帳、現金、支票。</p>
      </template>
    </fieldset>
    <label class="pbf-buyer">買受人抬頭
      <select :value="buyerCompanyId" :disabled="!editing" :data-testid="prefix + '-buyer'" @change="emit('update:buyerCompanyId', ($event.target as HTMLSelectElement).value); emit('change')">
        <option value="">{{ defaultCompany ? `（沿用預設公司：${defaultCompany.name}）` : "（沿用請款設定的抬頭）" }}</option>
        <option v-for="c in companyOptions" :key="c.id" :value="c.id">{{ c.name }}（{{ c.tax_id }}）{{ c.is_active ? "" : "【已停用】" }}</option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.pbf { display: grid; gap: 10px; min-width: 0; }
.pbf-box { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: grid; gap: 8px; min-width: 0; margin: 0; }
.pbf-box legend { font-weight: 600; font-size: 14px; padding: 0 6px; }
.pbf-radios { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.pbf label { display: grid; gap: 4px; min-width: 0; }
/* 審查：全站 label 是 grid，單選圓點會掉到文字上方；這裡用比 .pbf label 更高的選擇器改回同一行 */
.pbf .pbf-radios label { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; }
.pbf .pbf-radios input { width: auto; min-height: 0; }
.pbf-picked { margin: 0; overflow-wrap: anywhere; }
.pbf-picker { display: grid; gap: 6px; min-width: 0; }
.pbf-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 220px; overflow-y: auto; }
.pbf-list button { width: 100%; text-align: left; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; white-space: normal; }
.pbf-hint { margin: 0; font-size: 13px; }
.tag { border-radius: 6px; padding: 0 8px; font-size: 12px; border: 1px solid var(--line); background: var(--soft); }
.tag.warn { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .pbf-list button, button.link { min-height: 44px; } }
</style>
