<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../api";
import type { WorkTab } from "../stores";
import { useSession } from "../stores";
import { legacyUrl } from "../legacy-link";
import { WORKSPACE_PAGE_META } from "../workspace-page-meta";
import type { WorkTabKind } from "../../../lib/workspace/page-kinds";

// M9 F01S N2：系統管理員的「頁面回舊版設定」。每個選單頁面一個開關；切到舊版後，選單改開舊版網址，
// 已開啟的新版頁籤顯示通知。不需要重新部署：使用者最慢 60 秒內（或下次開選單、回到視窗時）生效。
defineProps<{ tab: WorkTab }>();
type Item = { kind: string; legacyRoute: string; useLegacy: boolean; reason: string | null; updatedAt: string | null; updatedByName: string | null };
const session = useSession();
const items = ref<Item[]>([]);
const reasonMax = ref(200);
const loading = ref(false);
const error = ref("");
const message = ref("");
const search = ref("");
const draftReason = ref<Record<string, string>>({});
const busyKind = ref("");
const title = (kind: string) => WORKSPACE_PAGE_META[kind as WorkTabKind]?.title || kind;
const errText = (e: unknown, fb: string) => (e instanceof ApiError ? e.message : fb);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const shown = computed(() => items.value.filter((i) => !search.value.trim() || title(i.kind).includes(search.value.trim()) || i.legacyRoute.includes(search.value.trim())));
const legacyCount = computed(() => items.value.filter((i) => i.useLegacy).length);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api<{ items: Item[]; reasonMax: number }>("page-fallbacks");
    items.value = data.items;
    reasonMax.value = data.reasonMax;
  } catch (e) {
    error.value = errText(e, "載入失敗，請重試");
  } finally {
    loading.value = false;
  }
}
async function toggle(item: Item) {
  const next = !item.useLegacy;
  const reason = (draftReason.value[item.kind] ?? "").trim();
  error.value = "";
  message.value = "";
  if (next && !reason) {
    error.value = `切回舊版前請先填寫「${title(item.kind)}」的原因。`;
    return;
  }
  busyKind.value = item.kind;
  try {
    await api("page-fallbacks", { method: "PUT", body: JSON.stringify({ kind: item.kind, useLegacy: next, reason }) });
    message.value = next ? `「${title(item.kind)}」已切回舊版，使用者最慢 60 秒內生效。` : `「${title(item.kind)}」已改回新版，使用者最慢 60 秒內生效。`;
    draftReason.value[item.kind] = "";
    await load();
    await session.refresh().catch(() => undefined);
  } catch (e) {
    error.value = errText(e, "儲存失敗，請重試");
  } finally {
    busyKind.value = "";
  }
}
onMounted(load);
</script>

<template>
  <section class="fallbacks-page" data-testid="page-fallbacks">
    <header class="head">
      <div>
        <small>系統管理 / 上線備援</small>
        <h1>頁面回舊版設定</h1>
        <p>新版某一頁出問題時，可以單獨把那一頁切回舊版：選單會改開舊版網址，其他頁面不受影響。改回新版隨時可以做，都不用重新部署。</p>
      </div>
      <button :disabled="loading" @click="load">重新整理</button>
    </header>
    <p v-if="error" role="alert" class="notice error" data-testid="fallback-error">{{ error }}</p>
    <p v-if="message" role="status" class="notice success" data-testid="fallback-message">{{ message }}</p>
    <p class="summary" data-testid="fallback-summary">目前有 <strong>{{ legacyCount }}</strong> 個頁面切回舊版（共 {{ items.length }} 個頁面可以切換）。沒有舊版對應的新功能（例如採購單、請款單）不在清單內。</p>
    <label class="search">搜尋頁面<input v-model="search" type="search" placeholder="頁面名稱或舊版路由" /></label>
    <p v-if="loading && !items.length" role="status">載入中…</p>
    <ul class="list">
      <li v-for="item in shown" :key="item.kind" :class="{ legacy: item.useLegacy }" :data-kind="item.kind">
        <div class="main">
          <strong>{{ title(item.kind) }}</strong>
          <span class="state" :data-state="item.useLegacy ? 'legacy' : 'new'">{{ item.useLegacy ? "目前開舊版" : "目前開新版" }}</span>
          <a :href="legacyUrl(session.data?.integrated, item.legacyRoute)" target="_blank" rel="noopener" class="route">{{ item.legacyRoute }} ↗</a>
        </div>
        <p v-if="item.updatedAt" class="audit">最後修改：{{ item.updatedByName || "未知" }}，{{ fmt(item.updatedAt) }}<template v-if="item.reason">；原因：{{ item.reason }}</template></p>
        <div class="act">
          <label v-if="!item.useLegacy"
            >原因（必填）<input v-model="draftReason[item.kind]" :maxlength="reasonMax" :name="'reason-' + item.kind" placeholder="例如：新版載入很慢" /></label
          >
          <button
            :class="item.useLegacy ? 'primary' : 'danger'"
            :disabled="!!busyKind"
            :data-testid="'toggle-' + item.kind"
            @click="toggle(item)"
          >{{ busyKind === item.kind ? "處理中…" : item.useLegacy ? "改回新版" : "切回舊版" }}</button>
        </div>
      </li>
    </ul>
    <p v-if="!shown.length && !loading" class="empty">沒有符合的頁面。</p>
  </section>
</template>

<style scoped>
.fallbacks-page { display: grid; gap: 14px; padding: 4px 0 24px; }
.head { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
.head h1 { margin: 2px 0 6px; }
.head p, .summary, .audit, small, .empty { color: var(--muted); margin: 0; }
.search { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
.search input, .act input { padding: 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--surface); font: inherit; box-sizing: border-box; width: 100%; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.list li { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: var(--surface); display: grid; gap: 8px; }
.list li.legacy { border-color: #b45309; }
.main { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.state { font-size: 12px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--line); }
.state[data-state="legacy"] { color: #b45309; border-color: #b45309; }
.route { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.act { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.act label { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 220px; }
.act button { min-height: 40px; }
@media (max-width: 640px) { .act button { width: 100%; } }
</style>
