<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import { downloadSheetsXlsx } from "../../lib/xlsx";
import { MATRIX_KINDS, MATRIX_KIND_LABELS, matrixTable, matrixWorkbookSheets, periodSheet, reportFileName, type MatrixData, type MatrixKind } from "../../../../lib/workspace/general-affairs/utility-report-matrix";
import GaShell from "../../components/ga/GaShell.vue";
import { useGaGuard, useLatest, useRefreshOnActivate } from "../../lib/ga";
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS, errorText, money, taipeiToday, type ReportRow, type ReportTotals } from "../../lib/ga-utility-bills";
import type { WorkTab } from "../../stores";

// G23 費用報表：月、季、年按據點加總四類費用；每間啟用門市都列（沒帳單算 0），其他據點名稱正規化後合併。
// 純 CSS 長條顯示各據點占合計的比例（不做圖表套件，V10）。另有「年度逐月」檢視（每據點一列、橫向 1～12 月＋全年合計、可切費用類型）與 Excel 匯出。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const today = taipeiToday();
const mode = ref<"month" | "quarter" | "year" | "matrix">("month");
const kind = ref<MatrixKind>("ALL");
const matrix = ref<MatrixData | null>(null);
const exporting = ref(false);
const year = ref(Number(today.slice(0, 4)));
const month = ref(today.slice(5, 7));
const quarter = ref(String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1));
const rows = ref<ReportRow[]>([]);
const totals = ref<ReportTotals | null>(null);
const range = ref<{ start: string; end: string } | null>(null);
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const maxTotal = computed(() => Math.max(1, ...rows.value.map((r) => r.total)));
const mtable = computed(() => (matrix.value ? matrixTable(matrix.value, kind.value) : null));
const mmax = computed(() => Math.max(1, ...(mtable.value ? mtable.value.rows.map((r) => r.sum) : [0])));
const fmt = (n: number) => n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const period = computed(() => (mode.value === "month" ? `${year.value}-${month.value}` : mode.value === "quarter" ? quarter.value : ""));

