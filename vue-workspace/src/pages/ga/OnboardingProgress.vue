<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { openGaPage, useGaGuard, useRefreshOnActivate, useLatest } from "../../lib/ga";
import { useSession, type WorkTab } from "../../stores";

// 上線貼標進度（Q29）：每店設備與設施總數、各階段數量、完成率；點進某店可看卡在哪一台；可依門市批次印標籤（設備、設施各自一頁）。
// 範圍由資料庫函式判斷：總務與查看者看全部門市，店長只看自己門市。完成率 = 完成 / 總數；沒有任何資產的門市不顯示 100%。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const session = useSession();
type Bucket = { total: number; needs_photo: number; needs_label: number; pending_review: number; completed: number };
type StoreRow = {
  store_id: string; store_code: string; store_name: string; equipment: Bucket; facility: Bucket; total: number; completed: number; completion_rate: number | null; oldest_open_at: string | null;
};
type Stuck = { asset_type: "EQUIPMENT" | "FACILITY"; id: string; name: string; code: string | null; onboarding_status: string; area: string | null; location_detail: string | null; review_note: string | null };

const rows = ref<StoreRow[]>([]);
const loading = ref(false);
const error = ref("");
const showDone = ref(false);
const latest = useLatest();
const caps = computed(() => session.data?.capabilities as Record<string, boolean> | undefined);

async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: StoreRow[] }>("general-affairs/onboarding/progress?includeEmpty=false");
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
onMounted(load);
watch(allowed, load);
useRefreshOnActivate(props.tab, load);

const shown = computed(() => (showDone.value ? rows.value : rows.value.filter((r) => r.completion_rate !== 100)));
const totals = computed(() => {
  const total = rows.value.reduce((s, r) => s + r.total, 0);
  const completed = rows.value.reduce((s, r) => s + r.completed, 0);
  return { stores: rows.value.length, total, completed, rate: total ? Math.round((1000 * completed) / total) / 10 : null, doneStores: rows.value.filter((r) => r.completion_rate === 100).length };
});
const pct = (v: number | null) => (v === null ? "尚無資產" : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);
const stage = (r: StoreRow, key: keyof Bucket) => r.equipment[key] + r.facility[key];

const STAGES = [
  { status: "NEEDS_EQUIPMENT_PHOTO", key: "needs_photo", label: "待拍照片" },
  { status: "NEEDS_LABEL_PHOTO", key: "needs_label", label: "待拍貼標照" },
  { status: "PENDING_GA_REVIEW", key: "pending_review", label: "待總務複核" },
] as const;
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.status, s.label]));

