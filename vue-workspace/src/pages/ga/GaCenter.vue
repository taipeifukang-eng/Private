<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ExternalLink } from "lucide-vue-next";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { useSession, type WorkTab } from "../../stores";
import { legacyUrl, openGaPage, useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { HOME_ITEMS, capBadge, openGaAttention, type HomeSummary } from "../../lib/ga-home";
import { fmtTime } from "../../lib/ga-inventory-stock";
import type { GaNavItem } from "../../../../lib/workspace/general-affairs/nav-types";

// G24 總務首頁：待我處理（九項，只列自己有權看的；同權限者共同看，店長只算自己門市）、KPI、庫存提醒（負庫存與低庫存，不計入待辦數字）、入口。
// 數字全由伺服端 ga_ws_home_summary 完整計算，點進去的列表筆數等於這裡的數字。不發 LINE。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const session = useSession();
const flat = (items: GaNavItem[]): GaNavItem[] => items.flatMap((i) => [i, ...(i.children ? flat(i.children) : [])]);
const ported = computed(() => flat((session.data?.gaNavigation || []).flatMap((g) => g.items)).filter((i) => i.kind && i.kind !== "ga-center"));
// 廠商入口（第 6 批）：導向使用者可進入的第一個廠商頁，選單、頁面與 API 共用同一組權限。
const VENDOR_KINDS = ["ga-vendors", "ga-vendor-categories", "ga-vendor-regions", "ga-vendor-stats", "ga-purchase-analysis"] as const;
const vendorEntry = computed(() => VENDOR_KINDS.map((k) => ported.value.find((i) => i.kind === k)).find(Boolean) || null);
// 只憑門市名單身分進來的人（督導、區經理）側欄不留舊版項目，也不一定進得了舊版首頁，所以沒有舊版項目時不放舊版說明與連結。
const hasLegacy = computed(() => flat((session.data?.gaNavigation || []).flatMap((g) => g.items)).some((i) => !i.kind && !i.children?.length));

const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const money = (n: number | undefined) => "NT$ " + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
async function load() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: HomeSummary }>("general-affairs/home/summary");
    if (!latest.isLatest(n)) return;
    summary.value = res.data;
  } catch (e) {
    if (latest.isLatest(n)) error.value = (e as Error).message;
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
let soon: ReturnType<typeof setTimeout> | undefined;
const onChanged = () => { clearTimeout(soon); soon = setTimeout(() => void load(), 600); };
onMounted(() => { void load(); window.addEventListener("ga-data-changed", onChanged); });
onBeforeUnmount(() => { clearTimeout(soon); window.removeEventListener("ga-data-changed", onChanged); });
useRefreshOnActivate(props.tab, load);
const items = computed(() => summary.value?.items || []);
const open = (key: keyof typeof HOME_ITEMS) => { const d = HOME_ITEMS[key]; openGaAttention(d.kind, d.payload); };
const inv = computed(() => summary.value?.inventory || null);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心</p>
      <h1>總務服務中心</h1>
      <p v-if="hasLegacy" class="muted">資產、料件、需求單、採購單、工單、廠商資料與水電網費的新版頁面已開放；其他功能仍在舊版，從左側選單另開分頁。</p>
      <p v-else class="muted">這裡列出您可以查看的新版頁面（唯讀範圍以您負責的門市為限）。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心']">
    <section class="ga-home" aria-labelledby="home-todo">
      <h2 id="home-todo">待我處理<span v-if="summary" class="total" data-testid="home-total" :aria-label="`共 ${summary.total} 項`">{{ capBadge(summary.total) || "0" }}</span><span v-if="loading" class="muted" role="status">　載入中…</span></h2>
      <p v-if="error" class="notice error" role="alert" data-testid="home-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
      <ul v-if="items.length" class="todo" data-testid="home-items">
        <li v-for="it in items" :key="it.key" :data-testid="`home-item-${it.key}`" :class="{ zero: !it.count }">
          <button type="button" class="todo-head" :aria-label="`${it.label} ${it.count} 項，點此開啟清單`" @click="open(it.key)">
            <span>{{ it.label }}</span><strong :data-testid="`home-count-${it.key}`">{{ it.count }}</strong>
          </button>
          <ul v-if="it.top.length" class="top">
            <li v-for="t in it.top" :key="t.id"><span>{{ t.title }}</span><small v-if="t.sub" class="muted">{{ t.sub }}</small></li>
            <li v-if="it.count > it.top.length" class="muted">還有 {{ it.count - it.top.length }} 項…</li>
          </ul>
          <p v-else class="muted none">目前沒有</p>
        </li>
      </ul>
      <p v-else-if="summary" class="muted" data-testid="home-empty">目前沒有需要你處理的項目。</p>
      <p v-if="summary && summary.waiting_reply !== null" class="muted" data-testid="home-waiting">等門市回覆（待確認或待補資料）：{{ summary.waiting_reply }} 張（僅供參考，不計入待辦數字）</p>
      <p v-if="summary" class="muted stamp">資料更新時間：{{ fmtTime(summary.generated_at) }}</p>
    </section>

    <section v-if="summary?.kpi.length" class="ga-home" aria-labelledby="home-kpi">
      <h2 id="home-kpi">目前概況</h2>
      <ul class="kpi" data-testid="home-kpi">
        <li v-for="k in summary.kpi" :key="k.key" :data-testid="`home-kpi-${k.key}`"><span>{{ k.label }}</span><strong>{{ k.value }}<small> {{ k.unit }}</small></strong><small v-if="k.amount !== undefined" class="muted">{{ money(k.amount) }}</small></li>
      </ul>
    </section>

    <section v-if="inv" class="ga-home" aria-labelledby="home-inv">
      <h2 id="home-inv">庫存提醒<small class="muted">　狀態提醒，不計入待辦數字</small></h2>
      <ul class="kpi" data-testid="home-inventory">
        <li :class="{ bad: inv.negative_count > 0 }"><span>負庫存（不允許負數的位置）</span><strong data-testid="home-inv-negative">{{ inv.negative_count }}</strong></li>
        <li><span>低於安全庫存</span><strong data-testid="home-inv-red">{{ inv.low_red_count }}</strong></li>
        <li><span>低於補貨點</span><strong data-testid="home-inv-yellow">{{ inv.low_yellow_count }}</strong></li>
        <li class="muted"><span>允許負庫存的位置（預期，不算異常）</span><strong data-testid="home-inv-allowed">{{ inv.negative_allowed_count }}</strong></li>
      </ul>
      <ul v-if="inv.negative_top.length || inv.low_top.length" class="top inv-top">
        <li v-for="n in inv.negative_top" :key="'n' + n.id" class="bad-row"><span>{{ n.part_name || "（料件）" }}　{{ n.location_name }}</span><strong>{{ n.quantity }}</strong><small class="muted">負庫存</small></li>
        <li v-for="n in inv.low_top" :key="'l' + n.id"><span>{{ n.part_name || "（料件）" }}　{{ n.location_name }}</span><strong>{{ n.quantity }}</strong><small class="muted">{{ n.level === "red" ? "低於安全庫存" : "低於補貨點" }}</small></li>
      </ul>
      <p><button type="button" data-testid="home-inv-open" @click="openGaPage('ga-inventory', undefined, { view: 'balances' })">開啟庫存總覽</button></p>
    </section>

    <section class="ga-home" aria-labelledby="home-entry">
      <h2 id="home-entry">新版已可使用</h2>
      <ul v-if="ported.length" class="ga-cards">
        <li v-if="vendorEntry"><button type="button" data-testid="ga-vendor-entry" @click="openGaPage(vendorEntry.kind!)"><strong>合作廠商</strong><small class="muted">{{ vendorEntry.label }}</small></button></li>
        <li v-for="item in ported" :key="item.id">
          <button type="button" @click="openGaPage(item.kind!)"><strong>{{ item.label }}</strong></button>
        </li>
      </ul>
      <p v-else class="muted">你目前沒有可用的新版總務功能。如需使用，請聯絡管理員開通權限。</p>
      <p v-if="hasLegacy">
        <a :href="legacyUrl('/general-affairs', session.data?.integrated)" target="_blank" rel="noopener">開啟舊版服務中心首頁 <ExternalLink :size="13" /></a>
      </p>
    </section>
  </GaShell>
</template>

<style scoped>
.ga-home { margin-bottom: 22px; }
.ga-home h2 { font-size: 14px; display: flex; align-items: center; gap: 8px; }
.total { background: var(--danger); color: var(--surface); border-radius: 10px; padding: 0 8px; font-size: 12px; }
.todo { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.todo > li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 8px 10px; display: grid; gap: 6px; align-content: start; }
.todo > li.zero { opacity: 0.75; }
.todo-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: none; padding: 4px 0; min-height: 36px; }
.todo-head strong { font-size: 20px; }
.top { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
.top li { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.none { margin: 0; font-size: 12px; }
.stamp { font-size: 12px; }
.kpi { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.kpi li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 8px 12px; display: grid; gap: 2px; }
.kpi li span { font-size: 12px; color: var(--muted); }
.kpi li strong { font-size: 18px; }
.kpi li.bad { border-color: var(--danger); }
.inv-top { margin-bottom: 8px; }
.bad-row strong { color: var(--danger); }
.ga-cards { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.ga-cards button { width: 100%; text-align: left; padding: 14px; display: grid; gap: 2px; }
</style>
