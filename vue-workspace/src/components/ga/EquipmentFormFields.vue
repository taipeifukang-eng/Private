<script setup lang="ts">
import AssetCategoryPicker from "./AssetCategoryPicker.vue";
import { CRITICALITY_LABEL, EQUIPMENT_STATUS_LABEL, WARRANTY_CLAIM_METHODS, type EquipmentForm } from "../../lib/ga-assets";

// 設備欄位表單（新增頁與清冊編輯視窗共用）。所屬門市不在這裡：新增時由頁面選擇，編輯時不能改（改走轉移單或「更正所屬門市」）。
const model = defineModel<EquipmentForm>({ required: true });
defineProps<{ mode: "create" | "edit"; disabled?: boolean; errors?: Record<string, string>; codeHint?: string }>();
</script>

<template>
  <div class="equip-form">
    <fieldset>
      <legend>基本資料</legend>
      <AssetCategoryPicker v-model="model.category_id" type="equipment" label="設備分類" required :disabled="disabled" :error="errors?.category_id" />
      <label><span>設備名稱<span class="required"> 必填</span></span><input v-model="model.name" maxlength="120" :disabled="disabled" autocomplete="off" /><span v-if="errors?.name" class="field-error">{{ errors.name }}</span></label>
      <div class="grid3">
        <label>品牌<input v-model="model.brand" maxlength="60" :disabled="disabled" /></label>
        <label>型號<input v-model="model.model" maxlength="60" :disabled="disabled" /></label>
        <label>序號<input v-model="model.serial_number" maxlength="80" :disabled="disabled" /></label>
      </div>
      <div class="grid3">
        <label>狀態<select v-model="model.status" :disabled="disabled"><option v-for="(label, value) in EQUIPMENT_STATUS_LABEL" :key="value" :value="value">{{ label }}</option></select></label>
        <label>重要程度<select v-model="model.criticality" :disabled="disabled"><option v-for="(label, value) in CRITICALITY_LABEL" :key="value" :value="value">{{ label }}</option></select></label>
        <label>條碼<input v-model="model.barcode" maxlength="60" :disabled="disabled" /></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>位置與安裝</legend>
      <div class="grid2">
        <label>區域<input v-model="model.area" maxlength="60" :disabled="disabled" placeholder="例如 賣場、倉庫" /></label>
        <label>放置位置<input v-model="model.location_detail" maxlength="120" :disabled="disabled" placeholder="例如 收銀台旁" /></label>
      </div>
      <div class="grid2">
        <label>用途<input v-model="model.purpose" maxlength="120" :disabled="disabled" /></label>
        <label>安裝日期<input v-model="model.installed_at" type="date" :disabled="disabled" /></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>購買與保固</legend>
      <div class="grid3">
        <label>購買日期<input v-model="model.purchased_at" type="date" :disabled="disabled" /></label>
        <label>購買金額（每台）<input v-model="model.purchase_amount" inputmode="decimal" :disabled="disabled" /><span v-if="errors?.purchase_amount" class="field-error">{{ errors.purchase_amount }}</span></label>
        <label>購買來源／供應商<input v-model="model.purchase_source_supplier" maxlength="120" :disabled="disabled" placeholder="例如 原廠、經銷商、網購平台" /></label>
      </div>
      <label class="check"><input v-model="model.has_warranty" type="checkbox" :disabled="disabled" /> 有保固</label>
      <template v-if="model.has_warranty">
        <div class="grid2">
          <label>保固到期日<input v-model="model.warranty_end_date" type="date" :disabled="disabled" /><span v-if="errors?.warranty_end_date" class="field-error">{{ errors.warranty_end_date }}</span></label>
          <label>申請保固方式<select v-model="model.warranty_claim_method" :disabled="disabled"><option v-for="m in WARRANTY_CLAIM_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option></select></label>
        </div>
        <label v-if="model.warranty_claim_method === 'OTHER'">其他保固方式備註<input v-model="model.warranty_claim_notes" maxlength="300" :disabled="disabled" /></label>
      </template>
    </fieldset>
    <fieldset>
      <legend>其他</legend>
      <label>資產編號<input v-model="model.asset_code" maxlength="60" :disabled="disabled" autocomplete="off" aria-describedby="code-hint" /><small id="code-hint" class="muted">{{ codeHint || (mode === 'create' ? '留空：有填購買日期時由系統自動產生' : '可修改；修改後已印出的 QR 標籤編號要重新列印') }}</small><span v-if="errors?.asset_code" class="field-error">{{ errors.asset_code }}</span></label>
      <label>標籤（以逗號分隔）<input v-model="model.tags" :disabled="disabled" /></label>
      <label>備註<textarea v-model="model.notes" rows="3" maxlength="1000" :disabled="disabled" /></label>
    </fieldset>
  </div>
</template>

<style scoped>
.equip-form { display: grid; gap: 16px; }
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
