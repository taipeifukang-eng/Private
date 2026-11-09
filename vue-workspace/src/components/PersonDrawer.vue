<script setup lang="ts">
// M5 W21 人員職掌統計抽屜：照舊版 PersonResponsibilityDrawer，只算該部門、只看有效職掌（主責／協作／代理）。
// 部門管理頁已載入職掌時直接帶入 items；公司組織頁沒有職掌資料，打開時才向部門職掌 API 取得該部門資料（組織檢視權限即可，只取職掌與分類）。
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import Modal from "./Modal.vue";
import { assignmentLabels, importanceLabels } from "../department-work";
import { ASSIGNMENT_TYPES, personResponsibilities } from "../../../lib/workspace/organization-rules";
const props = defineProps<{ user: any; departmentId: string; departmentName: string; items?: any[] | null; categories?: any[] | null }>();
const emit = defineEmits<{ close: [] }>();
const loaded = ref<{ items: any[]; categories: any[] } | null>(props.items ? { items: props.items, categories: props.categories || [] } : null);
const error = ref("");
const loading = ref(false);
async function load() {
  if (loaded.value) return;
  loading.value = true;
  error.value = "";
  try {
    const d = await api("department-work?stats=true&department=" + encodeURIComponent(props.departmentId));
    loaded.value = { items: d.items || [], categories: d.categories || [] };
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const stats = computed(() => personResponsibilities(loaded.value?.items || [], props.user.id));
const categoryName = (item: any) => loaded.value?.categories.find((c: any) => c.id === item.category_id)?.name || item.category?.name || "未分類";
const personName = computed(() => [props.user.employee_code, props.user.full_name || props.user.email].filter(Boolean).join(" "));
</script>
<template>
  <Modal title="人員職掌" @cancel="emit('close')">
    <div class="person-drawer" data-testid="person-drawer">
      <div>
        <h3 data-testid="person-drawer-name">{{ personName }}</h3>
        <p class="muted">{{ user.job_title || "未填職稱" }}｜{{ departmentName }}</p>
      </div>
      <p v-if="loading" role="status">載入職掌統計…</p>
      <p v-if="error" role="alert" class="notice error">{{ error }}</p>
      <template v-if="loaded">
        <div class="stat-row" data-testid="person-drawer-stats">
          <div v-for="type in ASSIGNMENT_TYPES" :key="type"><small>{{ assignmentLabels[type] }}</small><strong :data-testid="'stat-' + type">{{ stats[type].length }}</strong></div>
        </div>
        <p v-if="!stats.total" class="empty">此人員目前尚未被指派工作職掌。</p>
        <section v-else v-for="type in ASSIGNMENT_TYPES" :key="type" class="group">
          <h4>{{ assignmentLabels[type] }}工作</h4>
          <p v-if="!stats[type].length" class="muted">無</p>
          <div v-for="item in stats[type]" :key="item.id" class="row"><strong>{{ item.title }}</strong><small>{{ categoryName(item) }} · {{ importanceLabels[item.importance] || item.importance }}</small></div>
        </section>
      </template>
      <div class="dialog-actions"><button type="button" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>
<style scoped>
.person-drawer{display:grid;gap:16px;min-width:min(520px,80vw)}h3,h4{margin:0}.muted,small{color:var(--muted)}.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center}.stat-row div{border:1px solid var(--line);padding:12px}.stat-row small{display:block}.stat-row strong{font-size:24px}.empty{border:1px dashed var(--line);padding:24px;text-align:center}.group{border:1px solid var(--line);padding:12px}.row{display:grid;gap:4px;padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
</style>
