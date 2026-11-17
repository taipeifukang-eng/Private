<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { api } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import { useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { fmtTime } from "../../lib/ga-inventory-stock";
import { avgDaysText } from "../../../../lib/workspace/general-affairs/home-rules";
import type { WorkTab } from "../../stores";

// G22 廠商績效（合作紀錄）：依工單與採購單真實資料計算（V5）。預設近 12 個月，可選月份區間；評價不顯示。
// 完成數＝已完成且由門市確認的工單；強制結案與未記完成方式另計，不入平均天數。沒選廠商的工單列「未指定」（歷史不回補）。資料不足顯示「資料累積中」而不是 0。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Row = {
  vendor_id: string; vendor_name: string; vendor_alias: string | null; vendor_status: string; wo_count: number; completed_count: number; force_closed_count: number; unknown_method_count: number;
  open_count: number; avg_days: number | null; days_sample: number; po_count: number | null; po_amount: number | null; insufficient: boolean;
};
type Unassigned = { wo_count: number; completed_count: number; force_closed_count: number; unknown_method_count: number; open_count: number };
type Data = { from: string; to: string; generated_at: string; rows: Row[]; unassigned: Unassigned; summary: { wo_total: number; wo_with_vendor: number; po_amount_total: number | null }; accumulating: boolean; can_view_po_amount?: boolean };
const data = ref<Data | null>(null);
const from = ref("");
const to = ref("");
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const STATUS: Record<string, string> = { active: "合作中", paused: "暫停", inactive: "停用" };
const money = (n: number) => "NT$ " + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
const maxWo = computed(() => Math.max(1, ...(data.value?.rows || []).map((r) => r.wo_count)));
// 沒有採購單檢視權限者，資料庫函式把金額欄位回 null；這裡整欄與合計卡都不顯示（不是只把數字遮住）。
const showPo = computed(() => data.value?.can_view_po_amount === true);
const colCount = computed(() => (showPo.value ? 7 : 6));
const rangeBad = computed(() => !!(from.value && to.value && from.value > to.value));

