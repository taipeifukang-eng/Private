<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import {
  INVOICE_TYPES, PAYMENT_METHODS, PAYMENT_TERMS, VENDOR_STEPS, VENDOR_TYPE_LABELS, describeWarning, emptyVendorForm, errorCodeOf, errorText, flattenTree, formFromDetail, payloadFromForm, stepProblem, toggleRegion,
  type TreeRow, type VendorDetailData, type VendorWarning,
} from "../../lib/ga-vendors";

// G21 新增與編輯廠商（四步驟：基本、服務、聯絡、合作與帳務；沒有附件步驟，舊版的假附件欄位移除）。
// 失敗一律顯示明確原因（統編重複會指出已存在的那一家）；儲存成功後若有提醒（名稱相近、統編檢查碼）在結果畫面顯示。
const props = defineProps<{ vendor: VendorDetailData | null; categories: TreeRow[]; regions: TreeRow[]; billing: boolean }>();
const emit = defineEmits<{ close: []; saved: [VendorDetailData, VendorWarning[]] }>();
const isNew = !props.vendor;
const form = reactive(props.vendor ? formFromDetail(props.vendor) : emptyVendorForm());
const step = ref(0);
const busy = ref(false);
const error = ref("");
const existing = ref<{ id: string; name: string; status: string } | null>(null);
const expanded = ref<Record<string, boolean>>({});

