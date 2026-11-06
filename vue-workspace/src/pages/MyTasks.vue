<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
defineProps<{ tab: WorkTab }>();
const work = useWorkspace(),
  rows = ref<any[]>([]),
  loading = ref(false),
  error = ref(""),
  department = ref(""),
  status = ref("");
const labels: Record<string, string> = {
  pending: "待處理",
  in_progress: "進行中",
  completed: "已完成",
};
const departments = computed(() => [
  ...new Set(rows.value.map((r) => r.department || "未分部門")),
]);
const visible = computed(() =>
  rows.value.filter(
    (r) =>
      (!department.value ||
        (r.department || "未分部門") === department.value) &&
      (!status.value || r.status === status.value),
  ),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    rows.value = (await api<any>("tasks")).records;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">派發任務 / 個人工作</p>
      <h1>我的任務</h1>
      <p class="muted">開啟指派項目，填寫進度與備註。</p>
    </div>
    <button @click="load" :disabled="loading">重新整理</button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <div class="filter-bar">
    <label
      >部門<select v-model="department">
        <option value="">全部部門</option>
        <option v-for="d in departments" :key="d">{{ d }}</option>
      </select></label
    ><label
      >任務狀態<select v-model="status">
        <option value="">全部狀態（{{ rows.length }}）</option>
        <option v-for="(label, key) in labels" :key="key" :value="key">
          {{ label }}（{{ rows.filter((r) => r.status === key).length }}）
        </option>
      </select></label
    >
  </div>
  <p v-if="loading" role="status">載入任務…</p>
  <div v-else class="module-table">
    <table>
      <thead>
        <tr>
          <th>任務 / 部門</th>
          <th>派發人 / 協作</th>
          <th>我的進度</th>
          <th>整體狀態</th>
          <th>指派日期</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.id">
          <td>
            <strong>{{ r.template.title }}</strong>
            <p class="muted">{{ r.department || "未分部門" }}</p>
            <p v-if="r.sectionChanged" class="muted" data-flag="section-changed">區段已變更，請聯絡派發人員</p>
            <p v-if="r.multiple" class="muted" data-flag="multiple">派發日期 {{ r.created_at.slice(0, 10) }}（同任務有多筆進度）</p>
          </td>
          <td>
            {{ r.creator }}
            <p class="muted">
              {{ r.collaborators.map((c: any) => c.name).join("、") }}
            </p>
          </td>
          <td>我的進度 {{ r.done }} / {{ r.total }}</td>
          <td>
            {{ labels[r.status] || r.status }}
            <p class="muted">整體 {{ r.overallDone }} / {{ r.overallTotal }}</p>
          </td>
          <td>{{ r.created_at.slice(0, 10) }}</td>
          <td>
            <button :disabled="r.sectionChanged" @click="work.open('task-runner', '', r.id)">
              開啟任務
            </button>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="6">沒有符合條件的指派任務。</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
