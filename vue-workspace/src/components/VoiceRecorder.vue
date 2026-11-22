<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { ApiError } from "../api";
import { checkVoiceBlob, uploadVoice, type VoiceTranscribeResult } from "../lib/voice-upload";
import { MAX_AUDIO_SECONDS } from "../../../lib/supervisor-management-log/voice-ai-rules";

// M6 W33 錄音元件：開始／停止、重新錄音、上傳失敗重試。錄音只暫存在這個瀏覽器的記憶體（重試用），轉成文字或離開畫面就丟掉；
// 超過 10 分鐘自動停止。上傳與轉文字由 uploadVoice 包裝；AI 不可用時（fallback）通知父層改用手動文字稿。
const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ result: [result: VoiceTranscribeResult]; busy: [busy: boolean] }>();

type Phase = "idle" | "recording" | "recorded" | "uploading";
const phase = ref<Phase>("idle");
const seconds = ref(0);
const error = ref("");
const failed = ref(false);
const previewUrl = ref("");
const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let blob: Blob | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let startedAt = 0;

const clock = computed(() => `${String(Math.floor(seconds.value / 60)).padStart(2, "0")}:${String(seconds.value % 60).padStart(2, "0")}`);
const limit = `${String(Math.floor(MAX_AUDIO_SECONDS / 60)).padStart(2, "0")}:00`;

function release() {
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
function discard() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  blob = null;
  chunks = [];
  seconds.value = 0;
  failed.value = false;
}
onBeforeUnmount(() => {
  if (recorder && recorder.state !== "inactive") {
    recorder.onstop = null;
    recorder.stop();
  }
  release();
  discard();
});
function pickMime(): string | undefined {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return undefined;
}
async function start() {
  error.value = "";
  discard();
  if (!supported) return void (error.value = "這個瀏覽器不支援麥克風錄音，請改用下方的手動文字稿。");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return void (error.value = "無法使用麥克風（可能沒有允許權限），請改用手動文字稿，或在瀏覽器網址列允許麥克風後再試。");
  }
  try {
    // 32kbps 的語音位元率：10 分鐘約 2.4MB，遠低於上限，也在 Vercel 函式的請求大小限制內。
    recorder = new MediaRecorder(stream, { mimeType: pickMime(), audioBitsPerSecond: 32000 });
  } catch {
    release();
    return void (error.value = "無法開始錄音，請改用手動文字稿。");
  }
  chunks = [];
  recorder.ondataavailable = (e) => e.data && e.data.size > 0 && chunks.push(e.data);
  recorder.onstop = () => {
    release();
    blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    chunks = [];
    seconds.value = Math.max(seconds.value, Math.round((Date.now() - startedAt) / 1000));
    if (!blob.size) {
      phase.value = "idle";
      return void (error.value = "沒有錄到聲音，請重新錄音。");
    }
    previewUrl.value = URL.createObjectURL(blob);
    phase.value = "recorded";
  };
  recorder.start();
  startedAt = Date.now();
  seconds.value = 0;
  phase.value = "recording";
  timer = setInterval(() => {
    seconds.value = Math.round((Date.now() - startedAt) / 1000);
    if (seconds.value >= MAX_AUDIO_SECONDS) stop();
  }, 250);
}
function stop() {
  clearInterval(timer);
  if (recorder && recorder.state !== "inactive") recorder.stop();
}
function rerecord() {
  discard();
  phase.value = "idle";
  error.value = "";
}
async function upload() {
  if (!blob) return;
  const bad = checkVoiceBlob(blob, seconds.value);
  if (bad) return void (error.value = bad);
  error.value = "";
  failed.value = false;
  phase.value = "uploading";
  emit("busy", true);
  try {
    const result = await uploadVoice(blob, seconds.value);
    // 轉完（或 AI 不可用）就丟掉暫存音檔；音檔不會留在任何地方
    discard();
    phase.value = "idle";
    emit("result", result);
  } catch (e) {
    phase.value = "recorded";
    failed.value = true;
    error.value = e instanceof ApiError ? e.message : "上傳失敗，請重試";
  } finally {
    emit("busy", false);
  }
}
</script>

<template>
  <div class="recorder" data-testid="voice-recorder">
    <p class="state" role="status" data-testid="voice-status">
      <template v-if="phase === 'idle'">按「開始錄音」口述；最長 10 分鐘，錄音只暫存在這台裝置。</template>
      <template v-else-if="phase === 'recording'">錄音中…</template>
      <template v-else-if="phase === 'recorded'">錄好了，可以先試聽，再按「上傳並轉成文字」。</template>
      <template v-else>上傳並轉成文字中，請稍候…</template>
    </p>
    <p class="clock" data-testid="voice-timer" aria-live="off">{{ clock }} / {{ limit }}</p>
    <audio v-if="previewUrl" :src="previewUrl" controls class="preview" data-testid="voice-preview"></audio>
    <p v-if="error" role="alert" class="err" data-testid="voice-error">{{ error }}</p>
    <div class="row">
      <button v-if="phase === 'idle'" type="button" class="primary" data-testid="voice-start" :disabled="disabled || !supported" @click="start">開始錄音</button>
      <button v-if="phase === 'recording'" type="button" class="primary" data-testid="voice-stop" @click="stop">停止錄音</button>
      <template v-if="phase === 'recorded'">
        <button v-if="!failed" type="button" class="primary" data-testid="voice-upload" :disabled="disabled" @click="upload">上傳並轉成文字</button>
        <button v-else type="button" class="primary" data-testid="voice-retry" :disabled="disabled" @click="upload">重試上傳</button>
        <button type="button" data-testid="voice-rerecord" :disabled="disabled" @click="rerecord">重新錄音</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.recorder { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); min-width: 0; }
.state { margin: 0; color: var(--muted); }
.clock { margin: 0; font-size: 1.4rem; font-variant-numeric: tabular-nums; }
.row { display: flex; gap: 9px; flex-wrap: wrap; }
.preview { width: 100%; max-width: 100%; }
.err { color: #a32a23; margin: 0; white-space: pre-line; }
</style>
