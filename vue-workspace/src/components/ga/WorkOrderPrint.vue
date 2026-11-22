<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import WorkOrderSheet from "./WorkOrderSheet.vue";

// G18 列印工單表單（W7）：A4、15mm、列印時隱藏其他內容（樣式見 style.css 的 .wo-print-output，仿巡店報表 .inspection-print-output）。
// 「包含內部備註」預設不勾，且只有總務端看得到這個勾選；非總務端伺服端一律不給內部內容。
const props = defineProps<{ workOrderId: string; canInternal: boolean }>();
const emit = defineEmits<{ close: [] }>();
const data = ref<any>(null);
const includeInternal = ref(false);
const loading = ref(true);
const printing = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: any }>(`general-affairs/work-orders/${props.workOrderId}/print${includeInternal.value ? "?include_internal=1" : ""}`);
    data.value = res.data;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());
watch(includeInternal, () => void load());

function ready(img: HTMLImageElement) {
  if (img.complete) return img.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error("圖片無法載入"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("圖片載入逾時")), 15000);
    img.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    img.addEventListener("error", () => { clearTimeout(timer); reject(new Error("圖片無法載入")); }, { once: true });
  });
}
async function print() {
  if (!data.value || printing.value) return;
  printing.value = true;
  error.value = "";
  try {
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".wo-print-output img")).map(ready));
    window.print();
  } catch {
    error.value = "部分照片尚未載入成功，請稍後再按一次列印。";
  } finally {
    printing.value = false;
  }
}
const hasData = computed(() => !!data.value);
</script>

<template>
  <Modal title="列印工單表單" wide @cancel="emit('close')">
    <div class="wo-print-dialog" data-testid="wo-print-dialog">
      <p class="muted">預覽的就是列印內容（A4）。要存成 PDF，請在瀏覽器列印視窗選「另存為 PDF」。</p>
      <label v-if="canInternal" class="wo-print-internal"><input v-model="includeInternal" type="checkbox" data-testid="print-include-internal" />包含內部備註與強制結案原因（預設不印，門市看不到的內容請小心使用）</label>
      <p v-if="error" class="field-error" role="alert" data-testid="print-error">{{ error }}</p>
      <p v-if="loading && !data" role="status">載入列印資料…</p>
      <div v-if="hasData" class="wo-print-preview"><WorkOrderSheet :data="data" /></div>
      <div class="dialog-actions">
        <button type="button" data-testid="print-close" @click="emit('close')">關閉</button>
        <button type="button" class="primary" :disabled="!hasData || printing || loading" data-testid="print-go" @click="print">{{ printing ? "準備列印…" : "列印" }}</button>
      </div>
    </div>
  </Modal>
  <Teleport to="body"><div v-if="hasData" class="wo-print-output" data-testid="wo-print-output"><WorkOrderSheet :data="data" /></div></Teleport>
</template>

<style scoped>
.wo-print-dialog { display: grid; gap: 10px; min-width: 0; }
.wo-print-internal { display: flex; gap: 8px; align-items: center; }
.wo-print-preview { max-height: 60vh; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
</style>
