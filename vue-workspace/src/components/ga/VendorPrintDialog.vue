<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import VendorPrintSheet from "./VendorPrintSheet.vue";
import { errorText, type TreeRow } from "../../lib/ga-vendors";

// G21 廠商填寫表預覽與列印：只列啟用的服務分類與縣市。預覽的就是列印內容（A4），要存 PDF 請在瀏覽器列印視窗選「另存為 PDF」。
const emit = defineEmits<{ close: [] }>();
const cats = ref<TreeRow[]>([]);
const regs = ref<TreeRow[]>([]);
const loading = ref(true);
const error = ref("");
onMounted(async () => {
  try {
    const [c, r] = await Promise.all([
      api<{ data: TreeRow[] }>("general-affairs/service-categories?options=1&status=active"),
      api<{ data: TreeRow[] }>("general-affairs/service-regions?options=1&status=active&regionType=city"),
    ]);
    cats.value = c.data;
    regs.value = r.data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
});
function print() { window.print(); }
</script>

<template>
  <Modal title="廠商填寫表（空白表單）" wide @cancel="emit('close')">
    <div class="vpd" data-testid="vendor-print-dialog">
      <p class="muted">給新廠商填的空白紙本表單，只印啟用中的服務分類與縣市。</p>
      <p v-if="error" class="notice error" role="alert" data-testid="print-error">{{ error }}</p>
      <p v-if="loading" role="status">載入中…</p>
      <div v-else class="vpd-preview"><VendorPrintSheet :categories="cats" :regions="regs" /></div>
      <div class="dialog-actions">
        <button type="button" data-testid="print-close" @click="emit('close')">關閉</button>
        <button type="button" class="primary" :disabled="loading || !!error" data-testid="print-go" @click="print">列印</button>
      </div>
    </div>
  </Modal>
  <Teleport to="body"><div v-if="!loading && !error" class="vendor-print-output" data-testid="vendor-print-output"><VendorPrintSheet :categories="cats" :regions="regs" /></div></Teleport>
</template>

<style scoped>
.vpd { display: grid; gap: 10px; min-width: 0; }
.vpd-preview { max-height: 60vh; overflow: auto; }
</style>
