<script setup lang="ts">
// Google 公司行事曆同步區（單向：系統寫到公司共用日曆，個人行程不同步）。只有 Google 管理權限者看得到（頁面決定）。
// M5 Q19：系統取消的行事會在 Google 上真的刪除，Google 事件描述加註「請勿在此修改，請回系統」。
// M5 Q20：頁頂常駐警示由頁面依同一份狀態顯示；這裡負責同步、檢查授權、重新連結、解除連結。
import { ref } from "vue";
import { api } from "../api";
import Modal from "./Modal.vue";
import { googleReconnectNeeded } from "../../../lib/workspace/calendar-rules";

export type GoogleStatus = {
  configured: boolean; calendarId: string | null; connected: boolean; calendarMatches: boolean; googleAccountEmail: string | null;
  connectedAt: string | null; lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncError: string | null; pendingCount: number;
};
type Diagnosis = { clientId: string; requiredScope: string; canManageCalendarEvents: boolean | null; grantedCalendarScopes: string[] | null; checkedAt: string };
const props = defineProps<{ status: GoogleStatus | null; statusError: string; connectHref: string }>();
const emit = defineEmits<{ changed: []; notice: [text: string] }>();
const syncing = ref(false);
const diagnosing = ref(false);
const diagnosis = ref<Diagnosis | null>(null);
const error = ref("");
const confirmDisconnect = ref(false);
const reconnect = () => googleReconnectNeeded(props.status?.lastSyncError);
const time = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const short = (s: string) => s.replace("https://www.googleapis.com/auth/", "");

async function sync() {
  syncing.value = true;
  error.value = "";
  try {
    const r = await api("calendar/google/sync", { method: "POST", body: "{}" });
    emit("notice", r.failed ? `Google 同步完成 ${r.synced || 0} 筆，${r.failed} 筆失敗，請稍後重試。` : `Google 公司日曆已同步 ${r.synced || 0} 筆公司行事與政府假日。`);
  } catch (e) {
    error.value = (e as Error).message || "Google 同步失敗";
  } finally {
    syncing.value = false;
    emit("changed");
  }
}
async function diagnose() {
  diagnosing.value = true;
  error.value = "";
  diagnosis.value = null;
  try {
    diagnosis.value = await api("calendar/google/diagnose", { method: "POST", body: "{}" });
  } catch (e) {
    error.value = (e as Error).message || "檢查 Google 授權範圍失敗";
  } finally {
    diagnosing.value = false;
  }
}
async function disconnect() {
  confirmDisconnect.value = false;
  syncing.value = true;
  error.value = "";
  try {
    await api("calendar/google/disconnect", { method: "POST", body: "{}" });
    emit("notice", "Google 公司日曆已解除連結；既有 Google 行事保留不刪除");
  } catch (e) {
    error.value = (e as Error).message || "解除 Google 連結失敗";
  } finally {
    syncing.value = false;
    emit("changed");
  }
}
</script>

<template>
  <section class="google" data-testid="google-panel" aria-label="Google 公司行事曆同步">
    <div class="head">
      <div>
        <h2>
          Google 公司行事曆
          <small v-if="status?.connected && !reconnect()" class="ok">已連結</small>
          <small v-else-if="status?.connected" class="warn">授權需更新</small>
          <small v-else class="muted">尚未連結</small>
        </h2>
        <p class="muted">單向同步公司行事與已發布政府假日（以系統為準）；個人行程不會同步。系統取消的行事會在 Google 上一併刪除，Google 事件描述會加註「請勿在此修改，請回系統」。</p>
        <p v-if="status?.calendarId" class="muted small">目標日曆：{{ status.calendarId }}</p>
        <p v-if="status?.googleAccountEmail" class="muted small">授權帳號：{{ status.googleAccountEmail }}</p>
      </div>
      <div class="actions">
        <a v-if="!status?.connected" :href="connectHref" :aria-disabled="!status?.configured" class="link-button" @click="!status?.configured && $event.preventDefault()">連結 Google</a>
        <template v-else>
          <button :disabled="diagnosing || syncing" @click="diagnose">{{ diagnosing ? "檢查中" : "檢查授權" }}</button>
          <button v-if="!reconnect()" class="primary" :disabled="syncing" @click="sync">{{ syncing ? "同步中" : "立即同步" }}</button>
          <a :href="connectHref" class="link-button" :class="{ attention: reconnect() }">重新連結</a>
          <button class="danger" :disabled="syncing" @click="confirmDisconnect = true">解除連結</button>
        </template>
      </div>
    </div>
    <p class="meta muted small">
      <span v-if="status?.lastSyncAt">最近同步：{{ time(status.lastSyncAt) }}</span>
      <span v-if="status?.pendingCount" class="warn">{{ status.pendingCount }} 筆待同步</span>
    </p>
    <p v-if="status && !status.configured" class="warn">尚未完成伺服器端 Google OAuth、日曆 ID 與加密金鑰設定。</p>
    <p v-if="statusError || error" role="alert" class="bad">{{ statusError || error }}</p>
    <p v-if="status?.lastSyncError" class="bad pre">同步待處理：{{ status.lastSyncError }}</p>
    <p v-if="status?.connected && !status.calendarMatches" role="alert" class="bad">伺服器目前設定的目標日曆與已連結日曆不同，已暫停同步。</p>
    <div v-if="diagnosis" role="status" class="diagnosis">
      <p class="small muted">伺服器使用的 OAuth Client ID：{{ diagnosis.clientId }}</p>
      <p class="small muted">系統要求：{{ short(diagnosis.requiredScope) }}</p>
      <p>
        {{ diagnosis.canManageCalendarEvents === true ? "授權範圍檢查：Google 回報包含日曆事件寫入權限。" : diagnosis.canManageCalendarEvents === false ? "授權範圍檢查：Google 回報未包含日曆事件寫入權限。" : "授權範圍檢查：Google 未在權杖回應中提供 scope，暫時無法判定。" }}
      </p>
      <p v-if="diagnosis.grantedCalendarScopes !== null" class="small">Google 回報的日曆 scope：{{ diagnosis.grantedCalendarScopes.length ? diagnosis.grantedCalendarScopes.map(short).join("、") : "沒有日曆 scope" }}</p>
      <p class="small muted">檢查時間：{{ time(diagnosis.checkedAt) }}</p>
    </div>
  </section>
  <Modal v-if="confirmDisconnect" title="解除 Google 連結" @cancel="confirmDisconnect = false">
    <p>解除後系統不會再更新 Google 日曆，但已同步到 Google 的行程不會刪除。之後仍可重新連結。確定解除？</p>
    <div class="dialog-actions">
      <button @click="confirmDisconnect = false">保留連結</button>
      <button class="danger" @click="disconnect">確定解除</button>
    </div>
  </Modal>
</template>

<style scoped>
.google { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 14px 16px; margin-bottom: 16px; display: grid; gap: 6px; }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 16px; }
h2 small { margin-left: 8px; font-size: 12px; font-weight: 500; }
p { margin: 0; }
.small { font-size: 12px; }
.ok { color: var(--primary); }
.warn { color: #8a6a1f; }
.bad { color: var(--danger); }
.pre { white-space: pre-wrap; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.meta { display: flex; flex-wrap: wrap; gap: 16px; }
.link-button { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); text-decoration: none; }
.link-button[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
.link-button.attention { border-color: #b18b42; background: var(--soft); font-weight: 600; }
.diagnosis { border-top: 1px solid var(--line); padding-top: 8px; display: grid; gap: 2px; }
</style>