async function load() {
  if (!allowed.value || rangeBad.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams();
    if (from.value) q.set("from", from.value);
    if (to.value) q.set("to", to.value);
    const res = await api<{ data: Data }>("general-affairs/vendor-stats?" + q);
    if (!latest.isLatest(n)) return;
    data.value = res.data;
  } catch (e) {
    if (latest.isLatest(n)) { data.value = null; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([from, to], load);
onMounted(load);
useRefreshOnActivate(props.tab, load);
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 合作廠商</p>
      <h1>合作紀錄</h1>
      <p class="muted">廠商績效由真實的維修工單與採購單計算，只統計有選廠商的工單；沒選廠商的歷史工單不回補，列在「未指定」。不顯示評價。</p>
    </div>
    <button type="button" :disabled="loading" data-testid="vs-refresh" @click="load"><RefreshCw :size="15" /> 重新整理</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '合作廠商', '合作紀錄']">
    <div class="filter-bar">
      <label>起始月份<input v-model="from" type="month" data-testid="vs-from" /></label>
      <label>結束月份<input v-model="to" type="month" data-testid="vs-to" /></label>
      <span class="muted">不選就是近 12 個月；區間最長 36 個月</span>
    </div>
    <p v-if="rangeBad" class="notice error" role="alert">起始月份不能晚於結束月份。</p>
    <p v-if="error" class="notice error" role="alert" data-testid="vs-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <template v-if="data">
      <p class="muted" data-testid="vs-range">統計期間：{{ data.from }} ～ {{ data.to }}（依工單回報日、採購單下訂日）　更新時間：{{ fmtTime(data.generated_at) }}<span v-if="loading" role="status">　載入中…</span></p>
      <p v-if="data.accumulating" class="notice" data-testid="vs-accumulating">資料累積中：這個期間還沒有選了廠商的工單，績效會隨著工單指定廠商逐步累積（歷史工單不回補）。</p>
      <ul class="stat-cards" aria-label="期間合計">
        <li><div class="card-static"><span>期間工單</span><strong data-testid="vs-wo-total">{{ data.summary.wo_total }}</strong></div></li>
        <li><div class="card-static"><span>已選廠商的工單</span><strong data-testid="vs-wo-vendor">{{ data.summary.wo_with_vendor }}</strong></div></li>
        <li><div class="card-static"><span>未指定廠商</span><strong data-testid="vs-wo-unassigned">{{ data.unassigned.wo_count }}</strong></div></li>
        <li v-if="showPo" class="on"><div class="card-static"><span>採購單確定金額</span><strong data-testid="vs-po-total">{{ money(data.summary.po_amount_total ?? 0) }}</strong></div></li>
      </ul>
      <div class="vs-wrap">
        <table class="vs-table" data-testid="vs-table">
          <thead><tr><th>廠商</th><th class="num">工單數</th><th class="num">完成數<small>（門市確認）</small></th><th class="num">強制結案</th><th class="num">未記方式</th><th class="num">受理到完成平均</th><th v-if="showPo" class="num">採購單確定金額</th></tr></thead>
          <tbody>
            <tr v-for="r in data.rows" :key="r.vendor_id" data-testid="vs-row">
              <td data-label="廠商">
                <span data-testid="vs-name">{{ r.vendor_name }}</span><small v-if="r.vendor_status !== 'active'" class="status-tag">{{ STATUS[r.vendor_status] || r.vendor_status }}</small>
                <span class="bar" aria-hidden="true"><i :style="{ width: (r.wo_count / maxWo) * 100 + '%' }" /></span>
              </td>
              <template v-if="r.insufficient">
                <td class="num" data-label="工單數" data-testid="vs-wo">資料累積中</td><td class="num" data-label="完成數">—</td><td class="num" data-label="強制結案">—</td><td class="num" data-label="未記方式">—</td><td class="num" data-label="受理到完成平均">資料累積中</td>
              </template>
              <template v-else>
                <td class="num" data-label="工單數" data-testid="vs-wo">{{ r.wo_count }}</td>
                <td class="num" data-label="完成數" data-testid="vs-completed">{{ r.completed_count }}</td>
                <td class="num" data-label="強制結案" data-testid="vs-forced">{{ r.force_closed_count }}</td>
                <td class="num" data-label="未記方式" data-testid="vs-unknown">{{ r.unknown_method_count }}</td>
                <td class="num" data-label="受理到完成平均" data-testid="vs-avg">{{ avgDaysText(r) }}</td>
              </template>
              <td v-if="showPo" class="num" data-label="採購單確定金額" data-testid="vs-po"><strong>{{ money(r.po_amount ?? 0) }}</strong><small v-if="r.po_count">（{{ r.po_count }} 張）</small></td>
            </tr>
            <tr class="un" data-testid="vs-unassigned">
              <td data-label="廠商">未指定（工單沒選廠商）</td>
              <td class="num" data-label="工單數">{{ data.unassigned.wo_count }}</td><td class="num" data-label="完成數">{{ data.unassigned.completed_count }}</td>
              <td class="num" data-label="強制結案">{{ data.unassigned.force_closed_count }}</td><td class="num" data-label="未記方式">{{ data.unassigned.unknown_method_count }}</td>
              <td class="num" data-label="受理到完成平均">—</td><td v-if="showPo" class="num" data-label="採購單確定金額">—</td>
            </tr>
            <tr v-if="!data.rows.length && !loading"><td :colspan="colCount" class="muted">這個期間沒有廠商的工單或採購單紀錄。</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted vs-note">完成數只算「已完成且由門市確認」的工單；總務強制結案與沒有記錄完成方式的舊資料另列，不列入平均處理天數。<template v-if="showPo">採購單確定金額為已下訂起（含部分到貨、已到貨、已結案）的含稅金額。</template><template v-else>採購單金額只給有採購單檢視權限的人，且只列有工單的廠商。</template></p>
    </template>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.card-static { display: grid; gap: 2px; padding: 8px 12px; min-height: 60px; }
.card-static span { font-size: 12px; color: var(--muted); }
.card-static strong { font-size: 18px; }
.vs-wrap { min-width: 0; }
.vs-table { width: 100%; border-collapse: collapse; }
.vs-table th, .vs-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.vs-table .num { text-align: right; }
.vs-table small { color: var(--muted); font-weight: 400; margin-left: 4px; }
.vs-table tr.un td { color: var(--muted); }
.status-tag { border: 1px solid var(--line); border-radius: 10px; padding: 0 6px; font-size: 11px; }
.bar { display: block; height: 4px; margin-top: 4px; background: var(--soft); border-radius: 2px; }
.bar i { display: block; height: 100%; background: var(--primary); border-radius: 2px; }
.vs-note { font-size: 12px; }
@media (max-width: 700px) {
  .vs-table { min-width: 0; }
  .vs-table thead { display: none; }
  .vs-table, .vs-table tbody, .vs-table tr, .vs-table td { display: block; width: 100%; }
  .vs-table tr { box-sizing: border-box; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; background: var(--surface); }
  .vs-table td { border: 0; display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; text-align: right; }
  .vs-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-align: left; }
  .vs-table td:first-child { display: block; text-align: left; font-weight: 600; }
  .vs-table td:first-child::before { content: none; }
}
</style>
