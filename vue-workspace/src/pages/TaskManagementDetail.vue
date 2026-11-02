<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, ApiError } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
import { flattenTaskSteps } from "../../../lib/workspace/task-state";
import Modal from "../components/Modal.vue";
import TaskSchedule from "../components/TaskSchedule.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession(),
  data = ref<any>(null),
  loading = ref(false),
  error = ref(""),
  confirming = ref(false),
  archiveError = ref(""),
  pending = ref<any>(null),
  conflict = ref(false),
  saved = ref<number | null>(null);
const ready = computed(
  () =>
    data.value?.records.length > 0 &&
    data.value.records.every((r: any) => r.total > 0 && r.done === r.total),
);
const dateOf = (s: string) =>
  s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "—";
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<any>("task-management?id=" + props.tab.recordId);
    props.tab.title = "管理 · " + data.value.template.title;
    if (conflict.value) {
      pending.value = null;
      conflict.value = false;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function begin() {
  pending.value ||= {
    id: props.tab.recordId,
    writeId: crypto.randomUUID(),
    versions: data.value.records.map((r: any) => ({
      id: r.id,
      version: r.workspace_version,
    })),
  };
  confirming.value = true;
  archiveError.value = "";
}
async function archive() {
  props.tab.busy = true;
  archiveError.value = "";
  try {
    saved.value = (
      await api<any>("task-management", {
        method: "POST",
        body: JSON.stringify(pending.value),
      })
    ).count;
    pending.value = null;
    confirming.value = false;
    await load();
  } catch (e) {
    archiveError.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 409) conflict.value = true;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">任務管理 / 現行指派</p>
      <h1>{{ data?.template.title || "任務管理明細" }}</h1>
    </div>
    <div class="button-row"><button :disabled="!data || tab.busy" @click="work.open('task-copy','',tab.recordId)">複製範本</button><button :disabled="!data || tab.busy" @click="work.open('task-assign','',tab.recordId)">派發／重新指派</button>
      <button
        v-if="data?.canEdit"
        @click="work.open('task-template-editor', '', tab.recordId)"
      >
        編輯範本
      </button>
      <button :disabled="loading || tab.busy" @click="load">重新整理</button
      ><button
        v-if="data?.canArchive"
        class="primary"
        :disabled="!ready || loading || tab.busy"
        @click="begin"
      >
        封存全部完成任務
      </button>
    </div>
  </header>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="loading" role="status">載入管理明細…</p>
  <div v-if="saved !== null" class="notice" role="status">
    已封存 {{ saved }} 筆任務，範本與歷史紀錄保留。<button
      v-if="session.data?.capabilities.taskArchive"
      @click="work.open('task-archive')"
    >
      查看已封存任務
    </button>
  </div>
  <template v-if="data"
    ><p>{{ data.template.description }}</p>
    <p v-if="data.records.length && !ready" class="muted">
      所有現行指派的主項與子項完成後，才能整批封存。
    </p>
    <p v-if="!data.records.length">此範本沒有現行指派。</p>
    <section
      v-for="r in data.records"
      :key="r.id"
      class="managed-assignment"
      :data-assignment-id="r.id"
    >
      <h2>{{ r.assignee }} · {{ r.department || "未分部門" }}</h2>
      <p>
        實際完成 {{ r.done }} / {{ r.total }} ·
        {{ r.total > 0 && r.total === r.done ? "所有項目已完成" : "尚未完成" }}
      </p>
      <p class="muted">
        指派：{{ dateOf(r.created_at) }} · 完成：{{ dateOf(r.completed_at) }}
      </p>
      <p>
        協作成員：{{
          r.collaborators.map((c: any) => c.name).join("、") || "無"
        }}
      </p>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>狀態</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="step in flattenTaskSteps(r.steps)" :key="step.id">
              <td>
                {{ step.label }}
                <p class="muted">{{ step.description }}</p>
              </td>
              <td>{{ step.id in r.state ? "已完成" : "未完成" }}</td>
              <td class="managed-note">{{ r.state[step.id] || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>查看排程與執行時間軌跡</summary>
        <TaskSchedule :record="r" />
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
              <tr v-for="log in r.logs" :key="log.id">
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
                <td class="managed-note">{{ log.note || "—" }}</td>
              </tr>
              <tr v-if="!r.logs.length">
                <td colspan="5">沒有執行紀錄。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section></template
  >
  <Modal
    v-if="confirming"
    title="封存全部完成任務"
    :busy="tab.busy"
    @cancel="confirming = false"
    ><p>
      將「{{ data.template.title }}」的
      {{ pending.versions.length }}
      筆現行指派封存。封存後會離開現行任務清單，範本與執行紀錄保留供歷史查閱。
    </p>
    <p v-if="archiveError" role="alert" class="notice error">
      {{ archiveError }}
    </p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="confirming = false">取消</button
      ><button
        class="primary"
        :disabled="tab.busy || conflict"
        @click="archive"
      >
        {{ tab.busy ? "封存中…" : "確認封存" }}
      </button>
    </div></Modal
  >
</template>
<style scoped>
.managed-assignment {
  border-top: 1px solid var(--border, #d8ddcf);
  margin-top: 28px;
  padding-top: 20px;
}
.managed-assignment summary {
  cursor: pointer;
  margin: 20px 0;
  font-weight: 600;
}
.managed-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 160px;
  max-width: 520px;
}
</style>
