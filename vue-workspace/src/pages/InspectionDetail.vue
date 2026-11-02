<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import Modal from "../components/Modal.vue";
import InspectionContent from "../components/InspectionContent.vue";
const preview = ref("");
const deleteConfirm = ref(false),
  deleted = ref(false);
import { api } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
const work = useWorkspace(),
  session = useSession();
function edit() {
  const tab = work.open(
    "inspection-editor",
    data.value.record.store_id,
    data.value.record.id,
  );
  tab.payload = { type: data.value.record.inspection_type || "supervisor" };
}
const props = defineProps<{ tab: WorkTab }>(),
  data = ref<any>(null),
  error = ref(""),
  loading = ref(false);
function report(id: string) {work.open('improvement-detail',data.value.record.store_id,id);}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await api(`inspection-detail?id=${props.tab.recordId}`);
    if (deleted.value) return;
    data.value = result;
    props.tab.title = `巡店明細 · ${data.value.store?.store_name || ""}`;
  } catch (e) {
    data.value = null;
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function remove() {
  if (props.tab.busy || !data.value) return;
  props.tab.busy = true;
  error.value = "";
  try {
    await api("inspection-detail", {
      method: "DELETE",
      body: JSON.stringify({
        id: props.tab.recordId,
        version: data.value.record.workspace_version,
      }),
    });
    work.deletedInspectionIds.push(props.tab.recordId!);
    deleteConfirm.value = false;
  } catch (e) {
    error.value = (e as Error).message;
    deleteConfirm.value = false;
  } finally {
    props.tab.busy = false;
  }
}
watch(
  () => work.deletedInspectionIds.includes(props.tab.recordId || ""),
  (value) => {
    if (value) {
      deleted.value = true;
      data.value = null;
      props.tab.title = "巡店已刪除";
      preview.value = "";
    }
  },
  { immediate: true },
);
onMounted(() => {
  if (!deleted.value) load();
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 紀錄明細</p>
      <h1>巡店紀錄明細</h1>
    </div>
    <div class="module-actions">
      <button
        v-if="data?.canDelete"
        class="danger"
        :disabled="tab.busy"
        @click="deleteConfirm = true"
      >
        刪除巡店
      </button>
      <button v-if="data?.canEdit" class="primary" @click="edit">
        編輯巡店</button
      ><button @click="load" :disabled="loading || tab.busy || deleted">
        重新整理
      </button>
    </div>
  </header>
  <p v-if="deleted" class="notice" role="status">
    巡店記錄已刪除，相關檢查明細、當班人員與改善回報已一併移除。
  </p>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="loading" role="status">載入巡店明細…</p>
  <template v-else-if="data">
    <InspectionContent :data="data" :can-report="!!session.data?.capabilities.improvements" @preview="preview = $event" @report="report" />
    <section class="inspection-print-action"><h2>列印報表</h2><button class="primary" @click="work.open('inspection-print',data.record.store_id,data.record.id)">列印報表預覽</button></section>
  </template>
  <Modal v-if="preview" title="巡店附件" @cancel="preview = ''">
    <img
      :src="preview"
      alt="巡店附件預覽"
      style="max-width: 100%; max-height: 65vh; object-fit: contain"
    />
    <div class="dialog-actions">
      <button @click="preview = ''">關閉預覽</button>
    </div>
  </Modal>
  <Modal
    v-if="deleteConfirm && data"
    title="刪除巡店記錄"
    :busy="tab.busy"
    @cancel="deleteConfirm = false"
    ><p>
      確定刪除 {{ data.store?.store_name }} 在
      {{ data.record.inspection_date }} 的巡店？
    </p>
    <p>
      將一併刪除 {{ data.results.length }} 筆檢查明細、{{
        data.staff.length
      }}
      筆當班人員及 {{ data.improvements.length }} 筆改善回報，此操作無法復原。
    </p>
    <p>{{ data.record.inspection_no }}</p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="deleteConfirm = false">
        取消刪除</button
      ><button class="danger" :disabled="tab.busy" @click="remove">
        {{ tab.busy ? "刪除中…" : "確認刪除" }}
      </button>
    </div></Modal
  >
</template>

<style scoped>.inspection-print-action{padding:24px 0}.inspection-print-action h2{font-size:18px}</style>
