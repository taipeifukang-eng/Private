<script setup lang="ts">
// M5 W20：活動排程檢視（取代舊版 /activity-view/[id]）。
// 以 tab.recordId 為活動編號；可見範圍、停用隱藏（Q2）、管轄門市與按鈕條件（Q7）都由伺服器 /api/workspace/activity-view 決定。
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import ActivityPlan from "../components/ActivityPlan.vue";

const props = defineProps<{ tab: WorkTab }>();
const work = useWorkspace();
const data = ref<any>(null);
const loading = ref(true);
const error = ref("");
const denied = ref("");

async function load() {
  // 填報完成後會靜默重新讀取：已有資料時不顯示整頁載入中，避免開著的視窗被收掉。
  loading.value = !data.value;
  error.value = "";
  denied.value = "";
  try {
    const result = await api("activity-view?id=" + encodeURIComponent(props.tab.recordId || ""));
    data.value = result;
    props.tab.title = result.campaign?.name ? "檢視：" + String(result.campaign.name).slice(0, 12) : props.tab.title;
  } catch (e) {
    if (!(e instanceof ApiError && [403, 404].includes(e.status)) && data.value) {
      error.value = (e as Error).message;
      return;
    }
    data.value = null;
    // 無權限直接輸入網址：顯示無權限頁（舊版是跳 alert 再導回列表）。找不到或停用的活動同樣只說「看不到」，不洩漏是否存在。
    if (e instanceof ApiError && [403, 404].includes(e.status)) denied.value = e.message;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const focus = computed(() => props.tab.payload?.focus as string | undefined);
function back() {
  const list = work.tabs.find((t) => t.kind === "activity-view");
  if (list) work.active = list.id;
  else work.open("activity-view");
  if (!props.tab.dirty && !props.tab.busy) work.remove([props.tab.id]);
}
</script>

<template>
  <section class="activity-view-detail" data-testid="activity-view-detail">
    <p v-if="loading" role="status">正在讀取活動排程…</p>
    <div v-else-if="denied" class="empty" role="alert" data-testid="activity-view-denied">
      <h2>無權限查看此活動</h2>
      <p>{{ denied }}</p>
      <button @click="back">返回活動列表</button>
    </div>
    <p v-else-if="error && !data" class="notice error" role="alert">{{ error }}<button @click="load">重試</button></p>
    <template v-else-if="data">
    <p v-if="error" class="notice error" role="alert">{{ error }}<button @click="load">重試</button></p>
    <ActivityPlan
      :key="data.campaign.id"
      :data="data"
      :store="''"
      :viewer="data.viewer"
      :tab="tab"
      :total-stores="data.totalStores"
      :focus="focus"
      back-label="返回活動列表"
      @back="back"
      @retry="load"
    />
    </template>
  </section>
</template>

<style scoped>
.empty{text-align:center;padding:32px 16px;border:1px dashed var(--line,#d9ddd2);border-radius:10px}
</style>
