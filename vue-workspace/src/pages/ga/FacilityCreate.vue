<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import UploadPicker from "../../components/UploadPicker.vue";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import FacilityFormFields from "../../components/ga/FacilityFormFields.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { emptyFacilityForm, facilityCreatePayload, validateFacilityForm, type FacilityForm } from "../../lib/ga-assets";
import { openGaPage, useDebounced, useGaGuard } from "../../lib/ga";
import type { PreparedFile } from "../../lib/upload";
import { useWorkspace, type WorkTab } from "../../stores";

// G08 新增設施：沿用舊版新增頁的規則（建檔方式、公司設施架型必選、區域與詳細位置必填、數量與單位、新購要購買日期、保固起訖），
// 離開前有未儲存內容會確認；可一併上傳設施照片與保固文件。建立後自動進入貼標流程（待上傳設施照片），由店長在手機補照片與貼標照。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const form = ref<FacilityForm>(emptyFacilityForm());
const storeId = ref("");
const entryMode = ref<"" | "NEW_PURCHASE" | "EXISTING_ASSET">("");
const errors = ref<Record<string, string>>({});
const error = ref("");
const saving = ref(false);
const result = ref<{ name: string; code: string; attachmentNote: string } | null>(null);
const photoFiles = ref<PreparedFile[]>([]);
const warrantyFiles = ref<PreparedFile[]>([]);
const preparing = ref(false);

type Template = { id: string; code: string; name: string; brand: string | null; model: string | null; category_id: string | null; description: string | null; width_cm: number | null; height_cm: number | null; depth_cm: number | null };
const templateSearch = ref("");
const debouncedTemplate = useDebounced(templateSearch, 250);
const templates = ref<Template[]>([]);
const templateError = ref("");
const picked = ref<Template | null>(null);
async function loadTemplates() {
  try {
    const q = new URLSearchParams({ active: "true", pageSize: "10" });
    if (debouncedTemplate.value.trim()) q.set("search", debouncedTemplate.value.trim());
    templates.value = (await api<{ data: Template[] }>("general-affairs/templates/facility?" + q)).data;
    templateError.value = "";
  } catch (e) {
    templateError.value = (e as Error).message;
  }
}
watch(debouncedTemplate, loadTemplates);
onMounted(loadTemplates);
const dim = (v: number | null) => (v ? v : "-");
function pickTemplate(t: Template | null) {
  picked.value = t;
  form.value.facility_template_id = t?.id || "";
  if (t) {
    if (t.category_id) form.value.category_id = t.category_id;
    if (t.brand) form.value.brand = t.brand;
    form.value.model = t.model || t.code;
    form.value.description = t.description || `${t.name}｜寬 ${dim(t.width_cm)} × 高 ${dim(t.height_cm)} × 深 ${dim(t.depth_cm)} cm`;
  }
  markDirty();
}

function markDirty() {
  props.tab.dirty = true;
  result.value = null;
}
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (!props.tab.dirty) return;
  e.preventDefault();
  e.returnValue = "";
};
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

async function uploadGroup(id: string, purpose: string, files: PreparedFile[]) {
  for (const [i, item] of files.entries()) {
    const fd = new FormData();
    fd.set("resource_type", "FACILITY");
    fd.set("resource_id", id);
    fd.set("purpose", purpose);
    fd.set("is_primary", String(purpose === "PRIMARY_IMAGE" && i === 0));
    fd.append("files", item.file);
    await api("general-affairs/attachments", { method: "POST", body: fd });
  }
}

