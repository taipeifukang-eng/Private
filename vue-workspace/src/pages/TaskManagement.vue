<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
defineProps<{ tab: WorkTab }>();
const work = useWorkspace(),
  rows = ref<any[]>([]),
  error = ref(""),
  loading = ref(false),
  search = ref("");
const visible = computed(() =>
  rows.value.filter((r) => (r.title || "").includes(search.value)),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    rows.value = (await api<any>("task-management")).records;
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
          <td>{{ r.count }}</td>
          <td>{{ r.done }} / {{ r.total }}</td>
          <td>{{ r.completed }} / {{ r.count }}</td>
          <td>
            <button @click="work.open('task-management-detail', '', r.id)">
              查看管理明細
            </button>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="5">沒有符合條件的現行任務。</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
