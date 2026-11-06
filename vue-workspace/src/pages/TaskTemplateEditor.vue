<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, ApiError } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import TaskStepFields from "../components/TaskStepFields.vue";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  form = ref<any>({
    title: "",
    description: "",
    planned_start_date: "",
    planned_end_date: "",
    sections: [],
  }),
  people = ref<any[]>([]),
  snapshot = ref<any>(null),
  ready = ref(false),
  loading = ref(false),
  locked = ref(false),
  error = ref(""),
  message = ref(""),
  baseline = ref(""),
  pending = ref<any>(null),
  removeTarget = ref<{ array: any[]; index: number; label: string } | null>(
    null,
  ),
  search = ref("");
const departments = computed(() =>
  Array.from(
    new Set(people.value.map((p) => p.department).filter(Boolean)),
  ).sort(),
);
const newStep = () => ({
  id: crypto.randomUUID(),
  label: "",
  description: "",
  required: false,
  planned_start_date: "",
  planned_end_date: "",
  subSteps: [],
});
function addSection() {
  form.value.sections.push({
    id: crypto.randomUUID(),
    department: "",
    assigned_users: [],
    support_users: [],
    steps: [newStep()],
  });
}
const supportOpen = ref<Record<string, boolean>>({});
const showSupport = (section: any) =>
  supportOpen.value[section.id] ?? (section.support_users || []).length > 0;
function outsiders(section: any) {
  return people.value.filter(
    (p) =>
      p.department &&
      p.department !== section.department &&
      (!search.value ||
        [p.full_name, p.employee_code, p.job_title, p.department]
          .join(" ")
          .includes(search.value)),
  );
}
const isSupport = (section: any, id: string) =>
  (section.support_users || []).includes(id);
