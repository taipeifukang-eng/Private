<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { AlertCircle, Camera, MapPin, Settings, ShieldCheck, Wrench } from "lucide-vue-next";
import { api, ApiError } from "../../api";
import { EQUIPMENT_STATUS_LABEL, FACILITY_STATUS_LABEL, formatDate, storeLabel } from "../../lib/ga-assets";
import { legacyUrl, openGaPage } from "../../lib/ga";
import { useSession, type WorkTab } from "../../stores";

// G10 資產掃描頁（QR 永久網址 /general-affairs/assets/scan/{token} 的新版頁面，手機優先）。
// token 放在頁籤的 recordId。作廢或不存在 -> 友善說明（Q8）；無權限 -> 白話說明＋該門市店長姓名（Q5、解讀 (l)）；
// 報修按鈕只有真的能替這間門市建單的人才可按，其他人按鈕停用並說明原因；報修目前連到舊版建單頁。
const props = defineProps<{ tab: WorkTab }>();
const session = useSession();
type Photo = { id: string; purpose: string; file_name: string; is_primary: boolean; url: string | null };
type Repair = { id: string; request_no: string; title: string; main_status: string; created_at: string; work_order: { status: string } | null };
type Asset = {
  id: string; type: "EQUIPMENT" | "FACILITY"; token: string; code: string | null; name: string; status: string;
  store: { id: string; store_code: string; store_name: string; short_name?: string | null } | null; category: { name: string } | null;
  area: string | null; location_detail: string | null; brand?: string | null; model?: string | null; serial_number?: string | null;
  warranty: { label: string; end_date: string | null; tone: string };
  photos: Photo[]; repairs: { visible: boolean; total: number; rows: Repair[] };
  access: { level: "full" | "basic"; scope: string };
  canReport: boolean; reportPath: string | null; reportReason: string | null; managementKind: "ga-equipment" | "ga-facilities" | null;
};
type Failure = { status: number; code: string; message: string; contacts: { name: string }[]; storeName: string | null; canRestore: boolean; asset: { type: string; name: string; code: string | null } | null };
const asset = ref<Asset | null>(null);
const failure = ref<Failure | null>(null);
const loading = ref(true);
const token = computed(() => props.tab.recordId || "");
const isFacility = computed(() => asset.value?.type === "FACILITY");
const noun = computed(() => (isFacility.value ? "設施" : "設備"));
const statusText = (s: string) => (isFacility.value ? FACILITY_STATUS_LABEL : EQUIPMENT_STATUS_LABEL)[s] || s;
const MAIN_STATUS: Record<string, string> = {
  PENDING_INTAKE: "待受理", WAITING_STORE_SUPPLEMENT: "待門市補充", WAITING_GA_REVIEW: "待總務審核", ACCEPTED: "已受理", IN_PROGRESS: "處理中",
  WAITING_STORE_CONFIRMATION: "待門市確認", COMPLETED: "已完成", REJECTED: "已退回", CANCELED: "已取消",
};
const mainPhoto = computed(() => asset.value?.photos.find((p) => p.is_primary && p.url) || asset.value?.photos.find((p) => p.url) || null);

