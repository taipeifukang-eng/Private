<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import UploadPicker from "../../components/UploadPicker.vue";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import EquipmentFormFields from "../../components/ga/EquipmentFormFields.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { emptyEquipmentForm, equipmentCreatePayload, validateEquipmentForm, type EquipmentForm } from "../../lib/ga-assets";
import { openGaPage, useDebounced, useGaGuard } from "../../lib/ga";
import type { PreparedFile } from "../../lib/upload";
import { useWorkspace, type WorkTab } from "../../stores";

// G07 新增設備：一次 1 到 100 台（每台資產編號與 QR 各自獨立）、任一編號重複整批失敗（單一資料庫陳述式，全成或全不變）、
// 離開前有未儲存內容會確認、可一併上傳設備照片／貼標位置照片／保固文件（只在新增 1 台時；多台請建立後逐台補）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const form = ref<EquipmentForm>(emptyEquipmentForm());
const storeId = ref("");
const entryMode = ref<"NEW_PURCHASE" | "EXISTING_ASSET">("NEW_PURCHASE");
const quantity = ref("1");
const errors = ref<Record<string, string>>({});
const error = ref("");
const saving = ref(false);
const result = ref<{ count: number; codes: string[]; attachmentNote: string } | null>(null);
const primaryFiles = ref<PreparedFile[]>([]);
const labelFiles = ref<PreparedFile[]>([]);
const warrantyFiles = ref<PreparedFile[]>([]);
const preparing = ref(false);

// 型號（公司設備）：選了之後帶入分類、名稱、品牌、型號。沒有型號查看權限時整區不顯示。
type Template = { id: string; name: string; brand: string | null; model: string | null; category_id: string; default_warranty_months: number | null; category?: { name: string } | null };
const templateSearch = ref("");
const debouncedTemplate = useDebounced(templateSearch, 250);
const templates = ref<Template[]>([]);
const templateOk = ref(true);
const pickedTemplate = ref<Template | null>(null);
async function loadTemplates() {
  try {
    const q = new URLSearchParams({ active: "true", pageSize: "10" });
    if (debouncedTemplate.value.trim()) q.set("search", debouncedTemplate.value.trim());
    templates.value = (await api<{ data: Template[] }>("general-affairs/templates/equipment?" + q)).data;
  } catch {
    templateOk.value = false;
  }
}
watch(debouncedTemplate, loadTemplates);
onMounted(loadTemplates);
function pickTemplate(t: Template | null) {
  pickedTemplate.value = t;
  form.value.template_id = t?.id || "";
  if (t) Object.assign(form.value, { category_id: t.category_id, name: t.name, brand: t.brand || "", model: t.model || "" });
  markDirty();
}

function markDirty() {
  props.tab.dirty = true;
  result.value = null;
}
// 瀏覽器分頁關閉或重新整理前也要確認（頁籤關閉由工作台的未儲存提示處理）。
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (!props.tab.dirty) return;
  e.preventDefault();
  e.returnValue = "";
};
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

async function uploadGroup(equipmentId: string, purpose: string, files: PreparedFile[]) {
  // 一次請求合計不能超過 4.25MB：逐張上傳最穩。
  for (const [i, item] of files.entries()) {
    const fd = new FormData();
    fd.set("resource_type", "EQUIPMENT");
    fd.set("resource_id", equipmentId);
    fd.set("purpose", purpose);
    fd.set("is_primary", String(purpose === "PRIMARY_IMAGE" && i === 0));
    fd.append("files", item.file);
    await api("general-affairs/attachments", { method: "POST", body: fd });
  }
}

