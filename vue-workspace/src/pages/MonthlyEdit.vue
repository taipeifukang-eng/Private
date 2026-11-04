<script setup lang="ts">
import Modal from "../components/Modal.vue";
import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import { api } from "../api";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import { canDoMonthlyAction } from "../../../lib/workspace/monthly-status-rules";
import {
  BLOCK_DESCRIPTIONS,
  isSupervisorActingManagerDual,
  previewBonusBlock,
} from "../../../lib/monthly-staff/block";
import {
  inputMode,
  monthStatusAdvice,
  PARTIAL_MONTH_POSSIBLE_REASONS,
  plannedExtraTaskHours,
} from "../../../lib/monthly-staff/hours";
import {
  usesNewbieLevel,
  newbiePromotionPrompt,
  PROMOTION_BY_MOVEMENT_NOTICE,
} from "../../../lib/monthly-staff/newbie";
import {
  ADMIN_LEVEL_OPTIONS,
  NEWBIE_LEVEL_OPTIONS,
} from "../../../types/workflow";
const saveFailed = ref(false);
const props = defineProps<{ tab: WorkTab }>();
const work = useWorkspace();
const session = useSession();
const record = ref<any>(props.tab.payload),
  error = ref(""),
  message = ref(""),
  apiCanEdit = ref(false),
  liveStatus = ref<string>(props.tab.payload?.status || "draft"),
  options = ref<any>({ statuses: [], positions: [], levels: [], reasons: [] }),
  reminder = ref(false);
