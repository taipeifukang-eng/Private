<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { PO_STATUS_LABEL } from "../../lib/ga-requests";
import { taipeiToday } from "../../lib/ga-utility-bills";
import type { WorkTab } from "../../stores";

// G22 採購分析：以採購單為主。確定金額（已下訂起）與預估（草稿、待核准、已核准、舊採購評估）分開；月份依下訂日（台北）；伺服端完整彙總，不受舊版 500 筆上限影響。
// 排名預設列前 5 名，可展開全部；廠商名稱以採購單快照為準。需要採購評估檢視或管理權限。純 CSS 長條，沒有圖表套件、沒有匯出（V10）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Rank = { key: string; label: string; amount: number; count: number };
type OrderRow = { id: string; po_no: string; status: string; vendor_label: string; store_label: string; total_amount: number; received_amount: number; ordered_at: string };
type Data = {
  year_month: string; generated_at: string; confirmed: { count: number; total_amount: number; subtotal: number; tax_amount: number; received_amount: number };
  by_vendor: Rank[]; by_store: Rank[]; estimated: { orders: { count: number; total_amount: number }; legacy_reviews: { count: number; total_amount: number; missing_amount_count: number } };
  orders: OrderRow[]; orders_total: number; page: number; page_size: number;
};
const data = ref<Data | null>(null);
const month = ref(taipeiToday().slice(0, 7));
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref("");
const showAllVendors = ref(false);
const showAllStores = ref(false);
const latest = useLatest();
const money = (n: number) => "NT$ " + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
const pages = computed(() => Math.max(1, Math.ceil((data.value?.orders_total || 0) / pageSize)));
const maxOf = (rows: Rank[]) => Math.max(1, ...rows.map((r) => r.amount));
const vendors = computed(() => (showAllVendors.value ? data.value?.by_vendor : data.value?.by_vendor.slice(0, 5)) || []);
const storesRank = computed(() => (showAllStores.value ? data.value?.by_store : data.value?.by_store.slice(0, 5)) || []);

