<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import Modal from "../components/Modal.vue";
import { useWorkspace, type WorkTab } from "../stores";
defineProps<{ tab: WorkTab }>();
const work = useWorkspace(),
  rows = ref<any[]>([]),
  error = ref(""),
  loading = ref(false),
  search = ref(""),
  notice = ref(""),
  target = ref<any>(null),
  kind = ref<"template" | "completed">("template"),
  typed = ref(""),
  deleteError = ref(""),
  busy = ref(false),
  canDeleteAssignment = ref(false);
const visible = computed(() =>
  rows.value.filter((r) => (r.title || "").includes(search.value)),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api<any>("task-management");
    rows.value = data.records;
    canDeleteAssignment.value = !!data.canDeleteAssignment;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function begin(row: any, k: "template" | "completed") {
  target.value = row;
  kind.value = k;
  typed.value = "";
  deleteError.value = "";
}
async function confirmDelete() {
  if (!target.value || busy.value) return;
  busy.value = true;
  deleteError.value = "";
  try {
    const r = await api<any>("task-management", {
      method: "DELETE",
      body: JSON.stringify({
        kind: kind.value,
        id: target.value.id,
        title: kind.value === "template" ? typed.value : undefined,
      }),
    });
    notice.value =
      kind.value === "template"
        ? `已刪除流程模板「${target.value.title}」及其指派、勾選紀錄與協作者。`
        : `已刪除 ${r.deleted} 筆已完成任務${r.failed ? `，另有 ${r.failed} 筆刪除失敗` : ""}。`;
    target.value = null;
    await load();
  } catch (e) {
    deleteError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">派發任務 / 管理</p>
      <h1>任務管理</h1>
      <p class="muted">核對現行指派的進度與執行紀錄。</p>
    </div>
    <div class="button-row">
      <button :disabled="loading" @click="load">重新整理</button
      ><button class="primary" @click="work.open('task-template-editor')">
        建立新任務
      </button>
    </div>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <div class="filter-bar">
    <label>任務名稱<input type="search" v-model="search" /></label>
  </div>
  <p v-if="notice" role="status" class="notice">{{ notice }}</p>
  <p v-if="loading" role="status">載入任務…</p>
  <div v-else class="module-table">
    <table>
      <thead>
        <tr>
          <th>任務範本</th>
          <th>現行指派</th>
          <th>完成項目 / 全部項目</th>
          <th>完成指派</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.id" :data-template-id="r.id">
          <td>
            <strong>{{ r.title }}</strong>
            <p class="muted">{{ r.description }}</p>
          </td>
          <td>
            {{ r.count }}
            <span v-if="r.unassigned" class="badge unassigned-badge">尚未指派</span>
          </td>
          <td>{{ r.done }} / {{ r.total }}</td>
          <td>{{ r.completed }} / {{ r.count }}</td>
          <td class="button-row">
            <button @click="work.open('task-assign', '', r.id)">指派</button>
            <button @click="work.open('task-management-detail', '', r.id)">
              查看管理明細
            </button>
            <button
              v-if="r.canDelete"
              class="danger"
              @click="begin(r, 'template')"
            >
              刪除流程模板
            </button>
            <button
              v-if="canDeleteAssignment && r.count > 0 && r.completed === r.count"
              class="danger"
              @click="begin(r, 'completed')"
            >
              刪除已完成任務
            </button>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="5">沒有符合條件的現行任務。</td>
        </tr>
      </tbody>
    </table>
  </div>
  <Modal
    v-if="target"
    :title="kind === 'template' ? '刪除流程模板' : '刪除已完成任務'"
    :busy="busy"
    @cancel="target = null"
  >
    <template v-if="kind === 'template'">
      <p>
        將永久刪除模板「<strong>{{ target.title }}</strong>」，以及底下所有指派、勾選紀錄與協作者，無法復原。若底下還有待處理或進行中的未封存任務，系統會擋下，請先完成或封存。
      </p>
      <label
        >請輸入模板標題確認<input
          v-model="typed"
          aria-label="輸入模板標題確認刪除"
          autocomplete="off"
      /></label>
    </template>
    <p v-else>
      將永久刪除「{{ target.title }}」底下 {{ target.completedAssignments }}
      筆已完成的任務（含勾選紀錄與協作者），並留下稽核紀錄。
    </p>
    <p v-if="deleteError" role="alert" class="notice error">{{ deleteError }}</p>
    <div class="dialog-actions">
      <button :disabled="busy" @click="target = null">取消</button
      ><button
        class="danger"
        :disabled="busy || (kind === 'template' && typed !== target.title)"
        @click="confirmDelete"
      >
        {{ busy ? "刪除中…" : "確認刪除" }}
      </button>
    </div>
  </Modal>
</template>
<style scoped>
.unassigned-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 10px;
  background: #fff4d6;
  color: #7a5a00;
  font-size: 12px;
}
</style>
