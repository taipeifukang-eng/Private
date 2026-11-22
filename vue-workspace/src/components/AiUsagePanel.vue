<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "../api";

// M6 W33 系統管理員的「AI 用量」：本月估算費用、百分比、80%／100% 通知紀錄，以及可調整的每月上限（美元）。
// 費用是每次呼叫前的保守估算，不查 OpenAI 帳單；每月 1 日（台北時間）自動歸零；達 100% 自動停用 AI。
type Usage = {
  month_key: string; cap_usd: number; spent_usd: number; remaining_usd: number; percent: number; level: "ok" | "warn" | "capped";
  ai_enabled: boolean; ai_configured: boolean; calls: number; alerts: { level: "warn80" | "cap100"; at: string; spent_usd: number }[]; note: string;
};
const usage = ref<Usage | null>(null);
const cap = ref("");
const error = ref("");
const message = ref("");
const busy = ref(false);
const LEVEL: Record<string, string> = { ok: "正常", warn: "已達 80%", capped: "已達 100%，AI 已自動停用" };
const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const errText = (e: unknown, fb: string) => (e instanceof ApiError ? e.message : fb);

async function load() {
  error.value = "";
  try {
    usage.value = (await api<{ data: Usage }>("supervisor-management/ai-usage")).data;
    cap.value = String(usage.value.cap_usd);
  } catch (e) {
    error.value = errText(e, "載入 AI 用量失敗");
  }
}
async function save() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    usage.value = (await api<{ data: Usage }>("supervisor-management/ai-settings", { method: "PATCH", body: JSON.stringify({ monthly_cap_usd: cap.value }) })).data;
    cap.value = String(usage.value.cap_usd);
    message.value = "每月上限已更新";
  } catch (e) {
    error.value = errText(e, "儲存失敗，請重試");
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section data-testid="ai-usage" class="panel">
    <p v-if="error" role="alert" class="err">{{ error }}</p>
    <p v-if="message" role="status" class="ok" data-testid="ai-usage-message">{{ message }}</p>
    <template v-if="usage">
      <ul class="stats" aria-label="本月 AI 用量">
        <li><small>本月（{{ usage.month_key }}）估算費用</small><strong data-stat="spent">US$ {{ usage.spent_usd.toFixed(4) }}</strong><small>共 {{ usage.calls }} 次呼叫</small></li>
        <li><small>每月上限</small><strong data-stat="cap">US$ {{ usage.cap_usd.toFixed(2) }}</strong><small>剩餘 US$ {{ usage.remaining_usd.toFixed(4) }}</small></li>
        <li :class="{ warn: usage.level !== 'ok' }"><small>已用</small><strong data-stat="percent">{{ usage.percent }}%</strong><small data-stat="level">{{ LEVEL[usage.level] }}</small></li>
      </ul>
      <p v-if="!usage.ai_configured" class="warn" role="status">尚未設定 AI 服務金鑰，語音目前一律使用手動文字稿與本機規則。</p>
      <form class="cap" data-testid="ai-cap-form" @submit.prevent="save">
        <label>每月上限（美元，0 代表停用 AI）<input v-model="cap" inputmode="decimal" name="monthly_cap_usd" data-testid="ai-cap-input" /></label>
        <button class="primary" :disabled="busy" data-testid="ai-cap-save">{{ busy ? "儲存中…" : "儲存上限" }}</button>
      </form>
      <h3>本月通知紀錄</h3>
      <p v-if="!usage.alerts.length" class="empty">本月還沒有達到 80% 或 100%</p>
      <ul class="plain" data-testid="ai-alerts"><li v-for="a in usage.alerts" :key="a.level">{{ fmtTime(a.at) }}：{{ a.level === "warn80" ? "達 80%" : "達 100%，AI 自動停用" }}（估算 US$ {{ a.spent_usd.toFixed(4) }}）</li></ul>
      <p class="note">{{ usage.note }} 只有系統管理員會在首頁收到提醒。</p>
    </template>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: 14px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; padding: 0; list-style: none; margin: 0; }
.stats li { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; background: var(--surface); }
.stats strong { font-size: 1.5rem; }
.stats .warn strong { color: #b45309; }
small, .note, .empty { color: var(--muted); }
.cap { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.cap label { display: flex; flex-direction: column; gap: 7px; min-width: 220px; flex: 1; }
.cap input { padding: 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--surface); font: inherit; box-sizing: border-box; width: 100%; }
.plain { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.err { color: #a32a23; }
.ok, .warn { padding: 10px 12px; border-radius: 6px; margin: 0; }
.ok { border: 1px solid var(--primary); background: var(--soft); }
.warn { border: 1px solid #c98a15; background: #fbf1d9; color: #6a4300; }
h3 { margin: 6px 0; }
</style>