async function submit() {
  if (saving.value || !allowed.value || preparing.value) return;
  const qty = Number(quantity.value);
  errors.value = validateEquipmentForm(form.value, { needStore: true, storeId: storeId.value, quantity: qty });
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await api<{ data: { id: string }; items: { id: string; asset_code: string | null }[]; createdCount: number }>("general-affairs/equipment", {
      method: "POST", body: JSON.stringify(equipmentCreatePayload(form.value, storeId.value, qty, entryMode.value)),
    });
    let attachmentNote = "";
    const hasFiles = primaryFiles.value.length + labelFiles.value.length + warrantyFiles.value.length > 0;
    if (res.createdCount === 1 && hasFiles) {
      try {
        await uploadGroup(res.data.id, "PRIMARY_IMAGE", primaryFiles.value);
        await uploadGroup(res.data.id, "LABEL_POSITION_IMAGE", labelFiles.value);
        await uploadGroup(res.data.id, "WARRANTY_DOCUMENT", warrantyFiles.value);
        attachmentNote = "附件已上傳。";
      } catch (e) {
        attachmentNote = `設備已新增，但附件上傳失敗（${(e as Error).message}），請到設備清冊的詳情重新上傳。`;
      }
    }
    result.value = { count: res.createdCount, codes: res.items.map((i) => i.asset_code || "（尚無資產編號）"), attachmentNote };
    props.tab.dirty = false;
    form.value = emptyEquipmentForm();
    pickedTemplate.value = null;
    primaryFiles.value = [];
    labelFiles.value = [];
    warrantyFiles.value = [];
    quantity.value = "1";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function backToList() {
  openGaPage("ga-equipment");
  work.remove([props.tab.id]);
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 設備管理</p>
      <h1>新增設備</h1>
      <p class="muted">登錄設備到指定門市。一次可新增 1 到 100 台，每台各自產生資產編號與 QR；任何一台失敗（例如編號重複），這一批都不會建立。</p>
    </div>
    <button @click="backToList">回設備清冊</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '設備管理', '新增設備']">
    <p v-if="result" class="notice success" role="status">
      已新增 {{ result.count }} 台設備。資產編號：{{ result.codes.slice(0, 5).join("、") }}<template v-if="result.codes.length > 5">…（共 {{ result.codes.length }} 台）</template>。{{ result.attachmentNote }}
      可以繼續新增，或回設備清冊查看；QR 標籤請到標籤列印頁列印。
    </p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <form class="ga-create" @submit.prevent="submit" @input="markDirty" @change="markDirty">
      <fieldset :disabled="saving" class="top">
        <legend>建檔方式與門市</legend>
        <div class="radios" role="radiogroup" aria-label="建檔方式">
          <label><input v-model="entryMode" type="radio" value="NEW_PURCHASE" /> 新購／新開店設備</label>
          <label><input v-model="entryMode" type="radio" value="EXISTING_ASSET" /> 既有資產補登</label>
        </div>
        <AssetSitePicker v-model="storeId" label="所屬門市" required :error="errors.store_id" @update:model-value="markDirty" />
        <label>新增數量（1 到 100）<input v-model="quantity" inputmode="numeric" aria-label="新增數量" /><span v-if="errors.quantity" class="field-error">{{ errors.quantity }}</span></label>
        <div v-if="templateOk" class="tpl">
          <label>公司設備型號（選填，選了會帶入分類、名稱、品牌、型號）<input v-model="templateSearch" type="search" placeholder="搜尋型號名稱、品牌" /></label>
          <p v-if="pickedTemplate" class="chosen">已選：{{ pickedTemplate.name }}<button type="button" @click="pickTemplate(null)">清除</button></p>
          <ul v-else-if="templates.length" class="tpl-list"><li v-for="t in templates" :key="t.id"><button type="button" @click="pickTemplate(t)">{{ t.name }}<small>{{ [t.brand, t.model].filter(Boolean).join(" ") }}</small></button></li></ul>
        </div>
      </fieldset>
      <EquipmentFormFields v-model="form" mode="create" :disabled="saving" :errors="errors" :code-hint="Number(quantity) > 1 ? '一次新增多台時資產編號由系統自動產生（需有購買日期）' : undefined" />
      <fieldset :disabled="saving" class="attach">
        <legend>附件（新增 1 台時可一併上傳）</legend>
        <p v-if="Number(quantity) > 1" class="muted">一次新增多台時不能一起上傳附件，請建立後到清冊詳情逐台補上；店長也會在「貼標待辦」補照片。</p>
        <template v-else>
          <div><strong>設備照片</strong><UploadPicker v-model="primaryFiles" :max="1" images-only label="選擇設備照片" @busy="(b: boolean) => (preparing = b)" @change="markDirty" /></div>
          <div><strong>標籤貼附位置照片</strong><UploadPicker v-model="labelFiles" :max="1" images-only label="選擇貼標位置照片" @busy="(b: boolean) => (preparing = b)" /></div>
          <div><strong>保固文件</strong><UploadPicker v-model="warrantyFiles" :max="3" label="選擇保固文件" @busy="(b: boolean) => (preparing = b)" /></div>
        </template>
      </fieldset>
      <div class="form-footer"><span>{{ saving ? "儲存中…" : "" }}</span><button type="submit" class="primary" :disabled="saving || preparing">新增設備</button></div>
    </form>
  </GaShell>
</template>

<style scoped>
.ga-create { max-width: 900px; display: grid; gap: 16px; }
fieldset { border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 12px; margin: 0; min-width: 0; background: var(--surface); }
legend { font-size: 13px; font-weight: 700; padding: 0 8px; }
label { display: grid; gap: 4px; }
.radios { display: flex; flex-wrap: wrap; gap: 18px; }
.radios label { display: flex; align-items: center; gap: 6px; }
.radios input { width: auto; }
.tpl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 180px; overflow: auto; }
.tpl-list button { width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 10px; }
.tpl-list small { color: var(--muted); }
.chosen { display: flex; align-items: center; gap: 10px; margin: 0; padding: 6px 10px; border-radius: 5px; background: var(--soft); font-weight: 600; }
.attach > div { display: grid; gap: 6px; }
</style>