async function load() {
  loading.value = true;
  failure.value = null;
  asset.value = null;
  try {
    const res = await api<{ data: Asset }>("general-affairs/assets/scan/" + encodeURIComponent(token.value));
    asset.value = res.data;
    props.tab.title = res.data.name ? `掃描：${res.data.name}` : props.tab.title;
  } catch (e) {
    const err = e as ApiError;
    const d = err.data || {};
    failure.value = {
      status: err.status, code: String(d.code || ""), message: err.message, contacts: Array.isArray(d.contacts) ? d.contacts : [],
      storeName: d.storeName || null, canRestore: !!d.canRestore, asset: d.asset || null,
    };
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const title = computed(() => {
  const f = failure.value;
  if (!f) return "";
  if (f.code === "REVOKED") return "這個 QR Code 已作廢";
  if (f.status === 403) return "沒有查看權限";
  if (f.code === "NOT_FOUND" || f.code === "BAD_TOKEN") return "QR Code 無法辨識";
  return "掃描資料載入失敗";
});
function report() {
  const path = asset.value?.reportPath;
  if (path) window.open(legacyUrl(path, session.data?.integrated), "_blank", "noopener");
}
function openManagement() {
  const a = asset.value;
  if (!a?.managementKind) return;
  openGaPage(a.managementKind, undefined, { search: a.code || a.name });
}
function openRestore() {
  const f = failure.value;
  if (!f?.asset) return;
  openGaPage(f.asset.type === "FACILITY" ? "ga-facilities" : "ga-equipment", undefined, { search: f.asset.code || f.asset.name });
}
</script>

<template>
  <section class="scan" data-testid="asset-scan">
    <p v-if="loading" class="muted" role="status">載入中…</p>

    <div v-else-if="failure" class="fail" :class="{ soft: failure.code === 'REVOKED' || failure.status === 403 }" role="alert" data-testid="scan-failure" :data-code="failure.code">
      <h1><AlertCircle :size="20" /> {{ title }}</h1>
      <p>{{ failure.message }}</p>
      <div v-if="failure.status === 403" class="contacts" data-testid="scan-contacts">
        <strong>可以聯絡{{ failure.storeName ? `「${failure.storeName}」` : "該門市" }}的店長：</strong>
        <ul v-if="failure.contacts.length"><li v-for="c in failure.contacts" :key="c.name">{{ c.name }}</li></ul>
        <p v-else class="muted">這間門市目前沒有登記店長，請洽總務。</p>
      </div>
      <p v-if="failure.code === 'REVOKED' && failure.asset" class="muted">對應資料：{{ failure.asset.name }}<template v-if="failure.asset.code">（{{ failure.asset.code }}）</template></p>
      <button v-if="failure.canRestore" type="button" class="primary" @click="openRestore">到清冊「恢復使用並重新啟用 QR」</button>
      <button v-if="failure.status >= 500 || failure.status === 0" type="button" @click="load">重新載入</button>
    </div>

    <template v-else-if="asset">
      <header class="head">
        <div>
          <p class="eyebrow">{{ noun }}</p>
          <h1>{{ asset.name }}</h1>
          <p class="code">{{ asset.code || "尚未產生編號" }}</p>
        </div>
        <span class="tag status" data-testid="scan-status">{{ statusText(asset.status) }}</span>
      </header>

      <figure class="photo">
        <img v-if="mainPhoto?.url" :src="mainPhoto.url" :alt="asset.name" />
        <div v-else class="nophoto"><Camera :size="36" /><span>還沒有照片</span></div>
      </figure>

      <div class="actions">
        <button v-if="asset.canReport" type="button" class="primary big" data-testid="scan-report" @click="report"><Wrench :size="18" /> 維修回報</button>
        <template v-else>
          <button type="button" class="big" disabled data-testid="scan-report"><Wrench :size="18" /> 維修回報</button>
          <p class="notice warn" role="status" data-testid="scan-report-reason">{{ asset.reportReason }}</p>
        </template>
        <button v-if="asset.managementKind" type="button" class="big" data-testid="scan-manage" @click="openManagement"><Settings :size="18" /> 查看完整主檔</button>
      </div>

      <dl class="info">
        <div><dt><MapPin :size="14" /> 目前使用門市</dt><dd data-testid="scan-store">{{ storeLabel(asset.store) }}</dd></div>
        <div><dt>位置</dt><dd>{{ [asset.area, asset.location_detail].filter(Boolean).join(" / ") || "未登錄" }}</dd></div>
        <div><dt>分類</dt><dd>{{ asset.category?.name || "未登錄" }}</dd></div>
        <div v-if="asset.access.level === 'full'"><dt>品牌／型號</dt><dd>{{ [asset.brand, asset.model].filter(Boolean).join(" / ") || "未登錄" }}</dd></div>
        <div v-if="asset.access.level === 'full' && !isFacility"><dt>序號</dt><dd>{{ asset.serial_number || "未登錄" }}</dd></div>
        <div><dt><ShieldCheck :size="14" /> 保固狀態</dt><dd :class="'tone-' + asset.warranty.tone" data-testid="scan-warranty">{{ asset.warranty.label }}<template v-if="asset.warranty.end_date && asset.warranty.label !== asset.warranty.end_date">（到期日 {{ formatDate(asset.warranty.end_date) }}）</template></dd></div>
      </dl>
      <p v-if="asset.access.level === 'basic'" class="muted small" data-testid="scan-basic-note">您以門市負責人身分查看，僅顯示基本資料；品牌、型號、序號與採購資料請洽總務。</p>

      <section class="repairs">
        <h2><Wrench :size="16" /> 維修紀錄<span v-if="asset.repairs.visible" class="muted">（共 {{ asset.repairs.total }} 筆）</span></h2>
        <ul v-if="asset.repairs.rows.length" class="repair-list">
          <li v-for="r in asset.repairs.rows" :key="r.id" data-testid="scan-repair">
            <div class="r-head"><strong>{{ r.title }}</strong><span class="tag">{{ MAIN_STATUS[r.main_status] || r.main_status }}</span></div>
            <div class="muted small">{{ r.request_no }} · 回報日期 {{ formatDate(r.created_at) }}</div>
          </li>
        </ul>
        <p v-else-if="!asset.repairs.visible" class="muted">您的帳號看不到這份維修紀錄。</p>
        <p v-else class="empty">目前沒有維修紀錄</p>
      </section>

      <section v-if="asset.photos.filter((p) => p.url).length > 1" class="more-photos">
        <h2>更多照片</h2>
        <div class="thumbs"><img v-for="p in asset.photos.filter((x) => x.url)" :key="p.id" :src="p.url!" :alt="p.file_name" loading="lazy" /></div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.scan { max-width: 720px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; min-width: 0; }
.head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.head h1 { margin: 2px 0; font-size: 22px; overflow-wrap: anywhere; }
.code { margin: 0; font-family: ui-monospace, monospace; color: var(--muted); overflow-wrap: anywhere; }
.status { flex: none; }
.photo { margin: 0; }
.photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); }
.nophoto { aspect-ratio: 4 / 3; display: grid; place-items: center; align-content: center; gap: 6px; background: var(--soft); border-radius: 10px; color: var(--muted); }
.actions { display: grid; gap: 8px; }
.big { min-height: 48px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; }
.info { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.info > div { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--surface); min-width: 0; }
.info dt { font-size: 12px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.info dd { margin: 4px 0 0; font-weight: 700; overflow-wrap: anywhere; }
.repairs h2, .more-photos h2 { font-size: 16px; display: flex; gap: 6px; align-items: center; margin: 0 0 8px; }
.repair-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.repair-list li { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--surface); }
.r-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.r-head strong { overflow-wrap: anywhere; }
.small { font-size: 12px; margin: 2px 0 0; }
.empty { border: 1px dashed var(--line); border-radius: 8px; padding: 18px; text-align: center; color: var(--muted); }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
.fail { border: 1px solid #fca5a5; background: #fef2f2; color: #7f1d1d; border-radius: 10px; padding: 16px; display: grid; gap: 10px; }
.fail.soft { border-color: #fcd34d; background: #fffbeb; color: #78350f; }
.fail h1 { margin: 0; font-size: 19px; display: flex; gap: 6px; align-items: center; }
.fail p { margin: 0; line-height: 1.6; }
.contacts ul { margin: 6px 0 0; padding-left: 20px; }
@media (max-width: 480px) { .info { grid-template-columns: 1fr; } }
</style>
