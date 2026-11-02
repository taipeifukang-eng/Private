<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, ApiError } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
import { flattenTaskSteps } from "../../../lib/workspace/task-state";
import TaskSchedule from "../components/TaskSchedule.vue";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession(),
  data = ref<any>(null),
  loading = ref(false),
  error = ref(""),
  confirming = ref(false),
  copyError = ref(""),
  pending = ref<any>(null),
  copied = ref(""),
  conflict = ref(false);
const flat = computed(() => flattenTaskSteps(data.value?.steps || []));
const dateOf = (s: string) =>
  s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "—";
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<any>("task-archive?id=" + props.tab.recordId);
    if(conflict.value){pending.value=null;conflict.value=false;}
    props.tab.title = "封存 · " + (data.value.template?.title || "任務");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function begin() {
  pending.value ||= {
    id: props.tab.recordId,
    version: data.value.workspace_version,
    writeId: crypto.randomUUID(),
  };
  confirming.value = true;
  copyError.value = "";
}
async function copy() {
  props.tab.busy = true;
  copyError.value = "";
  try {
    copied.value = (
      await api<any>("task-archive", {
        method: "POST",
        body: JSON.stringify(pending.value),
      })
    ).id;
    confirming.value = false;
    pending.value = null;
  } catch (e) {
    copyError.value = (e as Error).message;
    if(e instanceof ApiError && e.status===409)conflict.value=true;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">已封存任務 / 唯讀紀錄</p>
      <h1>{{ data?.template?.title || "封存任務紀錄" }}</h1>
    </div>
    <div class="button-row">
      <button :disabled="loading || tab.busy" @click="load">重新整理</button
      ><button
        class="primary"
        :disabled="!data?.template || tab.busy"
        @click="begin"
      >
        {{copied ? "再複製一份" : "複製為新任務"}}
      </button>
    </div>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="loading" role="status">載入封存明細…</p>
  <div v-if="copied" class="notice" role="status">
    新任務已建立並指派給你。原始執行紀錄未複製。<button
      v-if="session.data?.capabilities.tasks"
      @click="work.open('task-runner', '', copied)"
    >
      開啟新任務
    </button>
  </div>
  <template v-if="data"
    ><p>{{ data.template?.description }}</p>
    <dl class="archive-meta">
      <div>
        <dt>發起人</dt>
        <dd>{{ data.creator }}</dd>
      </div>
      <div>
        <dt>負責人</dt>
        <dd>{{ data.assignee }}</dd>
      </div>
      <div>
        <dt>部門</dt>
        <dd>{{ data.department || "未分部門" }}</dd>
      </div>
      <div>
        <dt>建立時間</dt>
        <dd>{{ dateOf(data.created_at) }}</dd>
      </div>
      <div>
        <dt>完成時間</dt>
        <dd>{{ dateOf(data.completed_at) }}</dd>
      </div>
      <div>
        <dt>封存時間 / 封存者</dt>
        <dd>{{ dateOf(data.archived_at) }} · {{ data.archiver }}</dd>
      </div>
    </dl>
    <p>
      協作成員：{{
        data.collaborators.map((c: any) => c.name).join("、") || "無"
      }}
    </p>
    <p>最後進度 {{ data.done }} / {{ data.total }}</p>
    <h2>項目與備註</h2>
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th>項目</th>
            <th>狀態</th>
            <th>最後備註</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="step in flat" :key="step.id">
            <td>
              {{ step.label }}
              <p class="muted">{{ step.description }}</p>
            </td>
            <td>{{ step.id in data.state ? "已完成" : "未完成" }}</td>
            <td class="archive-note">{{ data.state[step.id] || "—" }}</td>
          </tr>
          <tr v-if="!flat.length">
            <td colspan="3">沒有可用的範本項目。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <TaskSchedule :record="data" />
    <h2>執行時間軌跡</h2>
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th>時間</th>
            <th>操作人</th>
            <th>項目</th>
            <th>操作</th>
            <th>備註</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in data.logs" :key="log.id">
            <td>{{ dateOf(log.created_at) }}</td>
            <td>{{ log.name }}</td>
            <td>{{ log.label }}</td>
            <td>
              {{
                log.action === "complete"
                  ? "完成"
                  : log.action === "uncomplete"
                    ? "取消完成"
                    : log.action
              }}
            </td>
            <td class="archive-note">{{ log.note || "—" }}</td>
          </tr>
          <tr v-if="!data.logs.length">
            <td colspan="5">沒有執行紀錄。</td>
          </tr>
        </tbody>
      </table>
    </div></template
  >
  <Modal
    v-if="confirming"
    title="複製封存任務"
    :busy="tab.busy"
    @cancel="confirming = false"
    ><p>
      將「{{
        data.template.title
      }}」複製為新的本人任務，沿用流程範本；進度與紀錄重新開始。原封存紀錄會保留。
    </p>
    <p v-if="copyError" role="alert" class="notice error">{{ copyError }}</p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="confirming = false">取消</button
      ><button class="primary" :disabled="tab.busy" @click="copy">
        {{ tab.busy ? "複製中…" : "確認複製" }}
      </button>
    </div></Modal
  >
</template>
<style scoped>
.archive-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  margin: 24px 0;
}
.archive-meta dt {
  font-size: 12px;
  color: var(--muted, #64705d);
}
.archive-meta dd {
  margin: 6px 0 0;
}
.archive-note {
  white-space: pre-wrap;
  min-width: 150px;
  max-width: 520px;
  overflow-wrap: anywhere;
}
</style>
