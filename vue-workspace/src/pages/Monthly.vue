<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { api, type Store } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import MonthlyTools from "../components/MonthlyTools.vue";
const revision = ref(0);
const globalToolsTarget=ref<HTMLElement>(),storeToolsTarget=ref<HTMLElement>();
const positionOrder: Record<string,number> = {'總經理':1,'副總經理':2,'資深經理':3,'經理':4,'督導':5,'督導(代理店長)':6,'店長':7,'代理店長':8,'副店長':9,'主任':10,'資深副理':11,'副理':12,'組長':13,'資深專員':14,'高級專員':15,'專員':16,'出納專員':17,'助理':18,'新人':19,'行政':19,'兼職':20,'實習生':21};
const props = defineProps<{ tab: WorkTab }>();
const work = useWorkspace();
const stores = ref<Store[]>([]),
  rows = ref<any[]>([]),
  error = ref(""),
  loading = ref(false),
  permissions = ref<any>({}),
  confirmation = ref("");
const status: Record<string, string> = {
  draft: "草稿",
  submitted: "待確認",
  confirmed: "已確認",
};
const labels: Record<string, string> = {
  full_month: "整月在職",
  new_hire: "本月新進",
  resigned: "離職",
  leave_of_absence: "留停",
  transferred_in: "調入",
  transferred_out: "調出",
  promoted: "升職",
  support_rotation: "支援卡班",
  dual_store_manager: "雙店長",
  leave_return: "復職",
};
const loaded = ref({ store: "", month: "" });
const queryChanged = computed(
  () =>
    loaded.value.store !== props.tab.store ||
    loaded.value.month !== props.tab.month,
);
const monthState = computed(() => {
  if (rows.value.some(r => r.status === 'submitted')) return 'submitted';
  if (rows.value.some(r => r.status === 'confirmed')) return 'confirmed';
  return permissions.value.storeStatus || 'not_started';
});
const monthLocked = computed(() => ['submitted','confirmed'].includes(monthState.value));
const actions: Record<string, string> = {
  initialize: "初始化本月人員",
  submit: "送出審核",
  confirm: "確認本月狀態",
  revert: "退回草稿",
  unconfirm: "取消確認",
};
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const r = await api(
      `monthly?${new URLSearchParams({ month: props.tab.month, store: props.tab.store })}`,
    );
    stores.value = r.stores;
    rows.value = (r.records || []).sort((a:any,b:any)=>Number(!!b.is_acting_manager)-Number(!!a.is_acting_manager) || (positionOrder[a.position] || 999)-(positionOrder[b.position] || 999));
    permissions.value = r;
    revision.value++;
    props.tab.store = r.store || "";
    loaded.value = { store: props.tab.store, month: props.tab.month };
    props.tab.title = `人員狀態 · ${stores.value.find((s) => s.id === r.store)?.short_name || stores.value.find((s) => s.id === r.store)?.store_name || props.tab.month}`;
  } catch (e) {
    error.value = (e as Error).message;
    rows.value = [];
    permissions.value = {};
  } finally {
    loading.value = false;
  }
}
function edit(row: any) {
  if (queryChanged.value) return;
  const tab = work.open("monthly-edit", props.tab.store, row.id);
  tab.month = props.tab.month;
  tab.title = `人員 · ${row.employee_name || row.employee_code}`;
  tab.payload = JSON.parse(JSON.stringify(row));
}
async function execute() {
  props.tab.busy = true;
  error.value = "";
  try {
    await api("monthly", {
      method: "POST",
      body: JSON.stringify({
        action: confirmation.value,
        store: props.tab.store,
        month: props.tab.month,
      }),
    });
    confirmation.value = "";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    confirmation.value = "";
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">人員 / 每月狀態</p>
      <h1>每月人員狀態</h1>
      <p class="muted">查詢門市名冊、維護出勤並提交確認。</p>
    </div>
    <div class="monthly-global-actions"><div ref="globalToolsTarget"/></div>
  </header>
  <div class="monthly-query-actions"><form class="module-filters" @submit.prevent="load">
    <label
      >門市<select aria-label="門市" v-model="tab.store" :disabled="loading || tab.busy || tab.dirty">
        <option v-for="s in stores" :value="s.id">
          {{ s.store_code }} {{ s.store_name }}
        </option>
      </select></label
    ><label>月份<input type="month" v-model="tab.month" :disabled="loading || tab.busy || tab.dirty" required /></label
    ><button class="primary" :disabled="loading || tab.busy || tab.dirty">查詢人員</button>
  </form><div class="monthly-store-actions"><div ref="storeToolsTarget"/>  <div class="module-actions"><button @click="load" :disabled="loading || tab.busy || tab.dirty">重新整理</button>
    <template v-if="permissions.canEdit && !monthLocked"
      ><button
        @click="confirmation = 'initialize'"
        :disabled="loading || queryChanged || tab.busy || !tab.store"
      >
        初始化本月人員</button></template
      ><button
        v-if="permissions.canSubmit && !monthLocked"
        class="primary"
        @click="confirmation = 'submit'"
        :disabled="loading || queryChanged || tab.busy || !rows.some(r => r.status === 'draft')"
      >
        送出審核
      </button
    ><button
      v-if="permissions.canConfirm && monthState === 'submitted'"
      @click="confirmation = 'confirm'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      確認本月狀態</button
    ><button
      v-if="permissions.canRevert && monthState === 'submitted'"
      @click="confirmation = 'revert'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      退回草稿</button
    ><button
      v-if="permissions.canUnconfirm && monthState === 'confirmed'"
      @click="confirmation = 'unconfirm'"
      :disabled="loading || queryChanged || tab.busy || !rows.length"
    >
      取消確認</button
    ><span class="muted">{{ rows.length }} 位人員</span>
  </div>
</div></div>
  <div v-if="error" class="notice error" role="alert">
    {{ error }} <button @click="load">重試</button>
  </div>
  <p v-if="queryChanged && !loading" class="notice">
    條件已變更，請按「查詢人員」更新資料後再操作。
  </p>
  <MonthlyTools :global-target="globalToolsTarget" :store-target="storeToolsTarget" :tab="tab" :rows="rows" :month-state="monthState" :options="permissions.options || {}" :revision="revision" :disabled="loading || queryChanged || !tab.store || !!error" @refresh="load" />
  <p v-if="loading" role="status">載入人員資料…</p>
  <div v-else-if="!error" class="module-table">
    <table>
      <thead>
        <tr>
          <th>員編 / 姓名</th>
          <th>職位</th>
          <th>僱用類型／到職日</th>
          <th>本月狀態</th>
          <th>工作天數</th>
          <th>工作時數</th>
          <th>特殊標記</th>
          <th>上月單品獎金</th>
          <th>計算區塊</th>
          <th>交易次數</th>
          <th>銷售金額</th>
          <th>毛利／毛利率</th>
          <th>審核狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            {{ r.employee_code }}<br /><strong>{{ r.employee_name }}</strong>
          </td>
          <td>{{ r.position }}</td>
          <td>{{ r.employment_type === "part_time" ? "兼職" : "正職" }}<br />{{ r.start_date || "—" }}</td>
          <td>{{ labels[r.monthly_status] || r.monthly_status }}</td>
          <td>{{ r.work_days ?? "—" }}</td>
          <td>{{ r.work_hours ?? "—" }}</td>
          <td>{{ [r.is_pharmacist ? "藥師" : "", r.has_manager_bonus ? "店長加成" : "", r.is_dual_position ? "雙職" : "", r.is_supervisor_rotation ? "督導卡班" : ""].filter(Boolean).join("、") || "—" }}</td>
          <td>{{ r.last_month_single_item_bonus?.toLocaleString() ?? "—" }}</td>
          <td>{{ r.calculated_block ? `區塊 ${r.calculated_block}` : "—" }}</td>
          <td>{{ r.transaction_count?.toLocaleString() ?? "—" }}</td>
          <td>{{ r.sales_amount?.toLocaleString() ?? "—" }}</td>
          <td>{{ r.gross_profit?.toLocaleString() ?? "—" }}<br />{{ r.gross_profit_rate == null ? "—" : `${r.gross_profit_rate}%` }}</td>
          <td>{{ status[r.status] || r.status }}</td>
          <td>
            <button @click="edit(r)" :disabled="queryChanged">
              {{
                permissions.canEdit && r.status === "draft"
                  ? "編輯出勤"
                  : "查看明細"
              }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="14">此門市本月尚無人員資料。</td>
        </tr>
      </tbody>
    </table>
  </div>
  <Modal
    v-if="confirmation"
    :title="actions[confirmation]"
    :busy="tab.busy"
    @cancel="confirmation = ''"
    ><p>即將處理 {{ tab.month }} 的門市人員資料。請確認目前門市與月份。</p>
    <div class="dialog-actions">
      <button @click="confirmation = ''" :disabled="tab.busy">取消</button
      ><button class="primary" @click="execute" :disabled="tab.busy">
        確認執行
      </button>
    </div></Modal
  >
</template>

<style scoped>
.monthly-global-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;max-width:100%}.monthly-query-actions{display:grid;grid-template-columns:minmax(460px,auto) minmax(0,1fr);gap:24px;align-items:start;margin-bottom:20px}.monthly-query-actions .module-filters{margin:0;align-items:end;flex-wrap:wrap}.monthly-store-actions{min-width:0}.monthly-store-actions .module-actions{flex-wrap:wrap;margin:8px 0 0}.monthly-store-actions :deep(.monthly-tools){margin:0}.monthly-global-actions :deep(.monthly-tools){margin:0;justify-content:flex-end}@media(max-width:1200px){.monthly-query-actions{grid-template-columns:1fr}.monthly-global-actions{justify-content:flex-start}}@media(max-width:650px){.monthly-query-actions .module-filters{display:flex;flex-wrap:wrap}.monthly-query-actions .module-filters label{min-width:0;flex:1 1 160px}.monthly-query-actions select,.monthly-query-actions input{width:100%;min-width:0}}
</style>
