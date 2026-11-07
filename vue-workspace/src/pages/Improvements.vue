<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession(),
  rows = ref<any[]>([]),
  stores = ref<any[]>([]),
  loading = ref(false),
  error = ref(""),
  status = ref("pending");
const labels: Record<string, string> = {
  all: "全部",
  pending: "待改善",
  overdue: "已逾期",
  improved: "已改善",
};
const scoped = computed(() =>
  rows.value.filter((r) => !props.tab.store || r.store_id === props.tab.store),
);
const visible = computed(() =>
  scoped.value.filter(
    (r) => status.value === "all" || r.status === status.value,
  ),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api<any>("improvements");
    rows.value = data.records;
    stores.value = data.stores;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => work.deletedInspectionIds.length, load);
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 改善追蹤</p>
      <h1>待改善追蹤</h1>
      <p class="muted">依期限追蹤缺失，開啟項目填寫改善說明與照片；剩 2 天內標「急迫」，逾期仍可補報（回補 0 分）。</p>
    </div>
    <button @click="load" :disabled="loading">重新整理</button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <div class="filter-bar">
    <label
      >門市<select aria-label="改善門市" v-model="tab.store">
        <option value="">全部可查看門市</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">
          {{ s.store_code }} {{ s.store_name }}
        </option>
      </select></label
    ><label
      >狀態<select aria-label="改善狀態" v-model="status">
        <option v-for="(label, key) in labels" :key="key" :value="key">
          {{ label }}（{{
            key === "all"
              ? scoped.length
              : scoped.filter((r) => r.status === key).length
          }}）
        </option>
      </select></label
    >
  </div>
  <p v-if="loading" role="status">載入改善項目…</p>
  <div v-else class="module-table">
    <table>
      <thead>
        <tr>
          <th>門市 / 巡店日</th>
          <th>待改善項目</th>
          <th>扣分</th>
          <th>期限 / 狀態</th>
          <th>完成 / 回補</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.id" :data-status="r.status" :data-urgent="r.urgent ? 'true' : 'false'" :class="{ 'row-urgent': r.urgent, 'row-overdue': r.status === 'overdue' }">
          <td>
            {{ r.store?.store_code }} {{ r.store?.store_name }}
            <p>{{ r.inspection_date }} · {{ r.inspector_name }}</p>
          </td>
          <td>
            {{ r.section_name }} / <strong>{{ r.item_name }}</strong>
            <p v-for="item in r.selected_items" :key="item">{{ item }}</p>
          </td>
          <td>{{ r.deduction_amount }}</td>
          <td>
            {{ r.deadline }}
            <p>
              {{ labels[r.status] }}
              <strong v-if="r.urgent" class="badge-urgent" data-testid="urgent-badge">急迫</strong>
            </p>
            <p v-if="r.status === 'pending' || r.status === 'overdue'" data-testid="remaining" :class="{ 'text-danger': r.status === 'overdue' || r.urgent }">{{ r.remaining }}</p>
          </td>
          <td>
            {{
              r.status === "improved"
                ? `${r.days_taken} 天 / +${r.bonus_score} 分`
                : "—"
            }}
          </td>
          <td>
            <button @click="work.open('improvement-detail', r.store_id, r.id)">
              查看與回報
            </button>
            <button v-if="session.data?.capabilities.inspections" data-testid="open-inspection" @click="work.open('inspection-detail', r.store_id, r.inspection_id)">
              查看完整巡店記錄
            </button>
          </td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="6">目前條件沒有改善項目。</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
