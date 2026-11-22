<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import UploadPicker from "../UploadPicker.vue";
import { newKey } from "../../lib/ga-requests";
import { PRIORITY_LABEL, type WoCategory } from "../../lib/ga-work-orders";
import type { PreparedFile } from "../../lib/upload";

// G19 跨部門頁「新增舊式回報」（最小移植：標題、說明、最多 5 張照片，不增欄位）。
// 送出用固定識別防連點重複建立；內容一變就換新識別。照片只收圖片，失敗全回復（伺服端處理）。
const props = defineProps<{ categories: WoCategory[]; allStores: boolean }>();
const emit = defineEmits<{ close: []; created: [woNo: string] }>();
type Store = { id: string; store_code: string; store_name: string; short_name: string | null };
const stores = ref<Store[]>([]);
const f = reactive({ storeId: "", title: "", description: "", contactName: "", contactPhone: "", priority: "normal", categoryId: "" });
const photos = ref<PreparedFile[]>([]);
const photoBusy = ref(false);
const busy = ref(false);
const error = ref("");
let key = newKey();
watch([f, photos], () => { key = newKey(); }, { deep: true });

onMounted(async () => {
  try {
    const res = await api<{ data: Store[] }>(`general-affairs/sites?type=store&scope=${props.allStores ? "all" : "mine"}&pageSize=100`);
    stores.value = res.data;
    if (stores.value.length === 1) f.storeId = stores.value[0].id;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function submit() {
  if (busy.value || photoBusy.value) return;
  error.value = "";
  if (!f.storeId) { error.value = "請選擇門市"; return; }
  if (!f.title.trim()) { error.value = "請填寫標題"; return; }
  busy.value = true;
  try {
    const fd = new FormData();
    fd.set("store_id", f.storeId);
    fd.set("title", f.title.trim());
    if (f.description.trim()) fd.set("description", f.description.trim());
    if (f.contactName.trim()) fd.set("contact_name", f.contactName.trim());
    if (f.contactPhone.trim()) fd.set("contact_phone", f.contactPhone.trim());
    fd.set("priority", f.priority);
    if (f.categoryId) fd.set("category_id", f.categoryId);
    fd.set("idempotency_key", key);
    for (const p of photos.value) fd.append("files", p.file, p.file.name);
    const res = await api<{ data: { wo_no: string } }>("general-affairs/cross-dept-maintenance", { method: "POST", body: fd });
    emit("created", res.data.wo_no);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="新增維修回報" :busy="busy" @cancel="emit('close')">
    <form class="woc" novalidate data-testid="wo-create-form" @submit.prevent="submit">
      <label>門市（必填）<select v-model="f.storeId" data-testid="c-store"><option value="">請選擇</option><option v-for="s in stores" :key="s.id" :value="s.id">{{ s.store_code }} {{ s.short_name || s.store_name }}</option></select></label>
      <label>標題（必填）<input v-model="f.title" maxlength="200" data-testid="c-title" /></label>
      <label>問題說明<textarea v-model="f.description" rows="4" maxlength="2000" data-testid="c-description" /></label>
      <label>聯絡窗口<input v-model="f.contactName" maxlength="100" data-testid="c-contact" /></label>
      <label>聯絡電話<input v-model="f.contactPhone" maxlength="50" inputmode="tel" data-testid="c-phone" /></label>
      <label>優先順序<select v-model="f.priority" data-testid="c-priority"><option v-for="(l, k) in PRIORITY_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
      <label>維修分類<select v-model="f.categoryId" data-testid="c-category"><option value="">（不分類）</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <UploadPicker v-model="photos" images-only :max="5" label="附照片（最多 5 張）" :disabled="busy" @busy="photoBusy = $event" />
      <p v-if="error" class="field-error" role="alert" data-testid="c-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button type="submit" class="primary" :disabled="busy || photoBusy" data-testid="c-submit">{{ busy ? "送出中…" : "送出回報" }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.woc { display: grid; gap: 10px; min-width: 0; }
.woc label { display: grid; gap: 4px; }
</style>
