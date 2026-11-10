<script setup lang="ts">
import { computed } from "vue";
import AssetCategoryPicker from "./AssetCategoryPicker.vue";
import { CRITICALITY_LABEL, FACILITY_STATUS_LABEL, FACILITY_STORE_AREAS, WARRANTY_CLAIM_METHODS, warrantyMonths, type FacilityForm } from "../../lib/ga-assets";

// 設施欄位表單（新增頁與清冊編輯視窗共用）。所屬門市不在這裡：新增時由頁面選擇，編輯時不能改（改走轉移單或「更正所屬門市」）。
const model = defineModel<FacilityForm>({ required: true });
defineProps<{ mode: "create" | "edit"; disabled?: boolean; errors?: Record<string, string>; openTransferNo?: string | null }>();
const months = computed(() => warrantyMonths(model.value.warranty_start_date, model.value.warranty_end_date));
</script>

<template>
  <div class="fac-form">
    <fieldset>
      <legend>基本資料</legend>
      <AssetCategoryPicker v-model="model.category_id" type="facility" label="設施分類" required :disabled="disabled" :error="errors?.category_id" />
      <label><span>設施名稱<span class="required"> 必填</span></span><input v-model="model.name" maxlength="120" :disabled="disabled" autocomplete="off" /><span v-if="errors?.name" class="field-error">{{ errors.name }}</span></label>
      <div class="grid3">
        <label>狀態<select v-model="model.status" :disabled="disabled" aria-label="狀態"><option v-for="(label, value) in FACILITY_STATUS_LABEL" :key="value" :value="value" :disabled="!!openTransferNo && value === 'RETIRED' && model.status !== value">{{ label }}</option></select><small v-if="openTransferNo" class="muted" data-testid="status-locked-hint">有進行中的轉移單 {{ openTransferNo }}，要退役請先<a href="#/open/ga-transfers">到轉移單取消</a>。</small></label>
        <label>重要程度<select v-model="model.criticality" :disabled="disabled"><option v-for="(label, value) in CRITICALITY_LABEL" :key="value" :value="value">{{ label }}</option></select></label>
        <label>設施編號<input v-model="model.facility_code" maxlength="60" :disabled="disabled" autocomplete="off" /><small class="muted">{{ mode === "create" ? "留空表示尚無編號" : "可修改；修改後已印出的 QR 標籤編號要重新列印" }}</small></label>
      </div>
      <div class="grid2">
        <label>品牌<input v-model="model.brand" maxlength="60" :disabled="disabled" /></label>
        <label>型號<input v-model="model.model" maxlength="60" :disabled="disabled" /></label>
      </div>
      <label>說明<input v-model="model.description" maxlength="300" :disabled="disabled" /></label>
    </fieldset>
    <fieldset>
      <legend>位置與數量</legend>
      <div class="grid2">
        <label><span>區域<span v-if="mode === 'create'" class="required"> 必填</span></span>
          <input v-model="model.area" list="fac-area-options" maxlength="60" :disabled="disabled" placeholder="例如 收銀區、倉庫" />
          <datalist id="fac-area-options"><option v-for="a in FACILITY_STORE_AREAS" :key="a" :value="a" /></datalist>
          <span v-if="errors?.area" class="field-error">{{ errors.area }}</span></label>
        <label><span>詳細位置<span v-if="mode === 'create'" class="required"> 必填</span></span><input v-model="model.location_detail" maxlength="120" :disabled="disabled" placeholder="例如 入口右側牆面" /><span v-if="errors?.location_detail" class="field-error">{{ errors.location_detail }}</span></label>
      </div>
      <label>位置補充（面積、樓層等）<input v-model="model.floor_area_description" maxlength="200" :disabled="disabled" /></label>
      <div class="grid3">
        <label><span>數量<span class="required"> 必填</span></span><input v-model="model.quantity" inputmode="decimal" :disabled="disabled" /><span v-if="errors?.quantity" class="field-error">{{ errors.quantity }}</span></label>
        <label><span>單位<span class="required"> 必填</span></span><input v-model="model.unit" maxlength="10" :disabled="disabled" /><span v-if="errors?.unit" class="field-error">{{ errors.unit }}</span></label>
        <label>每單位購買金額<input v-model="model.purchase_unit_amount" inputmode="decimal" :disabled="disabled" /><span v-if="errors?.purchase_unit_amount" class="field-error">{{ errors.purchase_unit_amount }}</span></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>日期</legend>
      <div class="grid3">
        <label><span>購買日期<span v-if="mode === 'create'" class="muted"> （新購設施必填）</span></span><input v-model="model.purchased_at" type="date" :disabled="disabled" /><span v-if="errors?.purchased_at" class="field-error">{{ errors.purchased_at }}</span></label>
        <label>安裝日期<input v-model="model.installed_at" type="date" :disabled="disabled" /></label>
        <label>最近整修日期<input v-model="model.last_renovated_at" type="date" :disabled="disabled" /></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>保固</legend>
      <label class="check"><input v-model="model.has_warranty" type="checkbox" :disabled="disabled" /> 有保固</label>
      <template v-if="model.has_warranty">
        <div class="grid3">
          <label>保固開始日期<input v-model="model.warranty_start_date" type="date" :disabled="disabled" /><span v-if="errors?.warranty_start_date" class="field-error">{{ errors.warranty_start_date }}</span></label>
          <label>保固到期日期<input v-model="model.warranty_end_date" type="date" :disabled="disabled" /><span v-if="errors?.warranty_end_date" class="field-error">{{ errors.warranty_end_date }}</span></label>
          <label>申請保固方式<select v-model="model.warranty_claim_method" :disabled="disabled"><option v-for="m in WARRANTY_CLAIM_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option></select></label>
        </div>
        <p class="muted">保固年限：{{ months === null ? "填寫起訖日期後自動計算" : `約 ${months} 個月` }}</p>
        <label>保固說明<input v-model="model.warranty_description" maxlength="200" :disabled="disabled" placeholder="例如：依供應商施工保固一年" /></label>
        <label v-if="model.warranty_claim_method === 'OTHER'">其他保固方式備註<textarea v-model="model.warranty_claim_notes" rows="2" maxlength="300" :disabled="disabled" placeholder="申請保固時需要準備的資料、聯絡方式或供應商要求" /></label>
      </template>
    </fieldset>
    <fieldset>
      <legend>其他</legend>
      <label>標籤（以逗號分隔）<input v-model="model.tags" :disabled="disabled" /></label>
      <label>備註<textarea v-model="model.notes" rows="3" maxlength="1000" :disabled="disabled" /></label>
    </fieldset>
  </div>
</template>

<style scoped>
.fac-form { display: grid; gap: 16px; }
fieldset { border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 12px; margin: 0; min-width: 0; }
legend { font-size: 13px; font-weight: 700; padding: 0 8px; }
label { display: grid; gap: 4px; min-width: 0; }
label.check { display: flex; align-items: center; gap: 8px; }
label.check input { width: auto; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
textarea { border: 1px solid var(--line); border-radius: 5px; padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink); resize: vertical; }
@media (max-width: 640px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
</style>