async function submit() {
  if (saving.value || !allowed.value || preparing.value) return;
  errors.value = validateFacilityForm(form.value, { create: true, needStore: true, storeId: storeId.value, entryMode: entryMode.value });
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await api<{ data: { id: string; name: string; facility_code: string | null } }>("general-affairs/facilities", {
      method: "POST", body: JSON.stringify(facilityCreatePayload(form.value, storeId.value, entryMode.value)),
    });
    let attachmentNote = "";
    if (photoFiles.value.length + warrantyFiles.value.length > 0) {
      try {
        await uploadGroup(res.data.id, "PRIMARY_IMAGE", photoFiles.value);
        await uploadGroup(res.data.id, "WARRANTY_DOCUMENT", warrantyFiles.value);
        attachmentNote = "附件已上傳。";
      } catch (e) {
        attachmentNote = `設施已新增，但附件上傳失敗（${(e as Error).message}），請到設施清冊的詳情重新上傳。`;
      }
    }
    result.value = { name: res.data.name, code: res.data.facility_code || "（尚無設施編號）", attachmentNote };
    props.tab.dirty = false;
    form.value = emptyFacilityForm();
    picked.value = null;
    photoFiles.value = [];
    warrantyFiles.value = [];
    entryMode.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function backToList() {
  openGaPage("ga-facilities");
  work.remove([props.tab.id]);
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 設施管理</p>
      <h1>新增設施</h1>
      <p class="muted">登錄設施到指定門市。建立後會自動產生 QR，並進入貼標流程（店長在手機上傳設施照片與貼標位置照片，總務複核）。</p>
    </div>
    <button @click="backToList">回設施清冊</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '設施管理', '新增設施']">
    <p v-if="result" class="notice success" role="status">
      已新增設施「{{ result.name }}」，設施編號：{{ result.code }}。{{ result.attachmentNote }}
      可以繼續新增，或回設施清冊查看；QR 標籤請到標籤列印頁列印。
    </p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <form class="ga-create" @submit.prevent="submit" @input="markDirty" @change="markDirty">
      <fieldset :disabled="saving" class="top">
        <legend>建檔方式、門市與架型</legend>
        <div class="radios" role="radiogroup" aria-label="建檔方式">
          <label><input v-model="entryMode" type="radio" value="NEW_PURCHASE" /> 新購設施</label>
          <label><input v-model="entryMode" type="radio" value="EXISTING_ASSET" /> 既有設施補登</label>
        </div>
        <span v-if="errors.entry_mode" class="field-error">{{ errors.entry_mode }}</span>
        <AssetSitePicker v-model="storeId" label="所在據點" required :error="errors.store_id" @update:model-value="markDirty" />
        <div class="tpl">
          <label>公司設施架型（必選，選了會帶入分類、品牌、型號、說明）<input v-model="templateSearch" type="search" placeholder="搜尋架型代碼、名稱或尺寸" aria-label="搜尋公司設施架型" /></label>
          <p v-if="picked" class="chosen">已選：{{ picked.code }} {{ picked.name }}<button type="button" @click="pickTemplate(null)">清除</button></p>
          <ul v-else-if="templates.length" class="tpl-list"><li v-for="t in templates" :key="t.id"><button type="button" @click="pickTemplate(t)"><span><b>{{ t.code }}</b> {{ t.name }}</span><small>{{ dim(t.width_cm) }} × {{ dim(t.height_cm) }} × {{ dim(t.depth_cm) }} cm</small></button></li></ul>
          <p v-else-if="templateError" class="field-error" role="alert">{{ templateError }}</p>
          <p v-else class="muted">找不到符合的架型；請先到「公司設施架型」新增。</p>
          <span v-if="errors.facility_template_id" class="field-error">{{ errors.facility_template_id }}</span>
        </div>
      </fieldset>
      <FacilityFormFields v-model="form" mode="create" :disabled="saving" :errors="errors" />
      <fieldset :disabled="saving" class="attach">
        <legend>附件（選填）</legend>
        <div><strong>設施照片</strong><UploadPicker v-model="photoFiles" :max="1" images-only label="選擇設施照片" @busy="(b: boolean) => (preparing = b)" /></div>
        <div><strong>保固文件</strong><UploadPicker v-model="warrantyFiles" :max="3" label="選擇保固文件" @busy="(b: boolean) => (preparing = b)" /></div>
      </fieldset>
      <div class="form-footer"><span>{{ saving ? "儲存中…" : "" }}</span><button type="submit" class="primary" :disabled="saving || preparing">新增設施</button></div>
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
.tpl { display: grid; gap: 8px; }
.tpl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 220px; overflow: auto; }
.tpl-list button { width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 10px; min-height: 44px; }
.tpl-list small { color: var(--muted); }
.chosen { display: flex; align-items: center; gap: 10px; margin: 0; padding: 6px 10px; border-radius: 5px; background: var(--soft); font-weight: 600; }
.attach > div { display: grid; gap: 6px; }
</style>
