<script setup lang="ts">
// M5 W20：活動檢視列表（取代舊版 /activity-management）。
// 舊版功能補回：年度按鈕（全部＋各年度，預設今年）、狀態標籤、發布對象標籤、發布時間、督導／店長標題、空狀態文案。
// 新增：有「查看全部」權限者看到的未發布草稿加「未發布」標籤（M5 不需決策項目）；停用的活動一律不顯示（Q2，伺服器端過濾）。
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import {
  availableYears,
  campaignInYear,
  defaultViewYear,
  emptyYearText,
  isUnpublished,
  publishTags,
  viewStatusLabel,
  viewerTitle,
} from "../../../lib/workspace/activity-view-rules";
import { campaignPhase, campaignTypeLabel, taipeiToday } from "../../../lib/workspace/campaign-rules";

defineProps<{ tab: WorkTab }>();
const work = useWorkspace();
const rows = ref<any[]>([]);
const loading = ref(true);
const error = ref("");
const denied = ref("");
const role = ref("");
const flags = ref({ supervisor: false, storeManager: false });
const today = ref(taipeiToday());
const year = ref(defaultViewYear());

async function load() {
  loading.value = true;
  error.value = "";
  denied.value = "";
  try {
    const r = await api("activity-view");
    rows.value = r.data || [];
    role.value = r.role || "";
    flags.value = { supervisor: !!r.isSupervisor, storeManager: !!r.isStoreManager };
    today.value = r.today || taipeiToday();
    year.value = defaultViewYear(today.value);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) denied.value = e.message;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const years = computed(() => availableYears(rows.value));
const shown = computed(() => rows.value.filter((c) => campaignInYear(c, year.value)));
const title = computed(() => viewerTitle(flags.value.supervisor, flags.value.storeManager));
const phaseOf = (c: any) => campaignPhase(c, today.value);
const statusOf = (c: any) => viewStatusLabel(c, today.value);
const fmt = (d?: string | null) => (d ? d.slice(0, 10).replaceAll("-", "/") : "");
const open = (c: any) => work.open("activity-view-detail", "", c.id);
</script>

<template>
  <section class="activity-view-list" data-testid="activity-view-list">
    <header class="head">
      <div>
        <h1>活動檢視</h1>
        <p class="muted">
          查看已發布的活動及排程<span v-if="title" data-testid="activity-view-title">（{{ title }}）</span>
        </p>
      </div>
      <button :disabled="loading" @click="load">重新整理</button>
    </header>

    <div v-if="denied" class="empty" role="alert" data-testid="activity-view-denied">
      <h2>無權限</h2>
      <p>{{ denied }}</p>
    </div>
    <p v-else-if="error" class="notice error" role="alert">
      {{ error }}<button @click="load">重試</button>
    </p>
    <p v-else-if="loading" role="status">正在讀取活動…</p>

    <template v-else>
      <div class="years" role="group" aria-label="年度篩選">
        <span class="muted">年度篩選：</span>
        <button :aria-pressed="year === 'all'" data-testid="year-all" @click="year = 'all'">全部</button>
        <button v-for="y in years" :key="y" :aria-pressed="year === y" :data-testid="'year-' + y" @click="year = y">{{ y }} 年</button>
      </div>

      <div v-if="!shown.length" class="empty" data-testid="activity-view-empty">
        <h2>{{ emptyYearText(year) }}</h2>
        <p>當管理員發布活動後，您將可以在此查看活動資訊</p>
      </div>
      <ul v-else class="cards">
        <li v-for="c in shown" :key="c.id" class="card" data-testid="activity-card">
          <div class="card-head">
            <h2>{{ c.name }}</h2>
            <span class="tag" :class="'phase-' + phaseOf(c)" data-testid="status-tag">{{ statusOf(c) }}</span>
            <span v-if="isUnpublished(c)" class="tag draft" data-testid="unpublished-tag" title="尚未發布給督導、店長或盤點組，只有您能看到">未發布</span>
            <span class="tag type">{{ campaignTypeLabel(c.campaign_type) }}</span>
          </div>
          <p>活動期間：<strong>{{ fmt(c.start_date) }} ~ {{ fmt(c.end_date) }}</strong></p>
          <p class="publish">
            發布給：
            <span v-for="t in publishTags(c)" :key="t" class="tag audience" data-testid="audience-tag">{{ t }}</span>
            <span v-if="isUnpublished(c)" class="muted">尚未發布</span>
            <span v-if="c.published_at" class="muted">發布時間：{{ fmt(c.published_at) }}</span>
          </p>
          <div class="actions"><button class="primary" data-testid="open-activity" @click="open(c)">查看排程</button></div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.activity-view-list{display:grid;gap:16px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.head h1{margin:0;font-size:22px}
.head p{margin:4px 0 0}
.years{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.years [aria-pressed="true"]{background:var(--accent,#526b40);color:#fff;border-color:var(--accent,#526b40)}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.card{border:1px solid var(--line,#d9ddd2);border-radius:10px;padding:16px;background:var(--panel,transparent)}
.card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.card-head h2{margin:0 8px 0 0;font-size:18px}
.card p{margin:8px 0}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;border:1px solid var(--line,#d9ddd2)}
.phase-ongoing{background:#dcfce7;color:#14532d;border-color:#86efac}
.phase-upcoming{background:#dbeafe;color:#1e3a8a;border-color:#93c5fd}
.phase-ended{background:#f3f4f6;color:#374151;border-color:#d1d5db}
.draft{background:#fef3c7;color:#78350f;border-color:#fcd34d}
.audience{background:#ede9fe;color:#4c1d95;border-color:#c4b5fd}
.publish{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.actions{display:flex;justify-content:flex-end}
.empty{text-align:center;padding:32px 16px;border:1px dashed var(--line,#d9ddd2);border-radius:10px}
</style>