async function load() {
  if (!allowed.value) return;
  // 年度輸入到一半（空白或超出範圍）先不查，避免送出必定失敗的請求
  if (!Number.isInteger(year.value) || year.value < 2000 || year.value > 2100) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    if (mode.value === "matrix") {
      const res = await api<{ data: MatrixData }>("general-affairs/utility-bills/report-monthly?" + new URLSearchParams({ year: String(year.value) }));
      if (!latest.isLatest(n)) return;
      matrix.value = res.data;
      range.value = { start: `${year.value}-01-01`, end: `${year.value + 1}-01-01` };
      return;
    }
    const q = new URLSearchParams({ mode: mode.value, year: String(year.value) });
    if (period.value) q.set("period", period.value);
    const res = await api<{ data: { rows: ReportRow[]; totals: ReportTotals; start: string; end: string } }>("general-affairs/utility-bills/report?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data.rows;
    totals.value = res.data.totals;
    range.value = { start: res.data.start, end: res.data.end };
  } catch (e) {
    if (latest.isLatest(n)) { rows.value = []; totals.value = null; matrix.value = null; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([mode, year, month, quarter], load);
onMounted(load);
useRefreshOnActivate(props.tab, load);
async function exportXlsx() {
  exporting.value = true;
  error.value = "";
  try {
    if (mode.value === "matrix") {
      if (!matrix.value) return;
      await downloadSheetsXlsx(matrixWorkbookSheets(matrix.value), reportFileName("matrix", year.value));
    } else {
      const label = mode.value === "month" ? `${month.value}月` : mode.value === "quarter" ? `第${quarter.value}季` : "年報表";
      await downloadSheetsXlsx([periodSheet(rows.value, totals.value, label)], reportFileName(mode.value, year.value, mode.value === "month" ? period.value : quarter.value));
    }
  } catch (e) {
    error.value = errorText(e, "匯出失敗，請稍後重試");
  } finally {
    exporting.value = false;
  }
}
const canExport = computed(() => !loading.value && (mode.value === "matrix" ? !!matrix.value : !!totals.value));
const lastDay = (end: string) => { const d = new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 費用管理</p>
      <h1>費用報表</h1>
      <p class="muted">依帳單月份加總（不含已刪除）。啟用中的門市沒有帳單也會列出，金額為 0。</p>
      <p class="muted" data-testid="rp-help">用法：「月報表」每家門市一列、橫向看水、電、電話、網路各費用類型；「年度逐月」每家門市一列、橫向看 1～12 月與全年合計，可上方切換費用類型。兩種都能用「匯出」下載 Excel（年度逐月會多個分頁：合計、水、電、電話、網路）。帳單計費期間跨月時，整張帳單歸在帳單月份，不拆分。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '費用管理', '費用報表']">
    <div class="filter-bar">
      <label>報表類型<select v-model="mode" data-testid="rp-mode"><option value="month">月報表</option><option value="quarter">季報表</option><option value="year">年報表</option><option value="matrix">年度逐月（每月一欄）</option></select></label>
      <label>年度<input v-model.number="year" type="number" min="2000" max="2100" step="1" inputmode="numeric" data-testid="rp-year" /></label>
      <label v-if="mode === 'month'">月份<select v-model="month" data-testid="rp-month"><option v-for="m in 12" :key="m" :value="String(m).padStart(2, '0')">{{ m }} 月</option></select></label>
      <label v-if="mode === 'matrix'">費用類型<select v-model="kind" data-testid="rp-kind"><option v-for="k in MATRIX_KINDS" :key="k" :value="k">{{ MATRIX_KIND_LABELS[k] }}</option></select></label>
      <label v-if="mode === 'quarter'">季度<select v-model="quarter" data-testid="rp-quarter"><option v-for="q in 4" :key="q" :value="String(q)">第 {{ q }} 季</option></select></label>
      <button type="button" class="primary" :disabled="!canExport || exporting" data-testid="rp-export" @click="exportXlsx">{{ exporting ? "匯出中…" : mode === "matrix" ? "匯出 Excel（合計＋水電電話網路各一頁）" : "匯出目前這張表（Excel）" }}</button>
    </div>
    <p v-if="error" class="notice error" role="alert" data-testid="rp-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <p v-if="range" class="muted" data-testid="rp-range">統計期間：{{ range.start }} ～ {{ lastDay(range.end) }}<span v-if="loading" role="status">　載入中…</span></p>
    <ul v-if="mode !== 'matrix' && totals" class="stat-cards" aria-label="合計">
      <li v-for="t in EXPENSE_TYPES" :key="t"><div class="card-static"><span>{{ EXPENSE_TYPE_LABELS[t] }}</span><strong :data-testid="'rp-total-' + t">{{ money(totals[t]) }}</strong></div></li>
      <li class="on"><div class="card-static"><span>合計（{{ totals.bill_count }} 筆帳單）</span><strong data-testid="rp-total">{{ money(totals.total) }}</strong></div></li>
    </ul>
    <div v-if="mode === 'matrix'" class="rp-wrap rp-scroll">
      <table class="rp-table rp-matrix" data-testid="rp-matrix">
        <thead><tr><th>據點</th><th v-for="m in 12" :key="m" class="num">{{ m }}月</th><th class="num">全年合計</th></tr></thead>
        <tbody v-if="mtable">
          <tr v-for="r in mtable.rows" :key="r.key" data-testid="rp-mrow">
            <td data-label="據點"><span data-testid="rp-site">{{ r.label }}</span><span class="bar" aria-hidden="true"><i :style="{ width: (r.sum / mmax) * 100 + '%' }" /></span></td>
            <td v-for="(v, i) in r.months" :key="i" class="num" :data-label="(i + 1) + '月'" :data-testid="'rp-m' + (i + 1)">{{ v ? fmt(v) : "-" }}</td>
            <td class="num" data-label="全年合計"><strong data-testid="rp-msum">{{ fmt(r.sum) }}</strong></td>
          </tr>
          <tr v-if="!mtable.rows.length && !loading"><td colspan="14" class="muted">這一年沒有資料</td></tr>
          <tr v-else class="rp-foot" data-testid="rp-mfoot">
            <td data-label="據點"><strong>合計</strong></td>
            <td v-for="(v, i) in mtable.monthTotals" :key="i" class="num" :data-label="(i + 1) + '月'" :data-testid="'rp-mt' + (i + 1)"><strong>{{ fmt(v) }}</strong></td>
            <td class="num" data-label="全年合計"><strong data-testid="rp-mgrand">{{ fmt(mtable.grandTotal) }}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="rp-wrap">
      <table class="rp-table" data-testid="rp-table">
        <thead><tr><th>據點</th><th class="num">水費</th><th class="num">電費</th><th class="num">電話費</th><th class="num">網路費</th><th class="num">合計</th><th class="num">筆數</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="(r.store_id || '') + r.location_name" data-testid="rp-row">
            <td data-label="據點"><span data-testid="rp-site">{{ r.location_name }}</span><span class="bar" aria-hidden="true"><i :style="{ width: (r.total / maxTotal) * 100 + '%' }" /></span></td>
            <td class="num" data-label="水費">{{ money(r.WATER) }}</td><td class="num" data-label="電費">{{ money(r.ELECTRICITY) }}</td>
            <td class="num" data-label="電話費">{{ money(r.PHONE) }}</td><td class="num" data-label="網路費">{{ money(r.INTERNET) }}</td>
            <td class="num" data-label="合計"><strong>{{ money(r.total) }}</strong></td><td class="num" data-label="筆數">{{ r.bill_count }}</td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="muted">{{ error ? "資料載入失敗" : "這個期間沒有資料" }}</td></tr>
        </tbody>
      </table>
    </div>
  </GaShell>
</template>

<style scoped>
.stat-cards { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.stat-cards li { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.stat-cards li.on { border-color: var(--primary); background: var(--soft); }
.card-static { display: grid; gap: 2px; padding: 8px 12px; min-height: 60px; }
.card-static span { font-size: 12px; color: var(--muted); }
.card-static strong { font-size: 18px; }
.rp-wrap { min-width: 0; }
.rp-table { width: 100%; border-collapse: collapse; }
.rp-table th, .rp-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.rp-table .num { text-align: right; white-space: nowrap; }
.rp-scroll { overflow-x: auto; }
.rp-matrix .num { min-width: 64px; }
.rp-foot td { background: var(--soft); }
.bar { display: block; height: 4px; margin-top: 4px; background: var(--soft); border-radius: 2px; }
.bar i { display: block; height: 100%; background: var(--primary); border-radius: 2px; }
@media (max-width: 700px) {
  .rp-table thead { display: none; }
  .rp-table, .rp-table tbody, .rp-table tr, .rp-table td { display: block; width: 100%; }
  .rp-table tr { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; background: var(--surface); }
  .rp-table td { border: 0; display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; text-align: right; }
  .rp-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; text-align: left; }
  .rp-table td:first-child { display: block; text-align: left; font-weight: 600; }
  .rp-table td:first-child::before { content: none; }
}
</style>
