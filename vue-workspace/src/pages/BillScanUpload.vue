<script setup lang="ts">
// 手機掃 QR 拍照上傳頁（公開頁，不需登入）。權杖由網址帶入、只放在請求標頭；只能把照片傳到發 QR 那張帳單，頁面看不到任何帳單資料。
// 照片在手機端先縮小（沿用全站上傳規則：長邊約 2000 像素、4MB 上限）。
import { computed, onMounted, ref } from "vue";
import { Camera, Images } from "lucide-vue-next";
import { formatBytes, prepareFile, type PreparedFile } from "../lib/upload";
import { SCAN_API_PATH, SCAN_TOKEN_HEADER } from "../../../lib/workspace/general-affairs/utility-scan-rules";

const props = defineProps<{ params: Record<string, unknown> }>();
const token = computed(() => String(props.params.token ?? ""));
const state = ref<"checking" | "ready" | "invalid" | "full">("checking");
const message = ref("");
const remaining = ref(0);
const expiresAt = ref("");
const items = ref<PreparedFile[]>([]);
const preparing = ref(0);
const busy = ref(false);
const done = ref(0);
const error = ref("");
const camera = ref<HTMLInputElement>();
const album = ref<HTMLInputElement>();

const headers = () => ({ [SCAN_TOKEN_HEADER]: token.value });
async function check() {
  try {
    const res = await fetch(SCAN_API_PATH, { headers: headers(), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      remaining.value = Number(data.remaining);
      expiresAt.value = String(data.expires_at || "");
      state.value = "ready";
    } else {
      message.value = data.error || "這個上傳連結無法使用";
      state.value = data.code === "FULL" ? "full" : "invalid";
    }
  } catch {
    message.value = "連線失敗，請確認手機網路後重新整理";
    state.value = "invalid";
  }
}
onMounted(check);

async function pick(event: Event) {
  const el = event.target as HTMLInputElement;
  const files = Array.from(el.files || []);
  el.value = "";
  error.value = "";
  for (const file of files) {
    if (items.value.length >= Math.min(10, remaining.value)) {
      error.value = `這個連結最多還能傳 ${remaining.value} 張，其餘已略過`;
      break;
    }
    preparing.value++;
    try {
      const r = await prepareFile(file);
      if (r.ok) items.value = [...items.value, r.item];
      else error.value = r.message;
    } finally {
      preparing.value--;
    }
  }
}
function removeItem(id: string) {
  items.value = items.value.filter((i) => i.id !== id);
}
async function send() {
  if (!items.value.length || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const form = new FormData();
    for (const i of items.value) form.append("files", i.file, i.file.name);
    const res = await fetch(SCAN_API_PATH, { method: "POST", headers: headers(), body: form, cache: "no-store", signal: AbortSignal.timeout(120000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.value = data.error || "上傳失敗，請稍後重試";
      if (data.code === "INVALID") {
        state.value = "invalid";
        message.value = data.error;
      }
      if (data.code === "FULL") await check();
      return;
    }
    done.value += items.value.length;
    items.value = [];
    remaining.value = Number(data.remaining);
    if (remaining.value <= 0) {
      state.value = "full";
      message.value = "已達上傳上限，請回到電腦查看。";
    }
  } catch {
    error.value = "連線中斷或逾時，照片仍保留，請重試";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="scan" data-testid="scan-page">
    <h1>用手機上傳帳單照片</h1>
    <p v-if="state === 'checking'" role="status" data-testid="scan-checking">確認連結中…</p>
    <template v-else-if="state === 'invalid'">
      <p class="bad" role="alert" data-testid="scan-invalid">{{ message || "這個上傳連結無效或已過期，請回到電腦重新產生 QR" }}</p>
    </template>
    <template v-else>
      <p v-if="done" class="ok" role="status" data-testid="scan-done">已上傳 {{ done }} 張，電腦畫面會自動出現。</p>
      <p v-if="state === 'full'" class="bad" role="alert" data-testid="scan-full">{{ message }}</p>
      <template v-else>
        <p class="muted">這個連結只能上傳到一張帳單，還可以傳 <strong data-testid="scan-remaining">{{ remaining }}</strong> 張，15 分鐘內有效。</p>
        <div class="actions">
          <button type="button" class="primary" data-testid="scan-camera" :disabled="busy" @click="camera?.click()"><Camera :size="20" /> 拍照</button>
          <button type="button" data-testid="scan-album" :disabled="busy" @click="album?.click()"><Images :size="20" /> 從相簿選</button>
        </div>
        <input ref="camera" class="sr-only" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" data-testid="scan-input-camera" @change="pick" />
        <input ref="album" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" multiple tabindex="-1" aria-hidden="true" data-testid="scan-input" @change="pick" />
        <p v-if="preparing" class="muted" role="status">處理照片中…</p>
        <ul v-if="items.length" class="list" aria-label="待上傳的照片">
          <li v-for="i in items" :key="i.id">
            <img v-if="i.previewUrl" :src="i.previewUrl" :alt="i.file.name" />
            <span class="name">{{ i.file.name }} <small>{{ formatBytes(i.file.size) }}</small></span>
            <button type="button" :aria-label="'移除 ' + i.file.name" :disabled="busy" @click="removeItem(i.id)">移除</button>
          </li>
        </ul>
        <p v-if="error" class="bad" role="alert" data-testid="scan-error">{{ error }}</p>
        <button v-if="items.length" type="button" class="primary send" data-testid="scan-send" :disabled="busy || preparing > 0" @click="send">{{ busy ? "上傳中…" : `上傳 ${items.length} 張` }}</button>
      </template>
    </template>
  </main>
</template>

<style scoped>
.scan { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 14px; }
h1 { font-size: 20px; margin: 0; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.actions button { min-height: 52px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.list li { display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 8px; }
.list img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.send { min-height: 52px; font-size: 16px; }
.ok { color: #1a7f37; }
.bad { color: #b42318; }
.muted { color: var(--muted, #667085); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