// 點進某店：列出還沒完成的每一台（最多 100 筆）與卡在哪一步。
const openStore = ref("");
const stuck = ref<Stuck[]>([]);
const stuckTotal = ref(0);
const stuckBusy = ref(false);
const stuckError = ref("");
const stuckLatest = useLatest();
async function toggle(r: StoreRow) {
  if (openStore.value === r.store_id) {
    openStore.value = "";
    return;
  }
  openStore.value = r.store_id;
  stuck.value = [];
  stuckTotal.value = 0;
  stuckError.value = "";
  const n = stuckLatest.next();
  stuckBusy.value = true;
  try {
    const q = new URLSearchParams({ storeId: r.store_id, statuses: STAGES.map((s) => s.status).join(","), page: "1", pageSize: "100" });
    const res = await api<{ data: Stuck[]; total: number }>("general-affairs/onboarding/tasks?" + q);
    if (!stuckLatest.isLatest(n)) return;
    stuck.value = res.data;
    stuckTotal.value = res.total;
  } catch (e) {
    if (stuckLatest.isLatest(n)) stuckError.value = (e as Error).message;
  } finally {
    if (stuckLatest.isLatest(n)) stuckBusy.value = false;
  }
}
const byStage = (status: string) => stuck.value.filter((s) => s.onboarding_status === status);
const noun = (t: string) => (t === "FACILITY" ? "設施" : "設備");
const printLabels = (r: StoreRow, kind: "ga-equipment-labels" | "ga-facility-labels") => openGaPage(kind, undefined, { storeId: r.store_id, storeLabel: `${r.store_code} ${r.store_name}` });
const openTasks = () => openGaPage("ga-onboarding-tasks");
const openReview = () => openGaPage("ga-onboarding-review");
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 建檔貼標</p>
      <h1>上線貼標進度</h1>
      <p class="muted">每間門市的設備與設施貼標做到哪了：待拍照片 → 待拍貼標照 → 待總務複核 → 完成。完成率 = 完成筆數 / 總筆數。</p>
    </div>
    <div class="actions">
      <button type="button" :disabled="loading" @click="load">重新整理</button>
      <button v-if="caps?.gaOnboardingReview" type="button" @click="openReview">前往貼標複核</button>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '建檔貼標', '上線貼標進度']">
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <section class="summary" aria-label="整體進度" data-testid="progress-summary">
      <div><span class="muted">門市</span><strong>{{ totals.stores }}</strong></div>
      <div><span class="muted">設備與設施</span><strong>{{ totals.total }}</strong></div>
      <div><span class="muted">已完成</span><strong>{{ totals.completed }}</strong></div>
      <div><span class="muted">整體完成率</span><strong data-testid="overall-rate">{{ pct(totals.rate) }}</strong></div>
      <div><span class="muted">已全部完成的門市</span><strong>{{ totals.doneStores }}</strong></div>
    </section>
    <div class="filter-bar">
      <label class="check"><input v-model="showDone" type="checkbox" /> 也顯示已 100% 完成的門市</label>
      <span v-if="loading" role="status" class="muted">載入中…</span>
    </div>
    <ul class="progress-list" aria-label="各門市貼標進度">
      <li v-for="r in shown" :key="r.store_id" class="store" data-testid="progress-card" :data-store-code="r.store_code">
        <div class="head">
          <strong>{{ r.store_code }} {{ r.store_name }}</strong>
          <span class="rate" data-testid="progress-rate">{{ pct(r.completion_rate) }}</span>
        </div>
        <div class="track" role="progressbar" :aria-valuenow="r.completion_rate ?? 0" aria-valuemin="0" aria-valuemax="100" :aria-label="`${r.store_name} 完成率`"><div class="fill" :style="{ width: (r.completion_rate ?? 0) + '%' }" /></div>
        <p class="muted counts">
          設備 {{ r.equipment.completed }} / {{ r.equipment.total }}　設施 {{ r.facility.completed }} / {{ r.facility.total }}　共完成 {{ r.completed }} / {{ r.total }}
        </p>
        <ul class="stages" aria-label="各階段數量">
          <li v-for="s in STAGES" :key="s.status" :class="{ hot: stage(r, s.key) > 0 }"><span>{{ s.label }}</span><strong :data-testid="'stage-' + s.status">{{ stage(r, s.key) }}</strong></li>
          <li><span>完成</span><strong data-testid="stage-COMPLETED">{{ r.completed }}</strong></li>
        </ul>
        <div class="buttons">
          <button type="button" class="big" :aria-expanded="openStore === r.store_id" @click="toggle(r)">{{ openStore === r.store_id ? "收合" : "看卡在哪一台" }}</button>
          <button v-if="caps?.gaEquipmentLabels && r.equipment.total" type="button" class="big" @click="printLabels(r, 'ga-equipment-labels')">印設備標籤</button>
          <button v-if="caps?.gaFacilityLabels && r.facility.total" type="button" class="big" @click="printLabels(r, 'ga-facility-labels')">印設施標籤</button>
        </div>
        <section v-if="openStore === r.store_id" class="stuck" :aria-label="`${r.store_name} 還沒完成的項目`" data-testid="progress-detail">
          <p v-if="stuckBusy" class="muted" role="status">載入中…</p>
          <p v-if="stuckError" class="notice error" role="alert">{{ stuckError }}</p>
          <template v-if="!stuckBusy && !stuckError">
            <p v-if="!stuck.length" class="muted">這間門市沒有卡關的項目。</p>
            <template v-for="s in STAGES" :key="s.status">
              <template v-if="byStage(s.status).length">
                <h4>{{ s.label }}（{{ byStage(s.status).length }}）</h4>
                <ul class="stuck-list">
                  <li v-for="t in byStage(s.status)" :key="t.asset_type + t.id" data-testid="stuck-row" :data-status="t.onboarding_status">
                    <strong>{{ t.name }}</strong> <span class="badge">{{ noun(t.asset_type) }}</span>
                    <span class="muted"> {{ t.code || "尚無編號" }}<template v-if="t.area || t.location_detail"> · {{ [t.area, t.location_detail].filter(Boolean).join(" / ") }}</template></span>
                    <span v-if="t.review_note && t.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO'" class="returned"> 總務退回：{{ t.review_note }}</span>
                  </li>
                </ul>
              </template>
            </template>
            <p v-if="stuckTotal > stuck.length" class="muted">還有 {{ stuckTotal - stuck.length }} 筆未列出，請到貼標待辦搜尋。</p>
            <button v-if="caps?.gaOnboardingTasks" type="button" @click="openTasks">前往貼標待辦</button>
          </template>
        </section>
      </li>
      <li v-if="!shown.length && !loading" class="empty">{{ error ? "資料載入失敗" : rows.length ? "所有門市都已 100% 完成" : "目前沒有任何設備或設施的貼標資料" }}</li>
    </ul>
    <p v-for="r in rows.filter((x) => x.completion_rate === null)" :key="r.store_id" class="muted">{{ r.store_code }} 尚無資產。</p>
    <p class="muted foot">待辦階段說明：{{ Object.values(STAGE_LABEL).join("、") }}。總務退回的項目會回到「待拍照片」，兩張照片都要重拍。</p>
  </GaShell>
</template>

<style scoped>
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }
.summary div { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 10px 14px; display: grid; gap: 2px; }
.summary strong { font-size: 22px; }
.check { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
.progress-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
.store { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.head strong { overflow-wrap: anywhere; }
.rate { font-size: 22px; font-weight: 800; color: var(--primary); }
.track { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }
.fill { height: 100%; background: var(--primary); }
.counts { margin: 0; font-size: 13px; }
.stages { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.stages li { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; display: grid; gap: 2px; font-size: 12px; text-align: center; }
.stages strong { font-size: 18px; }
.stages .hot { background: #fff3d6; border-color: #ecd391; color: #7a5300; }
:root[data-theme="dark"] .stages .hot { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
.buttons { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
.big { min-height: 44px; font-weight: 600; }
.stuck h4 { margin: 10px 0 4px; }
.stuck-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.stuck-list li { overflow-wrap: anywhere; font-size: 14px; }
.badge { border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; font-size: 12px; background: var(--soft); }
.returned { color: var(--danger); }
.empty { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 24px; }
.foot { margin-top: 14px; }
@media (max-width: 700px) { .progress-list { grid-template-columns: 1fr; } .stages { grid-template-columns: repeat(2, 1fr); } }
</style>
