<script setup lang="ts">
// 個人行程分享（舊版分享視窗）：建立者可新增與撤回；被分享的人可轉分享，原分享者或建立者可撤回（撤回會讓下游的人一併看不到）。
import { ref, onMounted } from "vue";
import { api } from "../api";
import Modal from "./Modal.vue";
import CalendarPeoplePicker, { type Person } from "./CalendarPeoplePicker.vue";

type Share = {
  id: string; event_id: string; parent_share_id: string | null; shared_by_user_id: string; shared_with_user_id: string;
  created_at: string; revoked_at: string | null; is_effective: boolean;
};
type ShareData = { shares: Share[]; isOwner: boolean; currentUserId: string; owner: Person | null; people: Record<string, { name: string; employee_code: string | null }> };
const props = defineProps<{ eventId: string; title: string; currentUserId: string }>();
const emit = defineEmits<{ close: []; notice: [text: string] }>();
const data = ref<ShareData | null>(null);
const recipients = ref<Person[]>([]);
const loading = ref(false);
const error = ref("");
const revoking = ref<Share | null>(null);

async function load() {
  loading.value = true;
  try {
    data.value = await api<ShareData>(`calendar/shares?event_id=${encodeURIComponent(props.eventId)}`);
  } catch (e) {
    error.value = (e as Error).message || "無法載入分享設定";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const myGrant = () => data.value?.shares.find((s) => s.shared_with_user_id === props.currentUserId && s.is_effective);
const canShare = () => Boolean(data.value?.isOwner || myGrant());

async function add() {
  if (!data.value || !recipients.value.length) return;
  loading.value = true;
  error.value = "";
  try {
    const parent = data.value.isOwner ? null : myGrant()?.id;
    if (!data.value.isOwner && !parent) throw new Error("目前沒有有效的分享權限");
    for (const person of recipients.value) {
      await api("calendar/shares", {
        method: "POST",
        body: JSON.stringify({ event_id: props.eventId, shared_with_user_id: person.id, parent_share_id: parent }),
      });
    }
    recipients.value = [];
    emit("notice", "分享對象已新增");
    await load();
  } catch (e) {
    error.value = (e as Error).message || "分享失敗";
    loading.value = false;
  }
}
async function revoke() {
  const share = revoking.value;
  revoking.value = null;
  if (!share) return;
  loading.value = true;
  error.value = "";
  try {
    await api(`calendar/shares?id=${encodeURIComponent(share.id)}`, { method: "DELETE" });
    emit("notice", "分享已撤回");
    await load();
  } catch (e) {
    error.value = (e as Error).message || "撤回分享失敗";
    loading.value = false;
  }
}
const personName = (id: string) => data.value?.people[id]?.name || "使用者";
const personCode = (id: string) => data.value?.people[id]?.employee_code;
</script>

<template>
  <Modal :title="`分享個人行程：${title}`" wide @cancel="emit('close')">
    <div data-testid="share-dialog" class="share">
      <p v-if="error" role="alert" class="notice error">{{ error }}</p>
      <div v-if="canShare()">
        <CalendarPeoplePicker :selected="recipients" :label="data?.isOwner ? '新增分享對象' : '轉分享給'" @change="recipients = $event" />
        <div class="dialog-actions">
          <button class="primary" :disabled="loading || !recipients.length" @click="add">{{ loading ? "處理中…" : "分享行程" }}</button>
        </div>
      </div>
      <h3>分享對象 <small>可轉分享，建立者可撤回</small></h3>
      <p v-if="loading && !data" role="status">載入分享設定…</p>
      <ul v-else-if="data?.shares.length" class="share-list">
        <li v-for="s in data.shares" :key="s.id">
          <span>
            <strong>{{ personName(s.shared_with_user_id) }}{{ personCode(s.shared_with_user_id) ? ` · ${personCode(s.shared_with_user_id)}` : "" }}</strong>
            <small>由 {{ personName(s.shared_by_user_id) }} 分享</small>
          </span>
          <span class="state" :class="{ off: !s.is_effective }">{{ s.is_effective ? "可查看" : "已失效" }}</span>
          <button
            v-if="(data.isOwner || s.shared_by_user_id === currentUserId) && s.is_effective"
            class="danger"
            :aria-label="`撤回分享給${personName(s.shared_with_user_id)}`"
            @click="revoking = s"
          >撤回</button>
        </li>
      </ul>
      <p v-else class="muted">尚未分享給其他人</p>
      <p v-if="data && !data.isOwner" class="muted">行程建立者：{{ data.owner?.name || "使用者" }}。你只能查看，也可以轉分享給其他同仁。</p>
      <div class="dialog-actions"><button @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
  <Modal v-if="revoking" title="撤回分享" @cancel="revoking = null">
    <p>撤回後，這個分享以及由此轉分享出去的對象都將無法查看。確定撤回？</p>
    <div class="dialog-actions">
      <button @click="revoking = null">保留分享</button>
      <button class="danger" @click="revoke">確定撤回</button>
    </div>
  </Modal>
</template>

<style scoped>
.share { display: grid; gap: 16px; }
h3 { margin: 0; font-size: 15px; }
h3 small { margin-left: 8px; color: var(--muted); font-weight: 400; }
.share-list { list-style: none; margin: 0; padding: 0; display: grid; }
.share-list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.share-list li > span:first-child { flex: 1; display: grid; }
.share-list small { color: var(--muted); }
.state { color: var(--primary); font-size: 13px; }
.state.off { color: var(--muted); }
p { margin: 0; }
</style>
