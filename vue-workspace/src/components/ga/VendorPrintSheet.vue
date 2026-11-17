<script setup lang="ts">
import { computed } from "vue";
import type { TreeRow } from "../../lib/ga-vendors";

// G21 廠商填寫表：空白紙本表單（保留舊版），只印啟用的服務分類與啟用的縣市。列印樣式見 style.css 的 .vendor-print-output（A4、只留這一塊）。
const props = defineProps<{ categories: TreeRow[]; regions: TreeRow[] }>();
const cats = computed(() => props.categories.filter((c) => c.status === "active"));
const cities = computed(() => props.regions.filter((r) => r.status === "active" && r.region_type === "city"));
</script>

<template>
  <div class="vp" data-testid="vendor-print-sheet">
    <section class="vp-page">
      <header class="vp-title"><h1>合作廠商基本資料填寫表</h1><p>請填寫可提供的資料；完成後交回聯絡窗口，由總務人員登錄公司系統。</p></header>
      <section class="vp-section">
        <h2>一、公司基本資料</h2>
        <div class="vp-grid">
          <div class="vp-field"><span>廠商名稱＊</span><i /></div>
          <div class="vp-options"><strong>廠商類型＊</strong><span class="vp-check">□ 公司</span><span class="vp-check">□ 工作室</span><span class="vp-check">□ 個人</span></div>
          <div class="vp-field"><span>統一編號</span><i /></div><div class="vp-field"><span>品牌名稱／別名</span><i /></div>
          <div class="vp-field"><span>成立日期</span><i /></div><div class="vp-field"><span>公司電話</span><i /></div>
          <div class="vp-field"><span>傳真號碼</span><i /></div><div class="vp-field"><span>公司網站</span><i /></div>
          <div class="vp-field vp-wide"><span>公司地址</span><i /></div>
          <div class="vp-wide vp-options"><strong>服務地址</strong><span class="vp-check">□ 同公司地址</span><span class="vp-check">□ 不同，請填下方</span></div>
          <div class="vp-field vp-wide"><span>服務地址</span><i /></div>
        </div>
      </section>
      <section class="vp-section">
        <h2>二、主要聯絡人</h2>
        <div class="vp-grid"><div class="vp-field"><span>姓名</span><i /></div><div class="vp-field"><span>手機</span><i /></div><div class="vp-field"><span>LINE ID</span><i /></div><div class="vp-field"><span>Email</span><i /></div></div>
      </section>
      <section class="vp-section">
        <h2>三、發票與付款資料</h2>
        <div class="vp-grid">
          <div class="vp-field"><span>發票抬頭</span><i /></div>
          <div class="vp-options"><strong>發票類型</strong><span class="vp-check">□ 二聯式</span><span class="vp-check">□ 三聯式</span><span class="vp-check">□ 電子發票</span></div>
          <div class="vp-field vp-wide"><span>發票地址</span><i /></div>
          <div class="vp-options"><strong>付款條件</strong><span class="vp-check">□ 月結30天</span><span class="vp-check">□ 月結45天</span><span class="vp-check">□ 現結</span><span class="vp-check">□ 其他</span></div>
          <div class="vp-options"><strong>付款方式</strong><span class="vp-check">□ 匯款</span><span class="vp-check">□ 支票</span><span class="vp-check">□ 現金</span><span class="vp-check">□ 其他</span></div>
        </div>
        <div class="vp-note">帳務補充：</div><div class="vp-lines" />
      </section>
      <section class="vp-section"><h2>四、公司簡介</h2><div class="vp-lines" style="min-height: 35mm" /></section>
      <p class="vp-note">＊為系統建檔必要資訊；其他欄位若不適用可留白。</p>
    </section>
    <section class="vp-page">
      <header class="vp-title"><h1>合作廠商服務資料</h1><p>請勾選可承作項目與服務範圍，並補充熟悉品牌、設備或專業能力。</p></header>
      <section class="vp-section">
        <h2>五、可提供的服務項目</h2>
        <div class="vp-checks"><span v-for="c in cats" :key="c.id" class="vp-check" data-testid="vp-cat">□ {{ c.name }}</span><span class="vp-check">□ 其他：________________</span></div>
      </section>
      <section class="vp-section">
        <h2>六、可服務縣市</h2>
        <div class="vp-checks"><span v-for="r in cities" :key="r.id" class="vp-check" data-testid="vp-city">□ {{ r.name }}</span><span class="vp-check">□ 全台</span><span class="vp-check">□ 其他：________________</span></div>
        <p class="vp-note">特定行政區或服務限制：</p><div class="vp-lines" />
      </section>
      <section class="vp-section">
        <h2>七、熟悉品牌與設備類型</h2>
        <div class="vp-note">熟悉品牌：</div><div class="vp-lines" /><div class="vp-note">可處理的設備／設施類型：</div><div class="vp-lines" />
      </section>
      <section class="vp-section"><h2>八、服務能力與合作補充</h2><div class="vp-lines" style="min-height: 42mm" /></section>
      <section class="vp-section">
        <h2>九、隨表提供資料</h2>
        <div class="vp-options"><span class="vp-check">□ 公司／商業登記資料</span><span class="vp-check">□ 匯款帳戶資料</span><span class="vp-check">□ 產品型錄</span><span class="vp-check">□ 報價單</span><span class="vp-check">□ 其他</span></div>
      </section>
      <div class="vp-sign"><div class="vp-field"><span>填表人簽名</span><i /></div><div class="vp-field"><span>填表日期</span><i /></div></div>
    </section>
  </div>
</template>

<style scoped>
/* 螢幕上的預覽（紙本樣式）；列印用的全域樣式在 style.css。 */
.vp { background: #fff; color: #111827; border: 1px solid var(--line); border-radius: 8px; padding: 14px; font-size: 13px; min-width: 0; }
.vp-page + .vp-page { margin-top: 18px; border-top: 2px dashed var(--line); padding-top: 14px; }
.vp-title { border-bottom: 2px solid #111827; padding-bottom: 6px; }
.vp-title h1 { margin: 0; font-size: 18px; }
.vp-title p { margin: 2px 0 0; color: #4b5563; font-size: 12px; }
.vp-section { margin-top: 12px; }
.vp-section h2 { margin: 0 0 6px; border-bottom: 1px solid #9ca3af; padding-bottom: 3px; font-size: 14px; }
.vp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; }
.vp-field { display: grid; grid-template-columns: auto 1fr; align-items: end; gap: 6px; min-height: 26px; }
.vp-field span { white-space: nowrap; font-weight: 700; }
.vp-field i { display: block; min-width: 40px; border-bottom: 1px solid #374151; }
.vp-wide { grid-column: 1 / -1; }
.vp-options { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.vp-checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; }
.vp-check { overflow-wrap: anywhere; }
.vp-lines { min-height: 48px; background: repeating-linear-gradient(to bottom, transparent 0, transparent 22px, #9ca3af 22px, #9ca3af 23px); }
.vp-note { margin: 6px 0 0; color: #4b5563; font-size: 12px; }
.vp-sign { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 700px) { .vp-grid, .vp-sign { grid-template-columns: minmax(0, 1fr); } .vp-checks { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
