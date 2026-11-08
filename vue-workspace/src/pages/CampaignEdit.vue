<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { api, ApiError, type Campaign } from "../api";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import { publishedAudiences } from "../../../lib/workspace/campaign-rules";
const props = defineProps<{ tab: WorkTab; embedded?: boolean }>();
const emit=defineEmits<{saved:[]}>();
const session = useSession(),
  work = useWorkspace();
const form = ref({
  name: "",
  start_date: "",
  end_date: "",
  campaign_type: "promotion",
  is_active: true,
});
const baseline = ref(JSON.stringify(form.value)),
  version = ref(0),
  requestId = crypto.randomUUID();
const loading = ref(false),
  error = ref(""),
  message = ref(""),
  stale = ref(false),
  conflict = ref(false),
  showReload = ref(false),
  errorModal = ref(false);
const fields = ref<Record<string, string>>({});
// M5 Q4／Q5c：改期前列出期間外的門市；已發布活動儲存前提示立即生效。
const outside = ref<{ store_id: string; store_code: string; store_name: string; activity_date: string }[]>([]),
  dialog = ref<"" | "outside" | "published">(""),
  published = ref<string[]>([]);
const readOnly = computed(
  () => !session.data?.capabilities.editCampaigns || session.expired,
);
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
watch(dirty, (value) => {
  props.tab.dirty = value;
});
watch(
  () => form.value.name,
  (name) => {
    props.tab.title = name.trim()
      ? `活動 · ${name.trim()}`
      : props.tab.recordId
        ? "編輯活動"
        : "新增活動";
  },
);
watch(
  () => work.campaignRevision,
  () => {
    if (work.lastSavedTab !== props.tab.id) stale.value = true;
  },
);
function accept(record: Campaign) {
  form.value = {
    name: record.name,
    start_date: record.start_date,
    end_date: record.end_date,
    campaign_type: record.campaign_type,
    is_active: record.is_active,
  };
  baseline.value = JSON.stringify(form.value);
  version.value = record.workspace_version;
  published.value = publishedAudiences(record);
  props.tab.recordId = record.id;
  props.tab.dirty = false;
  conflict.value = false;
  stale.value = false;
}
async function load() {
  if (!props.tab.recordId) return;
  loading.value = true;
  error.value = "";
  fields.value = {};
  try {
    const result = await api(`campaigns?id=${props.tab.recordId}`);
    if (!result.records?.length) throw new Error("此活動已不存在或無法查看");
    accept(result.records[0]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function validate() {
  const next: Record<string, string> = {};
  if (!form.value.name.trim()) next.name = "請填寫活動名稱";
  if (!form.value.start_date) next.start_date = "請選擇開始日期";
  if (!form.value.end_date || form.value.end_date < form.value.start_date)
    next.end_date = "結束日期不得早於開始日期";
  fields.value = next;
  return Object.keys(next).length === 0;
}
async function save(): Promise<boolean> {
  if (
    readOnly.value ||
    props.tab.busy ||
    loading.value ||
    (props.tab.recordId && !version.value)
  )
    return false;
  if (!validate()) {
    error.value = "請修正標示的欄位後再儲存";
    await nextTick();
    (
      document
        .getElementById("panel-" + props.tab.id)
        ?.querySelector('[aria-invalid="true"]') as HTMLElement
    )?.focus();
    return false;
  }
  outside.value = [];
  if (props.tab.recordId) {
    const was = JSON.parse(baseline.value);
    if (was.start_date !== form.value.start_date || was.end_date !== form.value.end_date) {
      props.tab.busy = true;
      error.value = "";
      try {
        const r = await api(`campaigns?${new URLSearchParams({ id: props.tab.recordId, preview: "outside", start: form.value.start_date, end: form.value.end_date })}`);
        outside.value = r.outside || [];
      } catch (e) {
        error.value = (e as Error).message;
        return false;
      } finally {
        props.tab.busy = false;
      }
    }
    if (outside.value.length) {
      dialog.value = "outside";
      return false;
    }
    if (published.value.length) {
      dialog.value = "published";
      return false;
    }
  }
  return commit();
}
function afterOutside() {
  if (published.value.length) dialog.value = "published";
  else {
    dialog.value = "";
    void commit();
  }
}
async function commit(): Promise<boolean> {
  dialog.value = "";
  props.tab.busy = true;
  error.value = "";
  message.value = "";
  try {
    const result = await api("campaigns", {
      method: props.tab.recordId ? "PUT" : "POST",
      body: JSON.stringify({
        ...form.value,
        id: props.tab.recordId,
        version: version.value,
        requestId,
        ...(outside.value.length ? { moveOutside: true } : {}),
      }),
    });
    work.lastSavedTab = props.tab.id;
    work.campaignRevision++;
    accept(result.record);
    message.value = result.moved ? `已儲存活動資料，並將 ${result.moved} 間期間外的門市移回「尚未安排」` : "已儲存活動資料";
    outside.value = [];
    emit('saved');
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    conflict.value = e instanceof ApiError && e.status === 409;
    errorModal.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = save;
props.tab.discard = async () => {
  if (props.tab.recordId) await load();
  else {
    form.value = JSON.parse(baseline.value);
    props.tab.dirty = false;
  }
};
onMounted(load);
function reload() {
  showReload.value = false;
  void load();
}
</script>
<template>
  <header v-if="!embedded" class="page-heading">
    <div>
      <p class="eyebrow">活動管理 / 基本資料</p>
      <h1>{{ tab.recordId ? "活動基本資料" : "新增活動" }}</h1>
      <p class="muted">
        公司檔期不隨全站門市切換。{{
          readOnly ? "目前為唯讀模式。" : "切換頁籤會保留尚未儲存的內容。"
        }}
      </p>
    </div>
    <span class="save-status">{{
      tab.busy ? "儲存中…" : dirty ? "尚未儲存" : "沒有未儲存變更"
    }}</span>
  </header>
  <div v-if="stale && !conflict" class="notice">
    其他工作頁已儲存活動。你的編輯內容仍保留。<button
      @click="dirty ? (showReload = true) : load()"
    >
      重新載入
    </button>
  </div>
  <div v-if="error" class="notice error" role="alert">
    {{ error
    }}<button v-if="tab.recordId" @click="dirty ? (showReload = true) : load()">
      重新載入比對
    </button>
  </div>
  <div v-if="message" class="notice success" role="status">{{ message }}</div>
  <div v-if="loading" class="empty" role="status">正在讀取活動資料…</div>
  <form v-else class="edit-form" @submit.prevent="save" novalidate>
    <fieldset :disabled="readOnly || tab.busy || (!!tab.recordId && !version)">
      <legend>檔期設定</legend>
      <label
        >活動名稱 <span class="required">必填</span
        ><input
          v-model="form.name"
          maxlength="120"
          :aria-invalid="!!fields.name"
          :aria-describedby="fields.name ? tab.id + '-name-error' : undefined"
          placeholder="例如：十一月門市促銷活動"
        /><small
          v-if="fields.name"
          :id="tab.id + '-name-error'"
          class="field-error"
          >{{ fields.name }}</small
        ></label
      >
      <div class="form-grid">
        <label
          >開始日期 <span class="required">必填</span
          ><input
            type="date"
            v-model="form.start_date"
            min="2000-01-01"
            max="2099-12-31"
            :aria-invalid="!!fields.start_date"
          /><small class="field-error" v-if="fields.start_date">{{
            fields.start_date
          }}</small></label
        ><label
          >結束日期 <span class="required">必填</span
          ><input
            type="date"
            v-model="form.end_date"
            min="2000-01-01"
            max="2099-12-31"
            :aria-invalid="!!fields.end_date"
          /><small class="field-error" v-if="fields.end_date">{{
            fields.end_date
          }}</small></label
        >
      </div>
      <div class="form-grid">
        <label
          >活動類型<select v-model="form.campaign_type">
            <option value="promotion">促銷（母親節／周年慶等）</option>
            <option value="inventory">盤點活動</option>
          </select></label
        ><label
          >啟用狀態<select v-model="form.is_active">
            <option :value="true">啟用</option>
            <option :value="false">停用（對督導、店長、活動檢視隱藏）</option>
          </select></label
        >
      </div>
    </fieldset>
    <footer class="form-footer">
      <span>{{
        conflict
          ? "有版本衝突，請先比對最新資料"
          : embedded ? "儲存後返回活動列表" : "儲存後可繼續編輯或關閉此頁籤"
      }}</span
      ><button
        type="button"
        v-if="tab.recordId"
        @click="dirty ? (showReload = true) : load()"
        :disabled="tab.busy"
      >
        重新載入</button
      ><button
        v-if="!readOnly"
        class="primary"
        :disabled="!dirty || tab.busy || conflict"
      >
        {{ tab.busy ? "儲存中…" : "儲存活動" }}
      </button>
    </footer>
  </form>
  <Modal v-if="showReload" title="重新載入活動？" @cancel="showReload = false"
    ><p>這會放棄此頁尚未儲存的修改，並讀取最新資料。</p>
    <div class="dialog-actions">
      <button @click="showReload = false">繼續編輯</button
      ><button class="danger" @click="reload">放棄修改並載入</button>
    </div></Modal
  >
  <Modal v-if="dialog === 'outside'" title="有門市排程落在新的活動期間外" @cancel="dialog = ''"
    ><p>新期間是 {{ form.start_date }} 到 {{ form.end_date }}。以下 {{ outside.length }} 間門市目前排的日期不在期間內，確認後會一併移回「尚未安排」（排程日期會清除，需要時再重新排）。</p>
    <ul class="outside"><li v-for="o in outside" :key="o.store_id">{{ o.store_code }} {{ o.store_name }}：原排 {{ o.activity_date }}</li></ul>
    <div class="dialog-actions">
      <button @click="dialog = ''">返回修改日期</button
      ><button class="danger" @click="afterOutside">確認並移回尚未安排</button>
    </div></Modal
  >
  <Modal v-if="dialog === 'published'" title="此活動已發布，儲存後立即生效" @cancel="dialog = ''"
    ><p>此活動已發布給{{ published.join("、") }}，儲存後他們看到的內容會立即改變，系統不會另外通知。確定要儲存嗎？</p>
    <div class="dialog-actions">
      <button @click="dialog = ''">返回</button
      ><button class="primary" @click="commit">確認儲存</button>
    </div></Modal
  >
  <Modal
    v-if="errorModal"
    :title="conflict ? '活動已被更新' : '尚未儲存成功'"
    @cancel="errorModal = false"
    ><p>{{ error }}</p>
    <p>你的修改仍保留在此頁。</p>
    <div class="dialog-actions">
      <button class="primary" @click="errorModal = false">返回編輯</button>
    </div></Modal
  >
</template>
