<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import AssetCategoryPicker from "./AssetCategoryPicker.vue";
import type { PartFormValue } from "../../lib/ga-parts";

// G03 料件欄位表單（新增頁與列表的編輯視窗共用）。
// Q6：有庫存或交易後，基本單位、採購單位與換算率鎖定（unitLocked），並顯示原因。
// Q5：沒有內部備註權限時不顯示備註欄（canSeeNotes）。
const model = defineModel<PartFormValue>({ required: true });
defineProps<{ unitLocked?: boolean; canSeeNotes?: boolean; disabled?: boolean; errors?: Record<string, string> }>();

// D14：採購入庫後可轉成的設備型號（只列啟用中的型號；一個料件只對應一個型號，可清空）。已設定但被停用的型號保留顯示，提醒改選。
const templates = ref<{ id: string; name: string; brand: string | null; model: string | null }[]>([]);
const templateError = ref("");
onMounted(async () => {
  try {
    const res = await api<{ data: { id: string; name: string; brand: string | null; model: string | null }[] }>("general-affairs/templates/equipment?pageSize=100&active=true&sortBy=name&sortDir=asc");
    templates.value = res.data || [];
  } catch {
    templateError.value = "設備型號清單暫時讀不到，不影響其他欄位";
  }
});
const tplText = (t: { name: string; brand: string | null; model: string | null }) => [t.name, t.brand, t.model].filter(Boolean).join(" ");

</script>

<template>
  <div class="part-form">
    <AssetCategoryPicker v-model="model.category_id" type="part" label="料件分類" required :disabled="disabled" :error="errors?.category_id" />
    <label><span>料件名稱<span class="required"> 必填</span></span><input v-model="model.name" maxlength="120" :disabled="disabled" autocomplete="off" /><span v-if="errors?.name" class="field-error">{{ errors.name }}</span></label>
    <div class="two">
      <label>料件代碼<input v-model="model.part_code" maxlength="60" :disabled="disabled" autocomplete="off" /></label>
      <label>條碼<input v-model="model.barcode" maxlength="60" :disabled="disabled" autocomplete="off" /></label>
    </div>
    <div class="three">
      <label>品牌<input v-model="model.brand" maxlength="60" :disabled="disabled" /></label>
      <label>型號<input v-model="model.model" maxlength="60" :disabled="disabled" /></label>
      <label>規格<input v-model="model.specification" maxlength="120" :disabled="disabled" /></label>
    </div>
    <label>說明<input v-model="model.description" maxlength="300" :disabled="disabled" /></label>
    <fieldset class="units">
      <legend>庫存單位</legend>
      <p v-if="unitLocked" class="notice" role="status">這個料件已有庫存或庫存交易紀錄，基本單位、採購單位與換算率已鎖定，不能修改；若單位真的要改，請新增另一個料件。</p>
      <div class="three">
        <label><span>基本庫存單位<span class="required"> 必填</span></span><input v-model="model.base_unit" maxlength="20" :disabled="disabled || unitLocked" placeholder="例如 個、箱" /><span v-if="errors?.base_unit" class="field-error">{{ errors.base_unit }}</span></label>
        <label>採購單位<input v-model="model.purchase_unit" maxlength="20" :disabled="disabled || unitLocked" placeholder="例如 箱" /></label>
        <label>採購換算率<input v-model="model.purchase_to_base_rate" inputmode="decimal" :disabled="disabled || unitLocked || !model.purchase_unit" placeholder="1 個採購單位 = 幾個基本單位" /><span v-if="errors?.purchase_to_base_rate" class="field-error">{{ errors.purchase_to_base_rate }}</span></label>
      </div>
      <div class="three">
        <label>最小領用量<input v-model="model.minimum_issue_qty" inputmode="decimal" :disabled="disabled" /></label>
        <label class="check-row"><input v-model="model.allow_fractional_issue" type="checkbox" :disabled="disabled" /> 允許小數領用</label>
        <label class="check-row"><input v-model="model.allow_unpacking" type="checkbox" :disabled="disabled" /> 允許拆封</label>
      </div>
    </fieldset>
    <label>採購入庫後可轉成的設備型號（選填）
      <select v-model="model.equipment_template_id" :disabled="disabled" data-testid="part-equipment-template">
        <option value="">沒有對應（不會轉成設備）</option>
        <option v-if="model.equipment_template_id && !templates.some((t) => t.id === model.equipment_template_id)" :value="model.equipment_template_id">目前設定的型號（已停用或不在清單，配發時請改選）</option>
        <option v-for="t in templates" :key="t.id" :value="t.id">{{ tplText(t) }}</option>
      </select>
      <span v-if="templateError" class="hint">{{ templateError }}</span>
      <span v-else class="hint">例如印表機料件對應到「某品牌某型號」；採購到貨後配發給門市時，系統依這個型號建立設備。同一個型號可以被多個料件指向。</span>
    </label>
    <label>標籤（以逗號分隔）<input v-model="model.tags" :disabled="disabled" /></label>
    <label v-if="canSeeNotes">內部備註<textarea v-model="model.notes" rows="3" maxlength="1000" :disabled="disabled" /></label>
    <label class="check-row"><input v-model="model.is_active" type="checkbox" :disabled="disabled" /> 啟用中</label>
  </div>
</template>

<style scoped>
.part-form { display: grid; gap: 14px; }
.part-form label { display: grid; gap: 4px; }
.part-form .check-row { display: flex; align-items: center; gap: 8px; }
.part-form .check-row input { width: auto; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.hint { color: var(--muted); font-size: 13px; }
.units { border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 12px; margin: 0; }
textarea { border: 1px solid var(--line); border-radius: 5px; padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink); resize: vertical; }
@media (max-width: 640px) { .two, .three { grid-template-columns: 1fr; } }
</style>
