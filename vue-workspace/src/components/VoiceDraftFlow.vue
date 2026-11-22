<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../api";
import Modal from "./Modal.vue";
import VoiceRecorder from "./VoiceRecorder.vue";
import type { VoiceApply, VoiceDraft as Draft, VoiceTranscribeResult } from "../lib/voice-upload";
import { FALLBACK_LABEL } from "../../../lib/supervisor-management-log/voice-ai-rules";

// M6 W33 語音口述流程（錄音 -> 文字稿 -> 草稿審核）。AI 只產生草稿，這裡不會寫入任何資料：
// 「套用到管理紀錄表單」只是把草稿帶進新增紀錄的表單，仍要由使用者在表單按「儲存紀錄」才會存成管理紀錄（發現、判斷、動作三欄必填）。
// E5：第一次使用要先看告知並勾選同意；E7：AI 不可用或失敗時改用手動文字稿與本機規則，草稿標示「這份草稿未經 AI 整理」。
type Status = {
  ai_available: boolean; ai_unavailable_reason: string | null; ai_unavailable_message: string | null;
  consent: { accepted: boolean; version: string; notice: string };
  limits: { max_transcript_chars: number };
};
type Match = { type: "STORE" | "EMPLOYEE"; mention: string; status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND"; candidates: { id: string; label: string }[] };
type DraftResult = {
  draft: Draft; entity_matches: Match[]; blocking_fields: string[]; confirmation_questions: string[]; warnings: string[];
  ai_provider: "OPENAI" | "LOCAL_RULE_FALLBACK"; fallback: boolean; fallback_reason: string | null; fallback_label: string | null; message?: string;
};

const emit = defineEmits<{ cancel: []; apply: [payload: VoiceApply] }>();
const ACTION_OPTIONS = ["現場說明", "主管約談", "教育訓練", "限期改善", "跨部門協調", "文件補正", "持續追蹤"];
const MATCH: Record<string, string> = { MATCHED: "已比對到", AMBIGUOUS: "有多個可能", NOT_FOUND: "找不到" };

const status = ref<Status | null>(null);
const loading = ref(true);
const error = ref("");
const busy = ref(false);
const agree = ref(false);
const step = ref<"input" | "review">("input");
const transcript = ref("");
const transcriptSource = ref<"AI" | "MANUAL" | "">("");
const notice = ref("");
const result = ref<DraftResult | null>(null);
const draft = ref<Draft | null>(null);

const needConsent = computed(() => !!status.value && !status.value.consent.accepted);
const missing = computed(() => {
  const d = draft.value;
  if (!d) return [];
  const m: string[] = [];
  if (!d.observation.trim()) m.push("發現或觀察");
  if (!d.judgment.trim()) m.push("管理判斷");
  if (!d.action_summary.trim()) m.push("管理動作");
  if (d.requires_follow_up && !d.follow_up_date) m.push("追蹤日期");
  return m;
});
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

onMounted(async () => {
  try {
    status.value = (await api<{ data: Status }>("supervisor-management/voice/status")).data;
  } catch (e) {
    error.value = errText(e, "載入語音設定失敗");
  } finally {
    loading.value = false;
  }
});
async function consent() {
  if (!agree.value || !status.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api("supervisor-management/voice/consent", { method: "POST", body: JSON.stringify({ accept: true, version: status.value.consent.version }) });
    status.value.consent.accepted = true;
  } catch (e) {
    error.value = errText(e, "記錄同意失敗，請重試");
  } finally {
    busy.value = false;
  }
}
function onTranscribed(r: VoiceTranscribeResult) {
  error.value = "";
  if (r.fallback || r.transcript === null) {
    notice.value = r.message || "AI 目前無法使用，請改用手動文字稿。";
    if (status.value) status.value.ai_available = false;
    return;
  }
  transcript.value = r.transcript;
  transcriptSource.value = "AI";
  notice.value = "已轉成文字，請確認或修改文字稿後再產生草稿。";
}
async function makeDraft() {
  if (!transcript.value.trim()) return void (error.value = "請先錄音或輸入文字稿");
  busy.value = true;
  error.value = "";
  try {
    const res = await api<{ data: DraftResult }>("supervisor-management/voice/draft", { method: "POST", body: JSON.stringify({ transcript: transcript.value, mode: "RECORD_DRAFT" }) });
    result.value = res.data;
    draft.value = { ...res.data.draft, action_options: [...res.data.draft.action_options] };
    step.value = "review";
  } catch (e) {
    error.value = errText(e, "產生草稿失敗，請重試");
  } finally {
    busy.value = false;
  }
}
function toggleOption(o: string) {
  const d = draft.value;
  if (!d) return;
  d.action_options = d.action_options.includes(o) ? d.action_options.filter((x) => x !== o) : [...d.action_options, o];
}
function apply() {
  if (!draft.value || !result.value || missing.value.length) return;
  emit("apply", { draft: draft.value, voice: { transcript: transcript.value, ai_provider: result.value.ai_provider } });
}
</script>

<template>
  <Modal title="語音口述（AI 草稿）" wide :busy="busy" @cancel="!busy && emit('cancel')">
    <div data-testid="voice-flow">
      <p v-if="loading" role="status">載入中…</p>
      <p v-if="error" role="alert" class="err" data-testid="voice-flow-error">{{ error }}</p>

      <!-- E5：首次使用要先看告知並勾選同意 -->
      <section v-if="status && needConsent" data-testid="voice-consent">
        <h3>使用前請先閱讀告知</h3>
        <p class="pre" data-testid="voice-notice">{{ status.consent.notice }}</p>
        <label class="inline"><input v-model="agree" type="checkbox" data-testid="voice-agree" />我已閱讀並同意以上告知</label>
        <div class="row end"><button type="button" :disabled="busy" @click="emit('cancel')">取消</button><button type="button" class="primary" data-testid="voice-consent-submit" :disabled="!agree || busy" @click="consent">同意並繼續</button></div>
      </section>

      <!-- 步驟 1：錄音或手動輸入文字稿 -->
      <section v-else-if="status && step === 'input'" data-testid="voice-input">
        <details class="notice-box"><summary>隱私告知（已同意）</summary><p class="pre">{{ status.consent.notice }}</p></details>
        <p v-if="!status.ai_available" class="warn" role="status" data-testid="voice-ai-off">{{ status.ai_unavailable_message || notice }}</p>
        <VoiceRecorder v-if="status.ai_available" :disabled="busy" @result="onTranscribed" @busy="(b: boolean) => (busy = b)" />
        <p v-if="notice && status.ai_available" role="status" data-testid="voice-notice-msg">{{ notice }}</p>
        <label>文字稿（可直接輸入，或修改轉出來的文字）
          <textarea v-model="transcript" rows="6" :maxlength="status.limits.max_transcript_chars" data-testid="voice-transcript" placeholder="例：今天到 A 店巡店，發現陳列不整齊，已提醒店長，下週再追蹤。" @input="transcriptSource = transcriptSource === 'AI' ? 'AI' : 'MANUAL'"></textarea>
        </label>
        <div class="row end">
          <button type="button" :disabled="busy" @click="emit('cancel')">取消</button>
          <button type="button" class="primary" data-testid="voice-make-draft" :disabled="busy || !transcript.trim()" @click="makeDraft">{{ busy ? "處理中…" : "產生草稿" }}</button>
        </div>
      </section>

      <!-- 步驟 2：草稿審核 -->
      <section v-else-if="step === 'review' && draft && result" data-testid="voice-review">
        <p v-if="result.fallback" class="warn" role="status" data-testid="fallback-label"><strong>{{ FALLBACK_LABEL }}</strong><br />{{ result.message || "" }}</p>
        <p v-else class="ok" role="status" data-testid="ai-label">這是 AI 整理的草稿，還沒有儲存；請逐項確認內容與文字稿一致，不要相信 AI 沒有根據的內容。</p>
        <p v-if="result.warnings.length && !result.fallback" class="warn">{{ result.warnings.join("；") }}</p>
        <ul v-if="result.confirmation_questions.length" class="plain"><li v-for="(q, i) in result.confirmation_questions" :key="i">{{ q }}</li></ul>
        <div v-if="result.entity_matches.length" data-testid="voice-matches">
          <h3>系統辨識到的門市與人員（僅供參考）</h3>
          <ul class="plain">
            <li v-for="(m, i) in result.entity_matches" :key="i">{{ m.type === "STORE" ? "門市" : "人員" }}「{{ m.mention }}」：{{ MATCH[m.status] }}<template v-if="m.candidates.length"> {{ m.candidates.map((c) => c.label).join("、") }}</template></li>
          </ul>
        </div>
        <fieldset>
          <label>發現或觀察<textarea v-model="draft.observation" rows="2" data-testid="draft-observation"></textarea></label>
          <label>管理判斷<textarea v-model="draft.judgment" rows="2" data-testid="draft-judgment"></textarea></label>
          <label>管理動作<textarea v-model="draft.action_summary" rows="2" data-testid="draft-action"></textarea></label>
          <div class="checks"><label v-for="o in ACTION_OPTIONS" :key="o" class="inline"><input type="checkbox" :checked="draft.action_options.includes(o)" @change="toggleOption(o)" />{{ o }}</label></div>
          <label class="inline"><input v-model="draft.requires_follow_up" type="checkbox" />需要追蹤</label>
          <template v-if="draft.requires_follow_up">
            <label>追蹤日期<input v-model="draft.follow_up_date" type="date" /></label>
            <label>預期結果<textarea v-model="draft.expected_result" rows="2"></textarea></label>
          </template>
        </fieldset>
        <p v-if="missing.length" class="err" role="alert" data-testid="draft-missing">還缺少：{{ missing.join("、") }}（三欄都要填寫才能套用）</p>
        <details><summary>文字稿</summary><p class="pre">{{ transcript }}</p></details>
        <div class="row end">
          <button type="button" data-testid="voice-back" @click="step = 'input'">返回修改文字稿</button>
          <button type="button" class="primary" data-testid="voice-apply" :disabled="missing.length > 0" @click="apply">套用到管理紀錄表單（還不會儲存）</button>
        </div>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
section { display: grid; gap: 12px; }
h3 { margin: 6px 0; }
label { display: flex; flex-direction: column; gap: 7px; }
label.inline { flex-direction: row; align-items: center; gap: 8px; }
textarea, input:not([type="checkbox"]) { padding: 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--surface); font: inherit; max-width: 100%; box-sizing: border-box; width: 100%; }
fieldset { border: 0; padding: 0; display: grid; gap: 12px; margin: 0; min-width: 0; }
.row { display: flex; gap: 9px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; margin-top: 8px; }
.pre { white-space: pre-wrap; margin: 4px 0; overflow-wrap: anywhere; }
.plain { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.checks { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.err { color: #a32a23; white-space: pre-line; }
.warn { padding: 10px 12px; border: 1px solid #c98a15; border-radius: 6px; background: #fbf1d9; color: #6a4300; margin: 0; }
.ok { padding: 10px 12px; border: 1px solid var(--primary); border-radius: 6px; background: var(--soft); margin: 0; }
.notice-box { color: var(--muted); }
</style>
