<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import TaskSchedule from "../components/TaskSchedule.vue";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import {
  applyTaskChanges,
  flattenTaskSteps,
  type TaskChange,
} from "../../../lib/workspace/task-state";
const work = useWorkspace(),
  session = useSession(),
  newer = ref(false),
  refreshError = ref("");
let timer: ReturnType<typeof setInterval>;
const props = defineProps<{ tab: WorkTab }>(),
  data = ref<any>(null),
  error = ref(""),
  message = ref(""),
  loading = ref(false),
  changes = ref<TaskChange[]>([]),
  state = ref<Record<string, string>>({}),
  schedule = ref(false),
  pending = ref<any>(null);
const flat = computed(() => flattenTaskSteps(data.value?.steps || []));
const groups = computed(
  () => data.value?.groups || [{ sectionId: null, department: "", steps: data.value?.steps || [] }],
);
const labelOf = computed(
  () => new Map(flat.value.map((s: any) => [s.id, s.label])),
);
const history = computed(() =>
  ((data.value?.logs || []) as any[])
    .filter((l) => labelOf.value.has(l.step_id))
    .slice()
    .reverse(),
);
function logText(l: any) {
  const act = l.action === "complete" ? "勾選" : "取消勾選";
  return l.proxy
    ? `由 ${l.actorName} 代為${l.action === "complete" ? "勾選" : "取消"}`
    : `${l.actorName} ${act}`;
}
const done = computed(
  () => flat.value.filter((s) => s.id in state.value).length,
);
async function checkLatest() {
  if (
    !data.value ||
    props.tab.busy ||
    loading.value ||
    work.active !== props.tab.id
  )
    return;
  try {
    const latest = await api<any>("task-detail?id=" + props.tab.recordId);
    newer.value = latest.workspace_version !== data.value.workspace_version;
    refreshError.value = "";
  } catch (e) {
    refreshError.value = (e as Error).message;
  }
}
function openLatest() {
  work.open("task-runner", "", props.tab.recordId);
}
async function finish() {
  if (!changes.value.length && data.value) {
    changes.value = data.value.steps.map((s: any) => ({
      stepId: s.id,
      checked: true,
      note: state.value[s.id] || "",
    }));
    props.tab.dirty = changes.value.length > 0;
  }
  if (await save()) {
    work.open("my-tasks");
    work.remove([props.tab.id]);
  }
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<any>("task-detail?id=" + props.tab.recordId);
    state.value = { ...data.value.state };
    newer.value = false;
    refreshError.value = "";
    changes.value = [];
    pending.value = null;
    props.tab.dirty = false;
    props.tab.title = data.value.template.title;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function change(stepId: string, checked: boolean, note?: string) {
  if (props.tab.busy || pending.value) return;
  const c = { stepId, checked, note };
  state.value = applyTaskChanges(data.value.steps, state.value, [c]).state;
  const last = changes.value[changes.value.length - 1];
  if (note !== undefined && last?.stepId === stepId && last.checked === checked)
    changes.value[changes.value.length - 1] = c;
  else changes.value.push(c);
  props.tab.dirty = true;
  message.value = "";
}
async function save() {
  if (!changes.value.length) return true;
  props.tab.busy = true;
  error.value = "";
  message.value = "";
  try {
    pending.value ||= {
      id: props.tab.recordId,
      version: data.value.workspace_version,
      writeId: crypto.randomUUID(),
      changes: JSON.parse(JSON.stringify(changes.value)),
    };
    await api("task-detail", {
      method: "POST",
      body: JSON.stringify(pending.value),
    });
    changes.value = [];
    props.tab.dirty = false;
    pending.value = null;
    await load();
    message.value = "任務進度已儲存";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = save;
props.tab.discard = load;
onMounted(() => {
  void load();
  timer = setInterval(checkLatest, 30000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  props.tab.save = undefined;
  props.tab.discard = undefined;
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">派發任務 / 填寫進度</p>
      <h1>{{ data?.template.title || "任務內容" }}</h1>
      <p v-if="data" class="muted">
        {{ data.creator }} 派發 · {{ data.proxy ? "全部項目" : "我的項目" }} {{ done }} / {{ flat.length }}
      </p>
    </div>
    <div class="button-row">
      <button
        v-if="flat.length && done === flat.length"
        :disabled="tab.busy || loading"
        @click="finish"
      >
        完成並返回我的任務
      </button>
      <button :disabled="loading || tab.dirty || tab.busy" @click="load">
        重新整理</button
      ><button :disabled="!data" @click="schedule = !schedule">
        {{ schedule ? "收起排程" : "查看甘特排程" }}</button
      ><button class="primary" :disabled="!tab.dirty || tab.busy" @click="save">
        {{ tab.busy ? "儲存中…" : "儲存進度" }}
      </button>
    </div>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="message" role="status" class="notice">{{ message }}</p>
  <div v-if="pending || newer" class="notice" role="status">
    <p>
      {{
        pending
          ? "儲存尚未確認，請重試或開啟最新版本核對。"
          : "其他人已更新此任務。"
      }}
      此頁的草稿與備註仍保留。
    </p>
    <button :disabled="tab.busy" @click="openLatest">開啟最新版本核對</button>
  </div>
  <p v-if="refreshError" class="notice">
    無法確認協作更新：{{ refreshError }}
    <button @click="checkLatest">重新檢查更新</button>
  </p>
  <p v-if="loading" role="status">載入任務…</p>
  <template v-if="data">
    <p v-if="data.proxy" class="notice" role="status" data-flag="proxy">
      你不是此任務的參與者。你的勾選與備註會記錄為「由 {{ session.data?.user.name || "你" }} 代為勾選」。
    </p>
    <p>{{ data.template.description }}</p>
    <p class="muted">
      協作成員：{{ data.collaborators.map((c: any) => c.name + (c.support ? "（跨部門支援）" : "")).join("、") }}
    </p>
    <TaskSchedule v-if="schedule" :record="data" />
    <fieldset class="task-checklist" :disabled="tab.busy || !!pending">
      <legend>我的工作項目</legend>
      <p v-if="!flat.length">尚未設定可操作項目，請聯絡派發人員。</p>
      <template v-for="g in groups" :key="g.sectionId ?? 'all'">
      <h3 v-if="data.proxy && groups.length > 1">{{ g.department || "區段" }}</h3>
      <section v-for="s in g.steps" :key="s.id" class="task-step">
        <label class="task-check"
          ><input
            type="checkbox"
            :checked="s.id in state"
            @change="change(s.id, ($event.target as HTMLInputElement).checked)"
          /><strong>{{ s.label }}</strong
          ><span v-if="s.required" class="muted">必填</span></label
        >
        <p v-if="s.description">{{ s.description }}</p>
        <label v-if="s.id in state" class="task-note"
          >{{ s.label }}備註<textarea
            :value="state[s.id]"
            maxlength="5000"
            @input="
              change(s.id, true, ($event.target as HTMLTextAreaElement).value)
            "
          ></textarea>
        </label>
        <div v-for="sub in s.subSteps || []" :key="sub.id" class="task-sub">
          <label class="task-check"
            ><input
              type="checkbox"
              :checked="sub.id in state"
              @change="
                change(sub.id, ($event.target as HTMLInputElement).checked)
              "
            />{{ sub.label }}</label
          >
          <p v-if="sub.description">{{ sub.description }}</p>
          <label v-if="sub.id in state" class="task-note"
            >{{ sub.label }}備註<textarea
              :value="state[sub.id]"
              maxlength="5000"
              @input="
                change(
                  sub.id,
                  true,
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            ></textarea>
          </label>
        </div>
      </section>
      </template>
    </fieldset>
    <section class="task-history" aria-label="步驟紀錄">
      <h2>步驟紀錄</h2>
      <p v-if="!history.length" class="muted">尚無勾選紀錄。</p>
      <ul v-else>
        <li v-for="l in history" :key="l.id" :data-proxy="l.proxy">
          {{ new Date(l.created_at).toLocaleString("zh-TW") }}　{{ logText(l) }}　{{ labelOf.get(l.step_id) }}
          <span v-if="l.note" class="muted">（備註：{{ l.note }}）</span>
        </li>
      </ul>
    </section>
  </template>
</template>
<style scoped>
.task-checklist {
  border: 0;
  padding: 0;
  min-width: 0;
  margin-top: 24px;
}
.task-checklist legend {
  font-weight: 700;
}
.task-step {
  padding: 20px 0;
  border-bottom: 1px solid var(--border, #d8ddcf);
}
.task-check {
  display: flex;
  align-items: center;
  gap: 12px;
}
.task-check input {
  width: 20px;
  height: 20px;
}
.task-sub {
  margin: 16px 0 0 32px;
}
.task-note {
  display: block;
  margin-top: 12px;
  max-width: 760px;
}
.task-note textarea {
  display: block;
  width: 100%;
  min-height: 72px;
  margin-top: 6px;
}
</style>
