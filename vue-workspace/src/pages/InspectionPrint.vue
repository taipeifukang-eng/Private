<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
import InspectionReport from "../components/InspectionReport.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession(),
  data = ref<any>(null),
  error = ref(""),
  loading = ref(false),
  printing = ref(false);
const removed = computed(() =>
  work.deletedInspectionIds.includes(props.tab.recordId || ""),
);
const active = computed(
  () =>
    work.active === props.tab.id &&
    !session.expired &&
    session.data?.capabilities.inspections &&
    (data.value?.record.inspection_type !== "manager" ||
      session.data?.capabilities.managerInspections) &&
    !removed.value,
);
async function load() {
  loading.value = true;
  error.value = "";
  data.value = null;
  try {
    data.value = await api("inspection-detail?id=" + props.tab.recordId);
    props.tab.title = "巡店報表 · " + data.value.store?.store_name;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function imageReady(img: HTMLImageElement) {
  if (img.complete)
    return img.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error("圖片無法載入"));
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      img.removeEventListener("load", loaded);
      img.removeEventListener("error", failed);
    };
    const loaded = () => {
      finish();
      img.naturalWidth > 0 ? resolve() : reject(new Error("圖片無法載入"));
    };
    const failed = () => {
      finish();
      reject(new Error("圖片無法載入"));
    };
    const timer = window.setTimeout(failed, 15000);
    img.addEventListener("load", loaded, { once: true });
    img.addEventListener("error", failed, { once: true });
  });
}
async function print() {
  if (!active.value) return;
  printing.value = true;
  error.value = "";
  try {
    await Promise.all(
      Array.from(
        document.querySelectorAll<HTMLImageElement>(
          ".inspection-print-output img",
        ),
      ).map(imageReady),
    );
    if (!active.value) {
      error.value = "準備期間已切換工作頁或資料權限變更，請重新確認後列印。";
      return;
    }
    window.print();
  } catch {
    error.value = "部分照片尚未載入成功，請重新整理後再列印。";
  } finally {
    printing.value = false;
  }
}
watch(removed, (value) => {
  if (value) data.value = null;
});
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 列印預覽</p>
      <h1>巡店報表預覽</h1>
      <p class="muted">列印此份報告；可在瀏覽器列印視窗選擇儲存為 PDF。</p>
    </div>
    <div class="module-actions">
      <button @click="load" :disabled="loading || printing || removed">
        重新整理</button
      ><button
        class="primary"
        @click="print"
        :disabled="!data || loading || printing || removed"
      >
        {{ printing ? "準備列印…" : "列印報表" }}
      </button>
    </div>
  </header>
  <p v-if="removed" class="notice" role="status">
    此巡店已刪除，無法繼續列印。
  </p>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="loading" role="status">載入巡店報表…</p>
  <InspectionReport v-if="data && !removed" :data="data" /><Teleport to="body"
    ><div v-if="data && active" class="inspection-print-output">
      <InspectionReport :data="data" /></div
  ></Teleport>
</template>