// 特殊標記：標題與說明文字照舊版 monthly-status/edit/[id]。
const booleans: [string, string, string][] = [
  ["is_dual_position", "是否為「雙」職務", "如：店長-雙、代理店長-雙、督導(代理店長)-雙"],
  ["has_manager_bonus", "店長/代理店長加成資格", "是否套用店長達標加成 (managerMultiplier)"],
  ["is_supervisor_rotation", "督導卡班", "督導輪調/卡班（獎金 = 0）"],
  ["is_acting_manager", "是否擔任代理店長", "適用於主任、副店長、督導擔任代理店長職務時勾選"],
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
more.is_pharmacist = !!record.value.is_pharmacist;
for (const key of ["supervisor_shift_hours", "extra_task_external_hours"])
  more[key] = record.value[key] ?? null;
more.extra_tasks = record.value.extra_tasks || [];
const form = ref<any>({
  ...more,
  // 舊版 data.work_days || 0：資料庫為 null 時顯示 0。
  work_days: record.value.work_days || 0,
  work_hours: record.value.work_hours || 0,
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

const canEdit = computed(
  () => apiCanEdit.value && canDoMonthlyAction(liveStatus.value, "edit"),
);
const isConfirmed = computed(() => liveStatus.value === "confirmed");
const totalDays = computed(() => {
  const given = Number(record.value.total_days_in_month);
  if (given > 0) return given;
  const [y, m] = String(props.tab.month || "").split("-").map(Number);
  return y && m ? new Date(y, m, 0).getDate() : 31;
});
const mode = computed(() =>
  inputMode(form.value.position, form.value.employment_type, form.value.is_dual_position),
);
const supervisorDual = computed(() =>
  isSupervisorActingManagerDual(form.value.position, form.value.is_dual_position),
);
const showNewbieLevel = computed(
  () => usesNewbieLevel(form.value.position, form.value.monthly_status),
);
const showAdminLevel = computed(() => form.value.position === "行政");
// 舊版只檢查階段是否為空（position === '行政' && !newbieLevel）。
const adminLevelMissing = computed(
  () => showAdminLevel.value && !form.value.newbie_level,
);
// 舊版職位下拉只有一般職位；紀錄原本就是特殊職位時仍列出該值，避免資料遺失。
const positionChoices = computed<string[]>(() => {
  const list: string[] = options.value.positions || [];
  const current = record.value.position;
  return current && !list.includes(current) ? [...list, current] : list;
});
const isPartialMonth = computed(() => form.value.monthly_status !== "full_month");
const hasExternalTask = computed(() => form.value.extra_tasks.length > 0);
const plannedHours = computed(() =>
  plannedExtraTaskHours({
    position: form.value.position,
    employment_type: form.value.employment_type,
    is_dual_position: form.value.is_dual_position,
    monthly_status: form.value.monthly_status,
    work_days: form.value.work_days,
    work_hours: form.value.work_hours,
  }),
);
const block = computed(() => previewBonusBlock(form.value));
const advice = computed(() =>
  monthStatusAdvice({
    employment_type: form.value.employment_type,
    monthly_status: form.value.monthly_status,
    work_days: form.value.work_days,
    total_days_in_month: totalDays.value,
  }),
);
const prompt = computed(() =>
  newbiePromotionPrompt(
    form.value.start_date,
    props.tab.month,
    form.value.position,
    form.value.monthly_status,
    form.value.newbie_level,
  ),
);
const canOpenMovements = computed(
  () => !!session.data?.capabilities.movementHistory,
);

// W01b-q3：天數剛好滿月才自動設為整月；不滿月不自動改（只顯示提示）。
watch(
  () => [form.value.work_days, form.value.employment_type] as const,
  () => {
    if (advice.value.autoSet) form.value.monthly_status = advice.value.autoSet;
  },
);

function blankToZero(value: unknown): number {
  const n = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(n) ? 0 : n;
}
function validate(): string {
  if (adminLevelMissing.value)
    return "職位為行政時，請標註「過階」或「未過階」";
  return "";
}
async function save() {
  const invalid = validate();
  if (invalid) {
    error.value = invalid;
    return false;
  }
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
        updates: {
          ...form.value,
          // 舊版 parseFloat(...) || 0：空白（或非數字）存 0；外派時數維持空白為 null。
          supervisor_shift_hours: blankToZero(form.value.supervisor_shift_hours),
          extra_task_external_hours:
            form.value.extra_task_external_hours === ""
              ? null
              : form.value.extra_task_external_hours,
          work_days: blankToZero(form.value.work_days),
          work_hours: blankToZero(form.value.work_hours),
        },
      }),
    });
    record.value = r.record;
    snapshot = JSON.stringify(form.value);
    props.tab.dirty = false;
    // 舊版 alert「✅ 儲存成功」後回名冊頁；新版維持在編輯分頁（保留已開分頁與草稿），以「已儲存」提示（白名單 w01b-save-stays-in-editor）。
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
// W01b-q2：新人升階提醒不阻擋儲存；按「是」套用階段，按「否」維持原樣，兩者都繼續儲存。
async function requestSave() {
  const invalid = validate();
  if (invalid) {
    error.value = invalid;
    return;
  }
  if (prompt.value) {
    reminder.value = true;
    return;
  }
  await save();
}
async function answerReminder(apply: boolean) {
  const current = prompt.value;
  reminder.value = false;
  if (apply && current?.kind === "level" && current.suggestedLevel)
    form.value.newbie_level = current.suggestedLevel;
  await save();
}
function openMovements() {
  reminder.value = false;
  work.open("movement-history");
}
function back() {
  work.remove([props.tab.id]);
}
props.tab.save = save;
onMounted(async () => {
  try {
    const r = await api(
      `monthly?${new URLSearchParams({ store: props.tab.store, month: props.tab.month })}`,
    );
    options.value = r.options;
    apiCanEdit.value = !!r.canEdit;
    // 以最新名冊的狀態為準（例如開啟後該月已被確認）。
    const fresh = (r.records || []).find((x: any) => x.id === props.tab.recordId);
    if (fresh?.status) liveStatus.value = fresh.status;
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
        {{ record.employee_code }}
        <span v-if="record.is_manually_added" class="manual-tag">手動新增</span>
        · {{ record.position }} ·
        {{ record.employment_type === "part_time" ? "兼職" : "正職" }}
      </p>
    </div>
  </header>
  <section
    v-if="isConfirmed"
    class="monthly-confirmed"
    aria-label="資料已確認"
    data-confirmed-screen
  >
    <h2>此資料已確認</h2>
    <p>已確認的人員狀態無法再修改</p>
    <button class="primary" type="button" @click="back">返回</button>
  </section>
  <template v-else>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="!canEdit" class="notice" data-readonly-notice>
      此筆目前僅供檢視；只有可編輯的草稿可儲存。
    </p>
    <form class="module-editor" @submit.prevent="requestSave">
      <fieldset :disabled="!canEdit || tab.busy">
        <legend>任職與本月狀態</legend>
        <div class="module-form-grid">
          <label
            >職位<select name="position" v-model="form.position">
              <option value="">請選擇職位</option>
              <option v-for="p in positionChoices" :value="p">{{ p }}</option>
            </select></label
          ><label
            >雇用類型<select name="employment_type" v-model="form.employment_type">
              <option value="full_time">正職</option>
              <option value="part_time">兼職</option>
            </select></label
          ><label
            >本月狀態<select name="monthly_status" v-model="form.monthly_status">
              <option v-for="s in options.statuses" :value="s.value">
                {{ s.label }}
              </option>
            </select></label
          ><label>到職日期<input name="start_date" type="date" v-model="form.start_date" /></label>
        </div>
        <div class="module-actions">
          <label
            ><input type="checkbox" v-model="form.is_pharmacist" />藥師</label
          >
        </div>

        <fieldset
          v-if="showNewbieLevel"
          class="level-group"
          data-newbie-level
        >
          <legend>新人等級</legend>
          <div class="module-actions">
            <label v-for="o in NEWBIE_LEVEL_OPTIONS" :key="o.value"
              ><input
                type="radio"
                name="newbie-level"
                :value="o.value"
                v-model="form.newbie_level"
              />{{ o.label }}</label
            ><label
              ><input
                type="radio"
                name="newbie-level"
                value=""
                v-model="form.newbie_level"
              />無（已過階）</label
            >
          </div>
        </fieldset>
        <fieldset v-if="showAdminLevel" class="level-group" data-admin-level>
          <legend>行政階級（必填）</legend>
          <div class="module-actions">
            <label v-for="o in ADMIN_LEVEL_OPTIONS" :key="o.value"
              ><input
                type="radio"
                name="admin-level"
                :value="o.value"
                v-model="form.newbie_level"
              />{{ o.label }}</label
            >
          </div>
          <p
            v-if="adminLevelMissing"
            class="field-error"
            role="alert"
            data-admin-level-error
          >
            請選擇「過階」或「未過階」
          </p>
        </fieldset>

        <div v-if="isPartialMonth" class="module-form-grid" data-partial-month>
          <h3 class="module-subheading">非整月在職詳細資訊</h3>
          <label
            >非整月原因<select name="partial_month_reason" v-model="form.partial_month_reason">
              <option value="">請選擇原因</option>
              <option v-for="s in options.reasons" :value="s.value">
                {{ s.label }}
              </option>
            </select></label
          ><label
            >說明<input
              v-model="form.partial_month_notes"
              maxlength="1000"
              placeholder="如有特殊情況請說明，例如：5/15 到職"
          /></label>
        </div>

        <div class="module-form-grid">
          <label v-if="mode === 'hours' && supervisorDual"
            >本月工作時數（小時，基準：160 小時）<input
              type="number"
              min="0"
              max="744"
              step="0.1"
              name="work_hours"
              v-model.number="form.work_hours"
          /></label>
          <label v-else-if="mode === 'days'"
            >本月工作天數（/ {{ totalDays }} 天）<input
              type="number"
              min="0"
              :max="totalDays"
              step="0.1"
              name="work_days"
              v-model.number="form.work_days"
          /></label>
          <label v-else
            >本月工作時數（小時，基準：160 小時）<input
              type="number"
              min="0"
              max="744"
              step="0.1"
              name="work_hours"
              v-model.number="form.work_hours"
          /></label>
        </div>
        <p v-if="mode === 'hours' && supervisorDual" class="muted" data-hours-hint>
          督導(代理店長)-雙 請填寫工作時數
        </p>
        <p v-else-if="mode === 'days'" class="muted" data-days-hint>
          {{ form.monthly_status === "full_month" ? "整月在職請填滿天數" : "請填入實際工作天數" }}
        </p>
        <p
          v-if="advice.needsConfirm"
          class="notice"
          role="status"
          data-partial-hint
        >
          <strong>請確認本月狀態。</strong>
          天數未滿整月，系統不會自動更改本月狀態；可能原因：{{
            PARTIAL_MONTH_POSSIBLE_REASONS.join("、")
          }}。職位認定會影響獎金，請依實際情況選擇。
        </p>

        <div class="module-actions">
          <label v-for="[key, label, desc] in booleans" :key="key"
            ><input type="checkbox" v-model="form[key]" />{{ label }}
            <small class="muted">{{ desc }}</small></label
          >
        </div>

        <details v-if="form.is_supervisor_rotation" open data-supervisor>
          <summary>督導卡班資訊</summary>
          <div class="module-form-grid">
            <label>員編<input v-model="form.supervisor_employee_code" /></label
            ><label>姓名<input v-model="form.supervisor_name" /></label
            ><label>職位<input v-model="form.supervisor_position" /></label
            ><label
              >時數<input
                type="number"
                min="0"
                max="744"
                step="0.5"
                v-model.number="form.supervisor_shift_hours"
            /></label>
          </div>
        </details>

        <fieldset class="level-group">
          <legend>額外任務</legend>
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
          <div v-if="hasExternalTask" class="module-form-grid" data-extra-hours>
            <label
              >該店規劃實上時數（自動計算）<input
                type="number"
                :value="plannedHours ?? ''"
                readonly
                data-planned-hours
                placeholder="自動計算"
            /></label>
            <label
              >外務時數<input
                type="number"
                min="0"
                max="744"
                step="0.5"
                name="extra_task_external_hours"
                v-model.number="form.extra_task_external_hours"
                placeholder="外務時數"
            /></label>
          </div>
        </fieldset>

        <label
          >備註<textarea name="notes" v-model="form.notes" maxlength="4000" rows="5" />
        </label>
      </fieldset>

      <p
        v-if="prompt"
        class="notice"
        role="status"
        data-newbie-reminder
      >
        <strong>新人階段提醒：</strong>{{ prompt.message }}
        <template v-if="prompt.kind === 'promote' && canOpenMovements">
          <button type="button" data-open-movements @click="openMovements">
            前往人員異動紀錄
          </button>
        </template>
      </p>

      <section class="block-preview" aria-label="系統自動計算區塊" data-block-preview>
        <h3>系統自動計算區塊</h3>
        <p>
          <span class="block-chip" :data-block="block">區塊 {{ block }}</span>
          <span data-block-description>{{ BLOCK_DESCRIPTIONS[block] || "未分類" }}</span>
        </p>
        <p class="muted">
          此區塊與儲存後資料庫算出的結果一致，用於獎金計算。
        </p>
      </section>

      <button
        v-if="canEdit"
        class="primary"
        :disabled="tab.busy || !tab.dirty"
      >
        {{ tab.busy ? "儲存中…" : "儲存出勤資料" }}
      </button>
    </form>
  </template>
  <Modal v-if="saveFailed" title="儲存未完成" @cancel="saveFailed = false"
    ><p>{{ error }}</p>
    <p>編輯內容仍保留，可關閉此提示後修正或重試。</p>
    <div class="dialog-actions">
      <button class="primary" @click="saveFailed = false">返回編輯</button>
    </div></Modal
  >
  <Modal v-if="reminder && prompt" title="新人階段提醒" @cancel="reminder = false"
    ><p>{{ prompt.message }}</p>
    <template v-if="prompt.kind === 'level'">
      <p class="muted">不論選擇哪一項，都會繼續儲存。</p>
      <div class="dialog-actions">
        <button type="button" @click="answerReminder(false)">否，維持原樣並儲存</button>
        <button class="primary" type="button" @click="answerReminder(true)">
          是，改成{{ prompt.suggestedLevel }}並儲存
        </button>
      </div>
    </template>
    <template v-else>
      <p class="muted">{{ PROMOTION_BY_MOVEMENT_NOTICE }}；本次儲存不會更動職位。</p>
      <div class="dialog-actions">
        <button v-if="canOpenMovements" type="button" @click="openMovements">
          前往人員異動紀錄
        </button>
        <button class="primary" type="button" @click="answerReminder(false)">
          知道了，繼續儲存
        </button>
      </div>
    </template></Modal
  >
</template>
