<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Printer } from "lucide-vue-next";
import { api } from "../../api";
import AssetSitePicker from "../../components/ga/AssetSitePicker.vue";
import GaShell from "../../components/ga/GaShell.vue";
import { buildPrintDocument, EXCLUDE_TEXT, type LabelItem } from "../../lib/ga-labels";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G10 QR 標籤列印（設備與設施共用，依頁籤 kind 區分）。版型沿用舊版 60 x 25 mm、一張一頁。
// Q9：QR 網址的網域由伺服端環境設定決定（不取瀏覽器網址）；非正式環境標籤加「測試」浮水印；已報廢／退役／刪除者排除並說明；
//     沒有編號仍可印但警告；單次上限 300 張，超過請依門市或分類分批。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const isFacility = computed(() => props.tab.kind === "ga-facility-labels");
const noun = computed(() => (isFacility.value ? "設施" : "設備"));
const type = computed(() => (isFacility.value ? "facility" : "equipment"));
type Excluded = { id: string; name: string; reason: string; message: string };
type Res = { items: LabelItem[]; excluded: Excluded[]; excludedTotal: number; watermark: boolean; baseUrl: string; limit: number; truncated: boolean; matched: number; noCodeCount: number };

const storeId = ref("");
const search = ref("");
const debounced = useDebounced(search, 300);
const status = ref("");
const data = ref<Res | null>(null);
const loading = ref(false);
const error = ref("");
const notice = ref("");
const latest = useLatest();
const statuses = computed(() => (isFacility.value
  ? [["ACTIVE", "使用中"], ["PARTIALLY_DAMAGED", "部分損壞"], ["OUT_OF_SERVICE", "停用中"], ["UNDER_RENOVATION", "整修中"]]
  : [["ACTIVE", "使用中"], ["SPARE", "備品"], ["TEMPORARILY_STOPPED", "暫停使用"], ["RETIRED", "退役"]]) as [string, string][]);

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  notice.value = "";
  try {
    const q = new URLSearchParams({ type: type.value });
    const ids = props.tab.payload?.ids;
    if (Array.isArray(ids) && ids.length) q.set("ids", ids.join(","));
    else {
      if (storeId.value) q.set("storeId", storeId.value);
      if (debounced.value.trim()) q.set("q", debounced.value.trim());
      if (status.value) q.set("status", status.value);
    }
    const res = await api<Res>("general-affairs/qr/labels?" + q);
    if (!latest.isLatest(n)) return;
    data.value = res;
  } catch (e) {
    if (latest.isLatest(n)) {
      data.value = null;
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([storeId, debounced, status], load);
onMounted(load);

function print() {
  if (!data.value?.items.length) return;
  notice.value = "";
  const w = window.open("", "_blank", "width=420,height=560");
  if (!w) {
    notice.value = "瀏覽器擋住了列印視窗，請允許這個網站開啟彈出視窗後再按一次列印。";
    return;
  }
  w.document.open();
  w.document.write(buildPrintDocument(data.value.items, { watermark: data.value.watermark, noun: noun.value }));
  w.document.close();
  w.focus();
  // 等 QR 圖載入完成再開列印視窗。
  setTimeout(() => { try { w.print(); } catch { /* 使用者取消或瀏覽器擋下，視窗保留可手動列印 */ } }, 300);
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / {{ noun }}管理</p>
      <h1>{{ noun }} QR 標籤列印</h1>
      <p class="muted">列印既有{{ noun }}的永久 QR 掃描入口（60 x 25 mm，一張一頁）。標籤不印門市與位置，{{ noun }}轉移到別間門市時不需要重印。</p>
    </div>
    <div class="actions">
      <button type="button" class="primary" :disabled="loading || !data?.items.length" @click="print"><Printer :size="16" /> 列印 {{ data?.items.length || 0 }} 張</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', `${noun}管理`, 'QR 標籤列印']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice warn" role="alert">{{ notice }}</p>
    <div class="filter-bar">
      <div class="filter-pick"><AssetSitePicker v-model="storeId" label="依門市印" /></div>
      <label class="grow">搜尋<input v-model="search" type="search" :placeholder="`${noun}名稱或編號`" /></label>
      <label>狀態<select v-model="status"><option value="">全部（不含已作廢）</option><option v-for="s in statuses" :key="s[0]" :value="s[0]">{{ s[1] }}</option></select></label>
    </div>

    <template v-if="data">
      <p v-if="data.watermark" class="notice warn" role="status" data-testid="label-watermark-note">
        目前是測試環境：印出的標籤會加上「測試」浮水印，請不要貼到實體{{ noun }}上。正式標籤請在正式網站列印。
      </p>
      <p class="muted base" data-testid="label-base">標籤上的網址網域：{{ data.baseUrl }}（由系統設定決定，不是目前瀏覽器網址）</p>
      <p v-if="data.truncated" class="notice warn" role="alert" data-testid="label-truncated">
        符合條件的有 {{ data.matched }} 張，單次最多印 {{ data.limit }} 張，目前只列前 {{ data.limit }} 張。請依門市或分類縮小範圍，分批列印。
      </p>
      <p v-if="data.noCodeCount" class="notice warn" role="alert" data-testid="label-nocode">
        有 {{ data.noCodeCount }} 張標籤尚未設定{{ noun }}編號：QR 仍可掃描，但建議補上正式編號後再貼標（標籤上會以紅字顯示「尚未設定編號」）。
      </p>
      <div v-if="data.excludedTotal" class="notice info" role="status" data-testid="label-excluded">
        <strong>已排除 {{ data.excludedTotal }} 筆不能列印的資料</strong>（已報廢、退役、刪除或 QR 已作廢，標籤掃不進去）：
        <ul>
          <li v-for="x in data.excluded" :key="x.id">{{ x.name }}：{{ x.message || EXCLUDE_TEXT[x.reason] }}</li>
          <li v-if="data.excludedTotal > data.excluded.length">…還有 {{ data.excludedTotal - data.excluded.length }} 筆</li>
        </ul>
      </div>
    </template>

    <div class="list-meta"><span>可列印 {{ data?.items.length || 0 }} 張<template v-if="data && data.matched > data.items.length">（符合 {{ data.matched }} 張）</template></span><span v-if="loading" role="status">載入中…</span></div>
    <ul class="sheet" aria-label="標籤預覽">
      <li v-for="item in data?.items || []" :key="item.id" class="label" data-testid="label-card">
        <div class="qr" v-html="item.svg" />
        <div class="txt">
          <div class="cap">{{ noun }}編號</div>
          <div class="code" :class="{ missing: !item.code }">{{ item.code || "尚未設定編號" }}</div>
          <div class="nm">{{ item.name }}</div>
          <div class="store muted">{{ item.storeCode }} {{ item.storeName }}</div>
        </div>
        <span v-if="data?.watermark" class="wm" aria-hidden="true">測試</span>
      </li>
      <li v-if="!data?.items.length && !loading" class="empty">{{ error ? "標籤載入失敗" : `目前沒有可列印的${noun} QR 標籤` }}</li>
    </ul>
  </GaShell>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.actions .primary { min-height: 44px; display: inline-flex; gap: 6px; align-items: center; }
.base { margin: 4px 0 8px; overflow-wrap: anywhere; }
.notice ul { margin: 6px 0 0; padding-left: 20px; }
.sheet { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, 60mm); gap: 12px; }
.label { position: relative; width: 60mm; height: 25mm; box-sizing: border-box; padding: 2mm; border: 1px solid var(--line); border-radius: 4px; background: #fff; color: #111; display: flex; gap: 2mm; overflow: hidden; }
.qr { width: 19mm; height: 19mm; flex: none; }
.qr :deep(svg) { width: 100%; height: 100%; display: block; }
.txt { min-width: 0; flex: 1; }
.cap { font-size: 8px; color: #555; }
.code { font-size: 13px; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
.code.missing { color: #c00; }
.nm { margin-top: 1mm; font-size: 9px; font-weight: 700; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
.store { font-size: 8px; margin-top: 1mm; }
.wm { position: absolute; inset: 0; display: grid; place-items: center; font-size: 30px; font-weight: 900; color: rgba(210, 0, 0, 0.28); transform: rotate(-18deg); pointer-events: none; letter-spacing: 4px; }
.empty { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 24px; }
@media (max-width: 700px) { .sheet { grid-template-columns: 1fr; justify-items: start; } }
</style>