function toggleSupport(section: any, id: string, on: boolean) {
  section.support_users ||= [];
  section.support_users = section.support_users.filter((x: string) => x !== id);
  section.assigned_users = section.assigned_users.filter((x: string) => x !== id);
  if (on) {
    section.support_users.push(id);
    section.assigned_users.push(id);
  }
}
function changeDepartment(section: any) {
  section.assigned_users = [];
  section.support_users = [];
  supportOpen.value[section.id] = false;
}
function move(array: any[], index: number, offset: number) {
  const other = index + offset;
  if (other < 0 || other >= array.length) return;
  [array[index], array[other]] = [array[other], array[index]];
}
function members(section: any) {
  return people.value.filter(
    (p) =>
      p.department === section.department &&
      (!search.value ||
        [p.full_name, p.employee_code, p.job_title]
          .join(" ")
          .includes(search.value)),
  );
}
async function load() {
  loading.value = true;
  ready.value = false;
  error.value = "";
  try {
    snapshot.value = await api<any>(
      "task-template" + (props.tab.recordId ? "?id=" + props.tab.recordId : ""),
    );
    people.value = snapshot.value.people;
    const t = snapshot.value.template;
    form.value = t
      ? {
          title: t.title,
          description: t.description || "",
          planned_start_date: snapshot.value.planned_start_date || "",
          planned_end_date: snapshot.value.planned_end_date || "",
          sections: JSON.parse(
            JSON.stringify(
              t.sections?.length
                ? t.sections
                : [
                    {
                      id: crypto.randomUUID(),
                      department: "",
                      assigned_users: [],
                      steps: t.steps_schema || [],
                    },
                  ],
            ),
          ),
        }
      : {
          title: "",
          description: "",
          planned_start_date: "",
          planned_end_date: "",
          sections: [],
        };
    if (!t) addSection();
    locked.value = snapshot.value.locked;
    baseline.value = JSON.stringify(form.value);
    pending.value = null;
    props.tab.dirty = false;
    props.tab.title = t ? "編輯 · " + t.title : "建立新任務";
    ready.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(
  form,
  () => {
    props.tab.dirty =
      ready.value && JSON.stringify(form.value) !== baseline.value;
    if(props.tab.dirty)message.value="";
  },
  { deep: true },
);
async function save() {
  if (!ready.value || locked.value) return false;
  if (!props.tab.dirty) return true;
  props.tab.busy = true;
  error.value = "";
  message.value = "";
  try {
    pending.value ||= {
      id: props.tab.recordId || null,
      version: snapshot.value.template?.workspace_version || 0,
      versions: snapshot.value.versions,
      writeId: crypto.randomUUID(),
      form: JSON.parse(JSON.stringify(form.value)),
    };
    const result = await api<any>("task-template", {
      method: "POST",
      body: JSON.stringify(pending.value),
    });
    props.tab.recordId = result.id;
    props.tab.dirty = false;
    pending.value = null;
    baseline.value = JSON.stringify(form.value);
    if (snapshot.value.canEdit) await load();
    else locked.value = true;
    message.value = "範本與指派已儲存";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 400) pending.value = null;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = save;
props.tab.discard = load;
onMounted(load);
onBeforeUnmount(() => {
  props.tab.save = undefined;
  props.tab.discard = undefined;
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">任務管理 / 流程設計</p>
      <h1>{{ tab.recordId ? "編輯任務範本" : "建立新任務" }}</h1>
    </div>
    <div class="button-row">
      <button
        v-if="tab.recordId"
        @click="work.open('task-management-detail', '', tab.recordId)"
      >
        查看管理明細</button
      ><button
        class="primary"
        :disabled="!ready || locked || !tab.dirty || tab.busy"
        @click="save"
      >
        {{ tab.busy ? "儲存中…" : "儲存範本與指派" }}
      </button>
    </div>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="message" role="status" class="notice">{{ message }}</p>
  <p v-if="loading" role="status">載入範本與執行人員…</p>
  <p v-if="locked" class="notice">
    已有完成指派或你沒有編輯權限，此範本目前不能修改。
  </p>
  <p v-if="snapshot?.inProgress" class="notice">
    已有執行中的指派。調整項目及人員會影響現行工作；歷史執行紀錄會保留。
  </p>
  <div v-if="pending" class="notice">
    <p>上次儲存尚未確認，草稿仍保留。可重試同一次儲存，或另開最新版本核對。</p>
    <button @click="work.open('task-template-editor', '', tab.recordId)">
      另開版本核對
    </button>
  </div>
  <button v-if="!ready && !loading" @click="load">重新載入</button>
  <fieldset
    v-if="ready"
    class="template-form"
    :disabled="locked || tab.busy || !!pending"
  >
    <legend>基本資料</legend>
    <label
      >專案標題<input v-model="form.title" maxlength="300" required /></label
    ><label
      >專案說明<textarea
        v-model="form.description"
        maxlength="10000"
      ></textarea>
    </label>
    <div class="filter-bar">
      <label
        >專案預計開始<input
          type="date"
          v-model="form.planned_start_date" /></label
      ><label
        >專案預計結束<input
          type="date"
          v-model="form.planned_end_date"
          :min="form.planned_start_date || undefined"
      /></label>
    </div>
    <h2>部門與工作項目</h2>
    <p class="muted">同一人若出現在多個區段，執行範圍依第一個區段認列。</p>
    <label>搜尋執行人員<input type="search" v-model="search" /></label>
    <section
      v-for="(section, si) in form.sections"
      :key="section.id"
      class="template-section"
    >
      <div class="section-heading">
        <h3>
          區段 {{ Number(si) + 1 }} · {{ section.department || "尚未選擇部門" }}
        </h3>
        <div class="button-row">
          <button
            :disabled="si === 0"
            @click="move(form.sections, Number(si), -1)"
            :aria-label="'區段 ' + (Number(si) + 1) + ' 上移'"
          >
            上移</button
          ><button
            :disabled="si === form.sections.length - 1"
            @click="move(form.sections, Number(si), 1)"
            :aria-label="'區段 ' + (Number(si) + 1) + ' 下移'"
          >
            下移</button
          ><button
            class="danger"
            :disabled="form.sections.length === 1"
            @click="
              removeTarget = {
                array: form.sections,
                index: Number(si),
                label: '此部門區段及全部項目',
              }
            "
          >
            刪除區段
          </button>
        </div>
      </div>
      <label
        >部門<select
          v-model="section.department"
          :aria-label="'區段 ' + (Number(si) + 1) + ' 部門'"
          @change="changeDepartment(section)"
        >
          <option value="">請選擇部門</option>
          <option v-for="d in departments" :key="d">{{ d }}</option>
          <option
            v-if="
              section.department && !departments.includes(section.department)
            "
            :value="section.department"
          >
            {{ section.department }}（原部門）
          </option>
        </select></label
      >
      <div class="member-list">
        <label v-for="person in members(section)" :key="person.id"
          ><input
            type="checkbox"
            v-model="section.assigned_users"
            :value="person.id"
          />{{ person.full_name || person.employee_code || "未命名成員"
          }}<small>{{ person.job_title }}</small></label
        >
        <p v-if="!members(section).length" class="muted">
          此部門沒有符合搜尋條件的人員。
        </p>
      </div>
      <label class="check-field"
        ><input
          type="checkbox"
          :checked="showSupport(section)"
          :disabled="!section.department"
          :aria-label="'區段 ' + (Number(si) + 1) + ' 加入跨部門支援人員'"
          @change="
            supportOpen[section.id] = ($event.target as HTMLInputElement).checked
          "
        />加入跨部門支援人員（其他部門的人，會標示為跨部門支援）</label
      >
      <div v-if="showSupport(section)" class="member-list support-list">
        <label v-for="person in outsiders(section)" :key="person.id"
          ><input
            type="checkbox"
            :checked="isSupport(section, person.id)"
            :aria-label="'跨部門支援 ' + (person.full_name || person.employee_code)"
            @change="
              toggleSupport(
                section,
                person.id,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{ person.full_name || person.employee_code || "未命名成員"
          }}<small>{{ person.department }} {{ person.job_title }}</small></label
        >
        <p v-if="!outsiders(section).length" class="muted">
          沒有符合搜尋條件的其他部門人員。
        </p>
      </div>
      <p class="muted">
        已選 {{ section.assigned_users.length }} 人，其中跨部門支援
        {{ (section.support_users || []).length }} 人
      </p>
      <div
        v-for="(step, pi) in section.steps"
        :key="step.id"
        class="template-step"
      >
        <div class="section-heading">
          <h4>主項 {{ Number(pi) + 1 }}</h4>
          <div class="button-row">
            <button
              :disabled="pi === 0"
              @click="move(section.steps, Number(pi), -1)"
              :aria-label="'主項 ' + (Number(pi) + 1) + ' 上移'"
            >
              上移</button
            ><button
              :disabled="pi === section.steps.length - 1"
              @click="move(section.steps, Number(pi), 1)"
            >
              下移</button
            ><button
              class="danger"
              @click="
                removeTarget = {
                  array: section.steps,
                  index: Number(pi),
                  label: '此主項與子項目',
                }
              "
            >
              刪除主項
            </button>
          </div>
        </div>
        <TaskStepFields
          :step="step"
          :prefix="
            '區段 ' + (Number(si) + 1) + ' 主項 ' + (Number(pi) + 1) + ' '
          "
        />
        <div
          v-for="(sub, ci) in step.subSteps || []"
          :key="sub.id"
          class="template-sub"
        >
          <div class="section-heading">
            <h4>子項 {{ Number(ci) + 1 }}</h4>
            <div class="button-row">
              <button
                :disabled="ci === 0"
                @click="move(step.subSteps, Number(ci), -1)"
              >
                上移</button
              ><button
                :disabled="ci === step.subSteps.length - 1"
                @click="move(step.subSteps, Number(ci), 1)"
              >
                下移</button
              ><button
                class="danger"
                @click="
                  removeTarget = {
                    array: step.subSteps,
                    index: Number(ci),
                    label: '此子項目',
                  }
                "
              >
                刪除子項
              </button>
            </div>
          </div>
          <TaskStepFields
            :step="sub"
            :prefix="
              '區段 ' +
              (Number(si) + 1) +
              ' 主項 ' +
              (Number(pi) + 1) +
              ' 子項 ' +
              (Number(ci) + 1) +
              ' '
            "
          />
        </div>
        <button @click="(step.subSteps ||= []).push(newStep())">
          新增子項
        </button>
      </div>
      <button @click="section.steps.push(newStep())">新增主項</button>
    </section>
    <button @click="addSection">新增部門區段</button>
  </fieldset>
  <Modal v-if="removeTarget" title="刪除流程項目" @cancel="removeTarget = null"
    ><p>
      要從目前草稿刪除{{
        removeTarget.label
      }}嗎？儲存後會影響現行指派，已記錄的歷史操作不會刪除。
    </p>
    <div class="dialog-actions">
      <button @click="removeTarget = null">取消</button
      ><button
        class="danger"
        @click="
          removeTarget.array.splice(removeTarget.index, 1);
          removeTarget = null;
        "
      >
        確認刪除項目
      </button>
    </div></Modal
  >
</template>
<style scoped>
.template-form {
  border: 0;
  padding: 0;
  min-width: 0;
}
.template-form > label {
  display: grid;
  gap: 6px;
  margin: 16px 0;
  max-width: 920px;
}
.template-form > label textarea {
  font:inherit;
  padding:8px;
  border:1px solid var(--border,#d8ddcf);
  border-radius:4px;
  min-height: 84px;
}
.template-section {
  border-top: 2px solid var(--border, #d8ddcf);
  margin: 28px 0;
  padding-top: 20px;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.template-step {
  border-top: 1px solid var(--border, #d8ddcf);
  padding: 18px 0;
  margin: 16px 0;
}
.template-sub {
  margin: 20px 0 20px 24px;
  padding-left: 16px;
  border-left: 2px solid var(--border, #d8ddcf);
}
.member-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 16px;
  max-height: 220px;
  overflow: auto;
}
.member-list label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.member-list input {
  width: 18px;
  height: 18px;
}
.member-list small {
  color: var(--muted, #64705d);
}
@media (max-width: 600px) {
  .template-sub {
    margin-left: 8px;
    padding-left: 10px;
  }
  .section-heading .button-row {
    flex-wrap: wrap;
  }
}
</style>
