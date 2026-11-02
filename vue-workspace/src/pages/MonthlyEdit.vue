<script setup lang="ts">
import Modal from "../components/Modal.vue";
const saveFailed = ref(false);
import { ref, watch, onBeforeUnmount, onMounted } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
const props = defineProps<{ tab: WorkTab }>();
const record = ref<any>(props.tab.payload),
  error = ref(""),
  message = ref(""),
  canEdit = ref(false),
  options = ref<any>({ statuses: [], positions: [], levels: [], reasons: [] });
const booleans: [string, string][] = [
  ["is_dual_position", "雙職"],
  ["has_manager_bonus", "店長加給"],
  ["is_supervisor_rotation", "督導卡班"],
  ["is_pharmacist", "藥師"],
  ["is_acting_manager", "代理店長"],
];
const more: any = {};
for (const key of [
  "position",
  "employment_type",
  "monthly_status",
  "start_date",
  "newbie_level",
  "partial_month_reason",
  "partial_month_notes",
  "supervisor_employee_code",
  "supervisor_name",
  "supervisor_position",
])
  more[key] = record.value[key] || "";
for (const [key] of booleans) more[key] = !!record.value[key];
for (const key of ["supervisor_shift_hours", "extra_task_external_hours"])
  more[key] = record.value[key] ?? null;
more.extra_tasks = record.value.extra_tasks || [];
const form = ref<any>({
  ...more,
  work_days: record.value.work_days,
  work_hours: record.value.work_hours,
  notes: record.value.notes || "",
});
let snapshot = JSON.stringify(form.value);
watch(
  form,
  () => {
    props.tab.dirty = JSON.stringify(form.value) !== snapshot;
    message.value = "";
  },
  { deep: true, flush: "sync" },
);
async function save() {
  props.tab.busy = true;
  error.value = "";
  try {
    const r = await api("monthly", {
      method: "POST",
      body: JSON.stringify({
        action: "save",
        store: props.tab.store,
        month: props.tab.month,
        id: props.tab.recordId,
        version: record.value.updated_at,
        updates: {
          ...form.value,
          supervisor_shift_hours:
            form.value.supervisor_shift_hours === ""
              ? null
              : form.value.supervisor_shift_hours,
          extra_task_external_hours:
            form.value.extra_task_external_hours === ""
              ? null
              : form.value.extra_task_external_hours,
          work_days: form.value.work_days === "" ? null : form.value.work_days,
          work_hours:
            form.value.work_hours === "" ? null : form.value.work_hours,
        },
      }),
    });
    record.value = r.record;
    snapshot = JSON.stringify(form.value);
    props.tab.dirty = false;
    message.value = "已儲存";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    saveFailed.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = save;
onMounted(async () => {
  try {
    const r = await api(
      `monthly?${new URLSearchParams({ store: props.tab.store, month: props.tab.month })}`,
    );
    options.value = r.options;
    canEdit.value = r.canEdit && record.value.status === "draft";
  } catch (e) {
    error.value = (e as Error).message;
  }
});
onBeforeUnmount(() => {
  delete props.tab.save;
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">人員 / {{ tab.month }}</p>
      <h1>{{ record.employee_name || record.employee_code }}</h1>
      <p class="muted">
        {{ record.employee_code }} · {{ record.position }} ·
        {{ record.employment_type === "part_time" ? "兼職" : "正職" }}
      </p>
    </div>
  </header>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <p v-if="!canEdit" class="notice">
    此筆目前僅供檢視；只有可編輯的草稿可儲存。
  </p>
  <form class="module-editor" @submit.prevent="save">
    <fieldset :disabled="!canEdit || tab.busy">
      <legend>任職與本月狀態</legend>
      <div class="module-form-grid">
        <label
          >職位<select v-model="form.position">
            <option v-for="p in options.positions" :value="p">{{ p }}</option>
          </select></label
        ><label
          >任職類型<select v-model="form.employment_type">
            <option value="full_time">正職</option>
            <option value="part_time">兼職</option>
          </select></label
        ><label
          >本月狀態<select v-model="form.monthly_status">
            <option v-for="s in options.statuses" :value="s.value">
              {{ s.label }}
            </option>
          </select></label
        ><label>到職日期<input type="date" v-model="form.start_date" /></label
        ><label
          >新人 / 行政階段<select v-model="form.newbie_level">
            <option value="">未指定</option>
            <option v-for="s in options.levels" :value="s.value">
              {{ s.label }}
            </option>
          </select></label
        ><label
          >未滿月原因<select v-model="form.partial_month_reason">
            <option value="">無</option>
            <option v-for="s in options.reasons" :value="s.value">
              {{ s.label }}
            </option>
          </select></label
        >
      </div>
      <div class="module-actions">
        <label v-for="[key, label] in booleans"
          ><input type="checkbox" v-model="form[key]" />{{ label }}</label
        >
      </div>
      <div class="module-form-grid">
        <label
          >工作天數<input
            type="number"
            min="0"
            max="31"
            step="0.5"
            v-model.number="form.work_days" /></label
        ><label
          >工作時數<input
            type="number"
            min="0"
            max="744"
            step="0.5"
            v-model.number="form.work_hours"
        /></label>
      </div>
      <details>
        <summary>支援與外務資料</summary>
        <div class="module-form-grid">
          <label
            >支援督導員編<input
              v-model="form.supervisor_employee_code" /></label
          ><label>支援督導姓名<input v-model="form.supervisor_name" /></label
          ><label
            >支援督導職位<input v-model="form.supervisor_position" /></label
          ><label
            >督導卡班時數<input
              type="number"
              min="0"
              max="744"
              step="0.5"
              v-model.number="form.supervisor_shift_hours" /></label
          ><label
            >外務時數<input
              type="number"
              min="0"
              max="744"
              step="0.5"
              v-model.number="form.extra_task_external_hours" /></label
          ><label
            >未滿月備註<input
              v-model="form.partial_month_notes"
              maxlength="1000"
          /></label>
        </div>
        <div class="module-actions">
          <label
            ><input
              type="checkbox"
              value="長照外務"
              v-model="form.extra_tasks"
            />長照外務</label
          ><label
            ><input
              type="checkbox"
              value="診所業務"
              v-model="form.extra_tasks"
            />診所業務</label
          >
        </div>
      </details>
      <label
        >備註<textarea v-model="form.notes" maxlength="4000" rows="5" />
      </label>
    </fieldset>
    <button v-if="canEdit" class="primary" :disabled="tab.busy || !tab.dirty">
      {{ tab.busy ? "儲存中…" : "儲存出勤資料" }}
    </button>
  </form>
  <Modal v-if="saveFailed" title="儲存未完成" @cancel="saveFailed = false"
    ><p>{{ error }}</p>
    <p>編輯內容仍保留，可關閉此提示後修正或重試。</p>
    <div class="dialog-actions">
      <button class="primary" @click="saveFailed = false">返回編輯</button>
    </div></Modal
  >
</template>
