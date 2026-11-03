<script setup lang="ts">
import {computed} from 'vue';
import {type ThresholdDef,formatRate} from '../../../lib/performance/bonus-calc';
import {calcYearBonus} from '../../../lib/workspace/performance-year';
const props=defineProps<{rows:any[];monthly:ThresholdDef[];quarterly:ThresholdDef[];canEdit:boolean;disabled:boolean}>();
defineEmits<{edit:[month:number]}>();
const amount=(v:any)=>v==null?'—':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
const months=computed(()=>Array.from({length:12},(_,i)=>props.rows.find(r=>r.month===i+1)||{month:i+1,business_days:26}));
const year=computed(()=>calcYearBonus(props.rows,props.monthly,props.quarterly));
const bonuses=computed(()=>year.value.months);
const quarters=computed(()=>[0,1,2,3].map(i=>({index:i,filled:year.value.filled[i],result:year.value.quarters[i]!})));
const columns=[['business_days','營業天數'],['monthly_gross_profit_target','毛利目標'],['monthly_gross_profit_actual','毛利實際'],['activity_day_gross_profit','活動當日毛利'],['monthly_revenue_target','營業額目標'],['monthly_revenue_actual','營業額實際'],['monthly_customer_count_target','來客數目標'],['monthly_customer_count_actual','來客數實際'],['last_month_rx_target','慢箋總張數目標'],['last_month_rx_actual','慢箋總張數實際']];
const metrics=[['毛利','quarterlyGpTarget','quarterlyGpActual','gpAchieved'],['營業額','quarterlyRevenueTarget','quarterlyRevenueActual','revenueAchieved'],['來客數','quarterlyCustomerCountTarget','quarterlyCustomerCountActual','customerCountAchieved'],['慢箋總張數','quarterlyRxTarget','quarterlyRxActual','rxAchieved']];
</script>
<template>
 <section class="performance-quarter-list" aria-label="季度獎金">
  <details v-for="q in quarters" :key="q.index"><summary>Q{{q.index+1}}（{{q.index*3+1}}–{{q.index*3+3}} 月）<span>{{q.filled?`季回補 ${amount(q.result.makeupBonus)} 元／人`:'尚無資料'}}</span></summary>
   <template v-if="q.filled"><p v-if="q.filled<3" class="notice">僅 {{q.filled}} 個月有毛利目標與實績，以下為目前資料試算。</p>
   <div class="module-table"><table><thead><tr><th>指標</th><th>季度目標</th><th>季度實際</th><th>達標</th></tr></thead><tbody><tr v-for="m in metrics"><th>{{m[0]}}</th><td>{{amount((q.result as any)[m[1]])}}</td><td>{{amount((q.result as any)[m[2]])}}</td><td>{{(q.result as any)[m[3]]?'是':'否'}}</td></tr></tbody></table></div>
   <p>營業天數 {{amount(q.result.quarterlyBusinessDays)}} · 毛利達成率 {{formatRate(q.result.gpAchievementRate)}} · 第 {{q.result.gpThresholdLevel}} 檻 · 基本獎金 {{amount(q.result.thresholdBaseAmount)}} · 權重 {{formatRate(q.result.totalWeight*100)}}</p>
   <p>季應得 {{amount(q.result.quarterlyBonus)}} − 月獎金合計 {{amount(q.result.monthlyBonusSum)}} ＝ 季回補 {{amount(q.result.makeupBonus)}} 元／人（最低為 0）</p></template>
   <p v-else class="muted">填寫月份毛利目標與實績後即可計算。</p>
  </details>
 </section>
 <h2>逐月業績明細</h2>
 <div class="module-table"><table class="performance-detail-table"><thead><tr><th>月份</th><th v-for="c in columns">{{c[1]}}</th><th>達成門檻</th><th>月獎金／人</th><th>操作</th></tr></thead><tbody>
  <tr v-for="(r,i) in months" :key="r.month"><th>{{r.month}} 月</th><td v-for="c in columns">{{amount(r[c[0]])}}</td><td>{{bonuses[i]?`第 ${bonuses[i]!.gpThresholdLevel} 檻`:'—'}}</td><td><details v-if="bonuses[i]"><summary>{{amount(bonuses[i]!.finalBonus)}}</summary><dl class="bonus-breakdown"><dt>日毛利目標／實際</dt><dd>{{amount(bonuses[i]!.dailyGpTarget)}}／{{amount(bonuses[i]!.dailyGpActual)}}</dd><dt>毛利／營收／客數／慢箋達成率</dt><dd>{{formatRate(bonuses[i]!.gpAchievementRate)}}／{{formatRate(bonuses[i]!.revenueAchievementRate)}}／{{formatRate(bonuses[i]!.customerCountAchievementRate)}}／{{formatRate(bonuses[i]!.rxAchievementRate)}}</dd><dt>基本金額 × 權重</dt><dd>{{amount(bonuses[i]!.thresholdBaseAmount)}} × {{formatRate(bonuses[i]!.totalWeight*100)}}</dd><dt>活動日折減</dt><dd>{{bonuses[i]!.activityPenaltyApplied?'套用 80%':'未套用'}}；其他營業日平均毛利 {{amount(bonuses[i]!.activityAdjustedDailyGp)}}</dd></dl></details><span v-else>—</span></td><td><button :disabled="disabled" @click="$emit('edit',r.month)">{{canEdit?'編輯':'檢視'}}</button></td></tr>
 </tbody></table></div>
</template>
<style scoped>
.performance-quarter-list {margin:24px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.performance-quarter-list{align-items:start}.performance-quarter-list>details[open]{grid-column:1/-1}.performance-quarter-list table{min-width:0;width:100%}.performance-quarter-list>details{border:1px solid var(--line);padding:14px;background:var(--surface)}summary{cursor:pointer;font-weight:600}summary span{display:block;font-weight:400;margin-top:8px}.performance-detail-table{min-width:1450px}.bonus-breakdown{min-width:260px;white-space:normal}.bonus-breakdown dd{margin:4px 0 12px}.performance-quarter-list p{line-height:1.8;font-size:13px}@media(max-width:800px){.performance-quarter-list{grid-template-columns:1fr}}
</style>
