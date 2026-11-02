<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
defineProps<{ tab: WorkTab }>();
const work = useWorkspace(),
  rows = ref<any[]>([]),
  loading = ref(false),
  error = ref(""),
  month = ref(""),
  search = ref("");
const monthOf = (s: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(s));
const dateOf = (s: string) =>
  s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "—";
const months = computed(() =>
  Array.from(new Set(rows.value.map((r) => monthOf(r.created_at))))
    .sort()
    .reverse(),
);
const visible = computed(() =>
  rows.value.filter(
    (r) =>
      (!month.value || monthOf(r.created_at) === month.value) &&
      (!search.value || (r.template?.title || "").includes(search.value)),
  ),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    rows.value = (await api<any>("task-archive")).records;
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
      <p class="eyebrow">派發任務 / 歷史紀錄</p>
      <h1>已封存任務</h1>
      <p class="muted">查看執行紀錄，或複製流程為新的本人任務。</p>
    </div>
    <button :disabled="loading" @click="load">重新整理</button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <div class="filter-bar">
    <label
      >建立月份<select v-model="month">
        <option value="">全部月份</option>
        <option v-for="m in months" :key="m">{{ m }}</option>
      </select></label
    ><label>任務名稱<input v-model="search" type="search" /></label>
  </div>
  <p v-if="loading" role="status">載入封存任務…</p>
  <div v-else class="module-table">
    <table>
      <thead>
        <tr>
          <th>任務 / 部門</th>
          <th>建立時間</th>
          <th>完成時間</th>
          <th>封存時間</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.id" :data-record-id="r.id">
          <td>
            <strong>{{ r.template?.title || "範本已不存在" }}</strong>
            <p class="muted">{{ r.department || "未分部門" }}</p>
          </td>
          <td>{{ dateOf(r.created_at) }}</td>
          <td>{{ dateOf(r.completed_at) }}</td>
          <td>{{ dateOf(r.archived_at) }}</td>
          <td>
            <button @click="work.open('task-archive-detail', '', r.id)">
              查看封存紀錄
            </button>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="5">沒有符合條件的封存任務。</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
