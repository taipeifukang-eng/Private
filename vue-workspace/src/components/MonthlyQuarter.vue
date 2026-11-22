<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {api} from '../api';
import Modal from './Modal.vue';
import {MONTHLY_DAILY_GP_STEP,formatRate} from '../../../lib/performance/bonus-calc';
const props=defineProps<{kind:'quarterBonuses'|'quarterPerformance';store:string;month:string;storeLabel:string;bonusFields:[string,string][]}>();
defineEmits<{close:[]}>();
const data=ref<any>(null),error=ref(''),loading=ref(false);
let controller:AbortController|undefined;
const quarter=Math.ceil(Number(props.month.slice(5))/3);
const title=computed(()=>props.kind==='quarterBonuses'?`Q${quarter} 各式獎金總額`:'該季業績狀況');
const columns=computed(()=>props.bonusFields.filter(([key])=>!['employee_code','employee_name','source_store_name','total'].includes(key) && Number(data.value?.totals?.[key] ?? 0)!==0));
const result=computed(()=>data.value?.quarterlyResult);
const metrics=[['毛利','quarterlyGpTarget','quarterlyGpActual','gpAchieved',90],['營業額','quarterlyRevenueTarget','quarterlyRevenueActual','revenueAchieved',5],['來客數','quarterlyCustomerCountTarget','quarterlyCustomerCountActual','customerCountAchieved',5],['慢箋總張數','quarterlyRxTarget','quarterlyRxActual','rxAchieved',10]] as const;
const amount=(n:any)=>n==null?'—':Number(n).toLocaleString('zh-TW',{maximumFractionDigits:2});
async function load(){
 controller?.abort();controller=new AbortController();loading.value=true;error.value='';data.value=null;
 try{data.value=await api(`monthly/tools?${new URLSearchParams({op:props.kind,store:props.store,month:props.month})}`,{signal:controller.signal});}
 catch(e){error.value=(e as Error).message;}finally{loading.value=false;}
}
onMounted(load);onBeforeUnmount(()=>controller?.abort());
</script>
<template>
 <Modal :title="title" wide @cancel="$emit('close')">
  <div class="quarter-body">
   <p>{{storeLabel}} · {{month.slice(0,4)}}-Q{{quarter}}</p>
   <p v-if="loading" role="status">載入季度資料…</p>
   <div v-else-if="error" class="notice error" role="alert">{{error}} <button @click="load">重試</button></div>
   <template v-else-if="data && kind==='quarterBonuses'">
    <p>統計月份：{{data.months.join('、')}}</p>
    <p class="muted">依本季門市人員名冊彙整，包含這些人員在其他門市的獎金紀錄。</p>
    <p v-if="!data.employees.length">本店該季尚無人員獎金資料。</p>
    <div v-else class="module-table"><table><thead><tr><th>員編</th><th>姓名</th><th v-for="[key,label] in columns" :key="key">{{label}}</th><th>合計</th></tr></thead><tbody>
     <tr v-for="r in data.employees" :key="r.employee_code"><td>{{r.employee_code}}</td><td>{{r.employee_name || '—'}}</td><td v-for="[key] in columns" :key="key">{{amount(r.totals[key])}}</td><td>{{amount(r.total)}}</td></tr>
    </tbody><tfoot><tr><th colspan="2">總計</th><td v-for="[key] in columns" :key="key">{{amount(data.totals[key])}}</td><td>{{amount(data.grand_total)}}</td></tr></tfoot></table></div>
   </template>
   <template v-else-if="data && kind==='quarterPerformance'">
    <p>{{data.quarterLabel}} · 實際累計至 {{data.includedThroughMonth}} 月，目標採完整季度。</p>
    <p v-if="!result">本店該季尚無業績資料。</p>
    <template v-else>
     <h3>各月團體獎金／人</h3>
     <div class="module-table"><table><thead><tr><th>月份</th><th>毛利門檻</th><th>毛利達成率</th><th>月獎金</th><th>活動日折減</th></tr></thead><tbody>
      <tr v-for="(m,i) in data.months" :key="m"><th>{{m}} 月</th><template v-if="m>data.includedThroughMonth"><td colspan="4">未納入實際</td></template><template v-else-if="data.monthlyBonuses[i]"><td>{{data.monthlyBonuses[i].gpThresholdLevel?`第 ${data.monthlyBonuses[i].gpThresholdLevel} 檻`:'未達門檻'}}</td><td>{{formatRate(data.monthlyBonuses[i].gpAchievementRate)}}</td><td>{{amount(data.monthlyBonuses[i].finalBonus)}}</td><td>{{data.monthlyBonuses[i].activityPenaltyApplied?'套用 80%':'未套用'}}</td></template><td v-else colspan="4">無可計算的目標與實績</td></tr>
     </tbody></table></div>
     <p class="quarter-total">月獎金合計 {{amount(result.monthlyBonusSum)}} 元／人 · 季獎金應得 {{amount(result.quarterlyBonus)}} 元／人 · 補差額 {{amount(result.makeupBonus)}} 元／人</p>
     <h3>季度目標與實績</h3>
     <div class="module-table"><table><thead><tr><th>指標</th><th>季度目標</th><th>實際累計</th><th>達標</th><th>獎金權重</th></tr></thead><tbody><tr v-for="m in metrics" :key="m[0]"><th>{{m[0]}}</th><td>{{amount(result[m[1]])}}</td><td>{{amount(result[m[2]])}}</td><td>{{result[m[3]]?'已達標':'未達標'}}</td><td>{{result[m[3]]?m[4]:0}}%</td></tr></tbody></table></div>
     <p>營業天數 {{amount(result.quarterlyBusinessDays)}} 天 · 毛利達成率 {{formatRate(result.gpAchievementRate)}} · 合計權重 {{formatRate(result.totalWeight*100)}}</p>
     <h3>季毛利獎金檻位目標</h3>
     <div class="module-table"><table><thead><tr><th>門檻</th><th>目標毛利</th><th>基本獎金</th><th>距離目標</th></tr></thead><tbody><tr v-for="(t,i) in data.quarterlyThresholds" :key="i"><th>第 {{i+1}} 檻</th><td>{{amount(result.quarterlyGpTarget+MONTHLY_DAILY_GP_STEP*result.quarterlyBusinessDays*i)}}</td><td>{{amount(t.baseAmount)}}</td><td>{{result.quarterlyGpActual>=result.quarterlyGpTarget+MONTHLY_DAILY_GP_STEP*result.quarterlyBusinessDays*i?'已達標':`還差 ${amount(result.quarterlyGpTarget+MONTHLY_DAILY_GP_STEP*result.quarterlyBusinessDays*i-result.quarterlyGpActual)}`}}</td></tr></tbody></table></div>
    </template>
   </template>
  </div>
  <div class="dialog-actions"><button @click="$emit('close')">返回月明細</button></div>
 </Modal>
</template>
<style scoped>
.quarter-body{min-width:0}.quarter-body h3{font-size:15px;margin:20px 0 10px}.module-table{max-height:45vh;margin:12px 0}.module-table table{min-width:600px;width:100%}.module-table th,.module-table td{white-space:nowrap}tfoot,.quarter-total{font-weight:600}.quarter-total{line-height:1.8;padding-block:12px;border-block:1px solid var(--line)}.dialog-actions{position:sticky;bottom:-28px;background:var(--surface);padding:12px 0}.muted{font-size:13px}
</style>
