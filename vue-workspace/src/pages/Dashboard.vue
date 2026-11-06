<script setup lang="ts">
// M3 W10 儀表板：統計、徽章與進度條一律以勾選紀錄推算的整體進度為準（B.4）；
// 取代舊版 2 秒輪詢：手動重新整理加 60 秒背景更新（頁籤在前景、分頁可見、沒有在載入時才更新）。
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import { useSession, useWorkspace, type WorkTab } from "../stores";
const props = defineProps<{ tab: WorkTab }>();
const work = useWorkspace(),
  session = useSession(),
  data = ref<any>(null),
  loading = ref(false),
  error = ref("");
let timer: ReturnType<typeof setInterval>;
const labels: Record<string, string> = {
  pending: "待處理",
  in_progress: "進行中",
  completed: "已完成",
};
const now = new Date(),
  monthText = `${now.getFullYear()}年${now.getMonth() + 1}月`;
const canMonthly = computed(() => !!session.data?.capabilities.monthly);
function relative(iso: string | null) {
  if (!iso) return "無活動記錄";
  const diff = Date.now() - new Date(iso).getTime(),
    mins = Math.floor(diff / 60000),
    hours = Math.floor(diff / 3600000),
    days = Math.floor(diff / 86400000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  if (hours < 24) return `${hours} 小時前`;
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-TW");
}
async function load(background = false) {
  if (loading.value) return;
  loading.value = true;
  if (!background) error.value = "";
  try {
    data.value = await api<any>("dashboard");
    error.value = "";
  } catch (e) {
    // 背景更新失敗時保留舊資料，只顯示提示
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function tick() {
  if (document.visibilityState === "visible" && work.active === props.tab.id)
    void load(true);
}
onMounted(() => {
  void load();
  timer = setInterval(tick, 60000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">派發任務 / 儀表板</p>
      <h1>歡迎回來，{{ data?.name || "" }}</h1>
      <p class="muted">每 60 秒自動更新，也可以按右側重新整理。</p>
    </div>
    <button :disabled="loading" @click="load()">
      {{ loading ? "更新中" : "重新整理" }}
    </button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="!data && loading" role="status">載入儀表板…</p>
  <template v-if="data">
    <section v-if="data.stats" class="dash-stats" aria-label="任務統計總覽">
      <div>
        <span>總任務數</span><strong data-stat="total">{{ data.stats.total }}</strong>
      </div>
      <div>
        <span>待處理</span><strong data-stat="pending">{{ data.stats.pending }}</strong>
      </div>
      <div>
        <span>進行中</span><strong data-stat="in_progress">{{ data.stats.in_progress }}</strong>
      </div>
      <div>
        <span>已完成</span><strong data-stat="completed">{{ data.stats.completed }}</strong>
      </div>
    </section>
    <section v-else-if="canMonthly" class="dash-quick" aria-label="快速功能">
      <h2>快速功能</h2>
      <button @click="work.open('monthly')">
        查看本月人員狀態（{{ monthText }}）
      </button>
    </section>
    <h2>我的任務</h2>
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th>專案名稱</th>
            <th>指派使用者</th>
            <th>狀態</th>
            <th>完成進度</th>
            <th>最後活動時間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.records" :key="r.id">
            <td>
              <strong>{{ r.title }}</strong>
              <p class="muted">{{ r.description || "無描述" }}</p>
              <p v-if="r.multiple" class="muted">派發日期 {{ r.created_at.slice(0, 10) }}</p>
              <p v-if="r.sectionChanged" class="muted">區段已變更</p>
            </td>
            <td>{{ r.assignedName || "未命名" }}</td>
            <td>
              <span class="badge" :data-status="r.status">{{ labels[r.status] }}</span>
            </td>
            <td>
              <progress
                :value="r.percent"
                max="100"
                :aria-label="`完成進度 ${r.percent}%`"
              ></progress>
              <span class="dash-percent">{{ r.percent }}%</span>
              <p class="muted">{{ r.overallDone }} / {{ r.overallTotal }}</p>
            </td>
            <td>{{ relative(r.lastActivity) }}</td>
            <td>
              <button @click="work.open('task-runner', '', r.id)">
                查看詳情
              </button>
            </td>
          </tr>
          <tr v-if="!data.records.length">
            <td colspan="6">目前沒有任何任務。建立流程並指派給使用者後，任務會顯示在這裡。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
<style scoped>
.dash-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.dash-stats div {
  border: 1px solid var(--line, #d8ddcf);
  padding: 16px;
}
.dash-stats span {
  display: block;
  color: var(--muted, #6b705f);
}
.dash-stats strong {
  font-size: 28px;
}
.dash-quick {
  margin: 24px 0;
}
.dash-percent {
  margin-left: 8px;
  font-weight: 600;
}
progress {
  width: 120px;
  vertical-align: middle;
}
</style>