async function load() {
  if (!allowed.value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ yearMonth: month.value, page: String(page.value), pageSize: String(pageSize) });
    const res = await api<{ data: Data }>("general-affairs/purchase-analysis?" + q);
    if (!latest.isLatest(n)) return;
    data.value = res.data;
  } catch (e) {
    if (latest.isLatest(n)) { data.value = null; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch(month, () => { page.value = 1; void load(); });
watch(page, load);
onMounted(load);
useRefreshOnActivate(props.tab, load);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 合作廠商</p>
      <h1>採購分析</h1>
      <p class="muted">以採購單為主：已下訂的採購單才算「確定金額」，月份依下訂日；尚未下訂的草稿與舊採購評估只列「預估」，不混在一起。</p>
    </div>
    <button type="button" :disabled="loading" data-testid="pa-refresh" @click="load"><RefreshCw :size="15" /> 重新整理</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '合作廠商', '採購分析']">
    <div class="filter-bar">
      <label>月份<input v-model="month" type="month" data-testid="pa-month" /></label>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="pa-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <template v-if="data">
      <p class="muted">更新時間：{{ fmtTime(data.generated_at) }}<span v-if="loading" role="status">　載入中…</span></p>
      <h2 class="sec">確定金額（已下訂起）</h2>
      <ul class="stat-cards" aria-label="確定金額">
        <li class="on"><div class="card-static"><span>確定金額（含稅）</span><strong data-testid="pa-confirmed-total">{{ money(data.confirmed.total_amount) }}</strong></div></li>
        <li><div class="card-static"><span>已下訂採購單</span><strong data-testid="pa-confirmed-count">{{ data.confirmed.count }}</strong></div></li>
        <li><div class="card-static"><span>未稅小計</span><strong data-testid="pa-subtotal">{{ money(data.confirmed.subtotal) }}</strong></div></li>
        <li><div class="card-static"><span>已到貨實收（未稅）</span><strong data-testid="pa-received">{{ money(data.confirmed.received_amount) }}</strong></div></li>
      </ul>
      <h2 class="sec">預估（尚未下訂）</h2>
      <ul class="stat-cards" aria-label="預估">
        <li><div class="card-static"><span>草稿與待核准、已核准採購單</span><strong data-testid="pa-est-orders">{{ money(data.estimated.orders.total_amount) }}</strong><small>{{ data.estimated.orders.count }} 張</small></div></li>
        <li><div class="card-static"><span>舊採購評估（只列預估）</span><strong data-testid="pa-est-legacy">{{ money(data.estimated.legacy_reviews.total_amount) }}</strong><small>{{ data.estimated.legacy_reviews.count }} 筆，未填金額 {{ data.estimated.legacy_reviews.missing_amount_count }} 筆</small></div></li>
      </ul>
      <div class="pa-ranks">
        <section aria-labelledby="pa-v">
          <h2 id="pa-v" class="sec">廠商排名</h2>
          <ol class="rank" data-testid="pa-vendors">
            <li v-for="r in vendors" :key="r.key" data-testid="pa-vendor-row"><div><span>{{ r.label }}</span><strong>{{ money(r.amount) }}</strong></div><small>{{ r.count }} 張</small><span class="bar" aria-hidden="true"><i :style="{ width: (r.amount / maxOf(data.by_vendor)) * 100 + '%' }" /></span></li>
            <li v-if="!data.by_vendor.length" class="muted">這個月沒有已下訂的採購單。</li>
          </ol>
          <button v-if="data.by_vendor.length > 5" type="button" data-testid="pa-vendors-toggle" @click="showAllVendors = !showAllVendors">{{ showAllVendors ? "只看前 5 名" : `展開全部 ${data.by_vendor.length} 家` }}</button>
        </section>
        <section aria-labelledby="pa-s">
          <h2 id="pa-s" class="sec">門市排名</h2>
          <ol class="rank" data-testid="pa-stores">
            <li v-for="r in storesRank" :key="r.key" data-testid="pa-store-row"><div><span>{{ r.label }}</span><strong>{{ money(r.amount) }}</strong></div><small>{{ r.count }} 張</small><span class="bar" aria-hidden="true"><i :style="{ width: (r.amount / maxOf(data.by_store)) * 100 + '%' }" /></span></li>
            <li v-if="!data.by_store.length" class="muted">這個月沒有已下訂的採購單。</li>
          </ol>
          <button v-if="data.by_store.length > 5" type="button" data-testid="pa-stores-toggle" @click="showAllStores = !showAllStores">{{ showAllStores ? "只看前 5 名" : `展開全部 ${data.by_store.length} 個` }}</button>
        </section>
      </div>
      <h2 class="sec">本月已下訂採購單（共 {{ data.orders_total }} 張）</h2>
      <div class="pa-wrap">
        <table class="pa-table" data-testid="pa-orders">
          <thead><tr><th>採購單</th><th>廠商</th><th>門市</th><th>狀態</th><th class="num">含稅金額</th><th class="num">已到貨實收</th></tr></thead>
          <tbody>
            <tr v-for="o in data.orders" :key="o.id" data-testid="pa-order-row">
              <td data-label="採購單">{{ o.po_no }}</td><td data-label="廠商">{{ o.vendor_label }}</td><td data-label="門市">{{ o.store_label }}</td>
              <td data-label="狀態">{{ PO_STATUS_LABEL[o.status] || o.status }}</td><td class="num" data-label="含稅金額">{{ money(o.total_amount) }}</td><td class="num" data-label="已到貨實收">{{ money(o.received_amount) }}</td>
            </tr>
            <tr v-if="!data.orders.length"><td colspan="6" class="muted">這個月沒有已下訂的採購單。</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="pages > 1" class="pager">
        <button type="button" :disabled="page <= 1 || loading" data-testid="pa-prev" @click="page--">上一頁</button>
        <span>第 {{ page }} / {{ pages }} 頁</span>
        <button type="button" :disabled="page >= pages || loading" data-testid="pa-next" @click="page++">下一頁</button>
      </div>
    </template>
  </GaShell>
</template>

<style scoped>
.sec { font-size: 14px; margin: 16px 0 8px; }
.stat-cards { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.card-static { display: grid; gap: 2px; padding: 8px 12px; min-height: 60px; }
.card-static span { font-size: 12px; color: var(--muted); }
.card-static strong { font-size: 18px; }
.card-static small { color: var(--muted); font-size: 12px; }
.pa-ranks { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
.rank { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 8px; }
.rank li > div { display: flex; justify-content: space-between; gap: 10px; }
.rank small { color: var(--muted); }
.bar { display: block; height: 4px; margin-top: 3px; background: var(--soft); border-radius: 2px; }
.bar i { display: block; height: 100%; background: var(--primary); border-radius: 2px; }
.pa-wrap { min-width: 0; }
.pa-table { width: 100%; border-collapse: collapse; }
.pa-table th, .pa-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.pa-table .num { text-align: right; white-space: nowrap; }
.pager { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
@media (max-width: 700px) {
  .pa-table { min-width: 0; }
  .pa-table thead { display: none; }
  .pa-table, .pa-table tbody, .pa-table tr, .pa-table td { display: block; width: 100%; }
  .pa-table tr { box-sizing: border-box; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; background: var(--surface); }
  .pa-table td { border: 0; display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; text-align: right; }
  .pa-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-align: left; }
}
</style>