// 已勾選但已停用（或分類區域權限看不到）的項目要保留顯示：從廠商詳情補進清單。
const catRows = computed<TreeRow[]>(() => {
  const have = new Set(props.categories.map((c) => c.id));
  const extra = (props.vendor?.service_categories || []).filter((c) => !have.has(c.id)).map((c) => ({ id: c.id, name: c.name, code: "", parent_id: null, parent_name: null, description: null, status: c.status, sort_order: 9999, updated_at: "" }));
  return [...props.categories, ...extra];
});
const regRows = computed<TreeRow[]>(() => {
  const have = new Set(props.regions.map((c) => c.id));
  const extra = (props.vendor?.service_regions || []).filter((c) => !have.has(c.id)).map((c) => ({ id: c.id, name: c.name, code: "", parent_id: null, parent_name: null, description: null, status: c.status, sort_order: 9999, updated_at: "", region_type: c.region_type }));
  return [...props.regions, ...extra];
});
const catList = computed(() => flattenTree(catRows.value));
const regList = computed(() => flattenTree(regRows.value));
const regVisible = computed(() => {
  const byId = new Map(regRows.value.map((r) => [r.id, r]));
  const open = (r: TreeRow): boolean => {
    let p = r.parent_id ? byId.get(r.parent_id) : null;
    while (p) { if (!expanded.value[p.id]) return false; p = p.parent_id ? byId.get(p.parent_id) : null; }
    return true;
  };
  return regList.value.filter(open);
});
const hasKids = (id: string) => regRows.value.some((r) => r.parent_id === id);
const wasSelected = (ids: string[], id: string) => ids.includes(id);
const catOff = (c: TreeRow) => c.status !== "active" && !(props.vendor?.service_category_ids || []).includes(c.id);
const regOff = (r: TreeRow) => r.status !== "active" && !(props.vendor?.service_region_ids || []).includes(r.id);
function toggleCat(id: string, on: boolean) {
  const s = new Set(form.service_category_ids);
  if (on) s.add(id); else s.delete(id);
  form.service_category_ids = Array.from(s);
}
function toggleReg(id: string, on: boolean) { form.service_region_ids = toggleRegion(regRows.value, form.service_region_ids, id, on); }
const problem = computed(() => stepProblem(form, step.value, isNew));
function next() {
  if (problem.value) { error.value = problem.value; return; }
  error.value = "";
  step.value = Math.min(step.value + 1, VENDOR_STEPS.length - 1);
}
function jump(i: number) {
  if (i > step.value) for (let s = step.value; s < i; s += 1) { const p = stepProblem(form, s, isNew); if (p) { error.value = p; step.value = s; return; } }
  error.value = "";
  step.value = i;
}
async function save() {
  for (let s = 0; s < VENDOR_STEPS.length; s += 1) { const p = stepProblem(form, s, isNew); if (p) { error.value = p; step.value = s; return; } }
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  existing.value = null;
  try {
    const payload = payloadFromForm(form, props.billing);
    const res = props.vendor
      ? await api<{ data: VendorDetailData; warnings: VendorWarning[] }>(`general-affairs/vendors/${props.vendor.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expected_updated_at: props.vendor.updated_at }) })
      : await api<{ data: VendorDetailData; warnings: VendorWarning[] }>("general-affairs/vendors", { method: "POST", body: JSON.stringify(payload) });
    emit("saved", res.data, res.warnings || []);
  } catch (e) {
    error.value = errorText(e);
    if (errorCodeOf(e) === "TAX_ID_DUPLICATE") step.value = 0;
    const ex = (e as any)?.data?.existing;
    if (ex?.id) existing.value = ex;
  } finally {
    busy.value = false;
  }
}
void describeWarning;
</script>

<template>
  <Modal :title="vendor ? '編輯廠商' : '新增廠商'" wide :busy="busy" @cancel="emit('close')">
    <form class="vf" novalidate data-testid="vendor-form" @submit.prevent="step === VENDOR_STEPS.length - 1 ? save() : next()">
      <ol class="vf-steps" aria-label="填寫步驟">
        <li v-for="(s, i) in VENDOR_STEPS" :key="s"><button type="button" :class="{ on: step === i }" :aria-current="step === i ? 'step' : undefined" :data-testid="'vf-step-' + i" @click="jump(i)">{{ i + 1 }}. {{ s }}</button></li>
      </ol>
      <p v-if="error" class="notice error pre" role="alert" data-testid="vf-error">{{ error }}</p>
      <p v-if="existing" class="notice" data-testid="vf-existing">已存在的廠商：<strong>{{ existing.name }}</strong>。請改到那一家編輯，不要重複建立。</p>

      <section v-show="step === 0" class="vf-grid">
        <label>廠商名稱（必填）<input v-model="form.name" maxlength="100" data-testid="vf-name" /></label>
        <label>別名／品牌<input v-model="form.alias" maxlength="100" data-testid="vf-alias" /></label>
        <label>廠商類型<select v-model="form.vendor_type" data-testid="vf-type"><option v-for="(l, k) in VENDOR_TYPE_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="billing">統一編號（8 碼{{ isNew && form.vendor_type !== 'personal' ? '，必填' : '' }}）<input v-model="form.tax_id" inputmode="numeric" maxlength="12" data-testid="vf-tax" /></label>
        <label>成立日期<input v-model="form.founded_date" type="date" data-testid="vf-founded" /></label>
        <label>公司電話<input v-model="form.phone" maxlength="40" data-testid="vf-phone" /></label>
        <label>傳真<input v-model="form.fax" maxlength="40" /></label>
        <label>網站<input v-model="form.website" maxlength="200" /></label>
        <label>縣市<input v-model="form.city" maxlength="40" /></label>
        <label>行政區<input v-model="form.district" maxlength="40" /></label>
        <label class="wide">公司地址<input v-model="form.address" maxlength="200" /></label>
        <label class="wide check"><input v-model="form.same_service_address" type="checkbox" /> 服務地址同公司地址</label>
        <template v-if="!form.same_service_address">
          <label>服務縣市<input v-model="form.service_city" maxlength="40" /></label>
          <label>服務行政區<input v-model="form.service_district" maxlength="40" /></label>
          <label class="wide">服務地址<input v-model="form.service_address" maxlength="200" /></label>
        </template>
        <label class="wide">簡介<textarea v-model="form.description" rows="2" maxlength="1000" /></label>
      </section>

      <section v-show="step === 1" class="vf-service">
        <fieldset class="vf-tree" data-testid="vf-categories">
          <legend>服務分類（可複選）</legend>
          <p v-if="!catList.length" class="muted">還沒有服務分類，請先到「服務分類」頁建立。</p>
          <label v-for="c in catList" :key="c.id" class="vf-node" :style="{ paddingLeft: c.depth * 18 + 'px' }">
            <input type="checkbox" :checked="wasSelected(form.service_category_ids, c.id)" :disabled="catOff(c)" :data-testid="'vf-cat-' + c.name" @change="toggleCat(c.id, ($event.target as HTMLInputElement).checked)" />
            {{ c.name }}<small v-if="c.status !== 'active'" class="tag-off">已停用</small>
          </label>
        </fieldset>
        <fieldset class="vf-tree" data-testid="vf-regions">
          <legend>服務區域（勾選行政區會一併勾選上層；已勾 {{ form.service_region_ids.length }} 個）</legend>
          <p v-if="!regList.length" class="muted">還沒有服務區域，請先到「服務區域」頁建立。</p>
          <div v-for="r in regVisible" :key="r.id" class="vf-node" :style="{ paddingLeft: ((r as any).depth) * 18 + 'px' }">
            <button v-if="hasKids(r.id)" type="button" class="vf-toggle" :aria-expanded="!!expanded[r.id]" :aria-label="(expanded[r.id] ? '收合' : '展開') + r.name" @click="expanded[r.id] = !expanded[r.id]">{{ expanded[r.id] ? "▾" : "▸" }}</button>
            <span v-else class="vf-toggle" aria-hidden="true" />
            <label><input type="checkbox" :checked="wasSelected(form.service_region_ids, r.id)" :disabled="regOff(r)" :data-testid="'vf-reg-' + r.name" @change="toggleReg(r.id, ($event.target as HTMLInputElement).checked)" /> {{ r.name }}<small v-if="r.status !== 'active'" class="tag-off">已停用</small></label>
          </div>
        </fieldset>
        <div class="vf-grid">
          <label>熟悉品牌（用頓號或逗號分隔）<input v-model="form.brands" /></label>
          <label>可處理的設備類型<input v-model="form.equipment_types" /></label>
          <label>標籤<input v-model="form.tags" data-testid="vf-tags" /></label>
          <label class="wide">服務能力說明<textarea v-model="form.service_capability_note" rows="2" maxlength="1000" /></label>
        </div>
      </section>

      <section v-show="step === 2" class="vf-grid">
        <label>聯絡人<input v-model="form.contact_name" maxlength="60" data-testid="vf-contact" /></label>
        <label>聯絡電話<input v-model="form.contact_phone" maxlength="40" data-testid="vf-contact-phone" /></label>
        <label>LINE ID<input v-model="form.line_id" maxlength="60" /></label>
        <label>Email<input v-model="form.email" type="email" maxlength="120" data-testid="vf-email" /></label>
      </section>

      <section v-show="step === 3" class="vf-grid">
        <label>合作開始日<input v-model="form.cooperation_start_date" type="date" /></label>
        <label>合約到期日<input v-model="form.contract_end_date" type="date" data-testid="vf-contract-end" /></label>
        <label class="check"><input v-model="form.contract_required" type="checkbox" data-testid="vf-contract-required" /> 需簽合約（勾選且有到期日，30 天內到期會出現在待辦）</label>
        <label class="check"><input v-model="form.preferred_vendor" type="checkbox" /> 優先廠商</label>
        <label class="wide">合作備註<textarea v-model="form.cooperation_notes" rows="2" maxlength="1000" /></label>
        <template v-if="billing">
          <label>發票抬頭<input v-model="form.billing_title" maxlength="100" data-testid="vf-billing-title" /></label>
          <label>發票類型<select v-model="form.invoice_type"><option value="">（未指定）</option><option v-for="t in INVOICE_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
          <label class="wide">發票地址<input v-model="form.billing_address" maxlength="200" /></label>
          <label>付款條件<input v-model="form.payment_terms" list="vf-terms" maxlength="100" data-testid="vf-terms" /><datalist id="vf-terms"><option v-for="t in PAYMENT_TERMS" :key="t" :value="t" /></datalist></label>
          <fieldset class="vf-methods"><legend>付款方式</legend><label v-for="m in PAYMENT_METHODS" :key="m" class="check"><input v-model="form.payment_methods" type="checkbox" :value="m" /> {{ m }}</label></fieldset>
          <label class="wide">帳務備註<textarea v-model="form.accounting_notes" rows="2" maxlength="1000" /></label>
        </template>
        <p v-else class="muted wide">帳務欄位（統編、發票、付款條件）只有廠商檢視或管理權限者看得到。</p>
        <p v-if="vendor?.attachment_names?.length" class="muted wide" data-testid="vf-legacy-files">既有檔名（未存檔，只是舊版留下的檔名文字）：{{ vendor.attachment_names.join("、") }}</p>
      </section>

      <div class="dialog-actions">
        <button type="button" data-testid="vf-cancel" :disabled="busy" @click="emit('close')">取消</button>
        <button v-if="step > 0" type="button" data-testid="vf-prev" :disabled="busy" @click="step -= 1">上一步</button>
        <button v-if="step < VENDOR_STEPS.length - 1" type="submit" class="primary" data-testid="vf-next">下一步</button>
        <button v-else type="submit" class="primary" :disabled="busy" data-testid="vf-save">{{ busy ? "儲存中…" : isNew ? "完成新增" : "儲存變更" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.vf { display: grid; gap: 12px; min-width: 0; }
.vf-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.vf-steps button { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); padding: 4px 12px; font-size: 13px; }
.vf-steps button.on { background: var(--soft); border-color: var(--primary); color: var(--primary); font-weight: 700; }
.vf-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.vf-grid label { display: grid; gap: 4px; min-width: 0; }
.vf-grid .wide { grid-column: 1 / -1; }
.vf-grid .check, .vf-methods .check { display: flex; align-items: center; gap: 8px; }
.vf-grid .check input, .vf-methods .check input, .vf-node input[type="checkbox"] { width: auto; min-height: 0; }
.vf-service { display: grid; gap: 12px; }
.vf-tree { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; max-height: 240px; overflow: auto; min-width: 0; }
.vf-node { display: flex; align-items: center; gap: 6px; padding-top: 2px; padding-bottom: 2px; }
.vf-node label { display: flex; align-items: center; gap: 6px; min-height: 0; }
.vf-toggle { width: 22px; min-height: 22px; border: 0; background: none; padding: 0; text-align: center; flex: none; }
.tag-off { border: 1px solid var(--line); border-radius: 10px; padding: 0 6px; font-size: 11px; color: var(--muted); }
.vf-methods { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.pre { white-space: pre-line; }
@media (max-width: 700px) {
  .vf-grid { grid-template-columns: minmax(0, 1fr); }
  .vf-steps button, .dialog-actions button { min-height: 44px; }
}
</style>
