<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { api } from '../api';
import { useWorkspace, type WorkTab } from '../stores';
import Modal from './Modal.vue';
import MonthlyQuarter from './MonthlyQuarter.vue';
import ActivityPlan from './ActivityPlan.vue';
const quarterMode=ref<'quarterBonuses'|'quarterPerformance'|''>('');
const quarterNumber=computed(()=>Math.ceil(Number(props.tab.month.slice(5))/3));
const props = defineProps<{ tab: WorkTab; monthState: string; rows: any[]; options: any; revision: number; disabled: boolean; globalTarget?:HTMLElement; storeTarget?:HTMLElement }>();
const emit = defineEmits<{ refresh: [] }>();
const work = useWorkspace(), meta = ref<any>({capabilities:{},stats:{}}), loading = ref(false), error = ref(''), message = ref('');
const mode = ref(''), entries = ref<any[]>([]), form = ref<any>({}), expected = ref<any[]>([]), readRows = ref<any[]>([]), dialogLoading = ref(false), dialogError = ref(''), discard = ref(false), query = ref(''), candidates = ref<any[]>([]), selectedIndex = ref(-1);
const activityDetail = ref<any>(null), activityYear = ref('');
const visibleActivities = computed(()=>readRows.value.filter(r=>!activityYear.value || (r.start_date <= activityYear.value+'-12-31' && r.end_date >= activityYear.value+'-01-01')));
const ready = ref(false);
const file1 = ref<File>(), file2 = ref<File>(), importResult = ref<any>(null);
let requestId = '', baseline = '', context = {store:'',month:''}, searchSequence = 0, openSequence = 0;
const titles:Record<string,string> = { support:'上個月單品獎金',transport:'交通費用',talent:'育才獎金',spring:'春節出勤獎金',meal:'誤餐費登記',stats:'門市每月統計資料',supportHours:'本月門市支援時數',manual:'手動新增員工',activity:'活動檢視',bonuses:'每月人員各式獎金明細',performance:'該月業績狀況',importPerformance:'匯入業績資料',importStats:'匯入門市統計' };
const fields:Record<string,[string,string,string][]> = {
 support:[['bonus_amount','單品獎金','number']], transport:[['monthly_transport_expense','交通費','number'],['transport_expense_notes','原因','text']],
 talent:[['cultivation_bonus','育才獎金','number'],['cultivation_target','育才對象','text']], spring:[['attendance_date','出勤日期','date'],['category','對象分類','category'],['bonus_amount','出勤獎金','number']],
 meal:[['record_date','日期（MM/DD）','text'],['work_hours','上班區間（HH:MM-HH:MM）','text'],['meal_period','誤餐時段','period'],['employee_type','身分','employeeType']],
};
const statsFields:[string,string][] = [['total_staff_count','門市人數'],['admin_staff_count','行政人數'],['newbie_count','新人人數'],['business_days','營業天數'],['total_gross_profit','毛利'],['total_customer_count','總來客數'],['prescription_addon_only_count','單純處方加購'],['regular_prescription_count','一般箋張數'],['chronic_prescription_count','慢箋張數']];
const supportFields:[string,string][] = [['support_to_other_stores_hours','支援分店時數'],['support_from_other_stores_hours','分店支援時數']];
const bonusFields:[string,string][] = [['employee_code','員編'],['employee_name','姓名'],['group_bonus','團體獎金'],['single_item_bonus','單品獎金'],['hr_subsidy_bonus','人資補貼'],['brand_bonus','品牌獎金'],['talent_bonus','育才獎金'],['transport_fee','交通費'],['meal_allowance','誤餐費'],['spring_festival_bonus','春節出勤獎金'],['inventory_bonus','盤點獎金'],['rx_incentive_bonus','處方獎金'],['inventory_diff_penalty','盤差承擔'],['quarterly_makeup_bonus','季回補'],['pharmacist_guarantee','藥師保證金'],['owner_rx_makeup','負責人處方回補'],['sales_competition_bonus','銷售競賽'],['owner_signing_bonus','負責人簽約金'],['long_term_care_bonus','長照獎金'],['manager_supervisor_quarterly_bonus','經理／督導季獎金'],['opening_abnormal_responsibility_amount','開店異常責任金額'],['bonus_difference_adjustment','獎金差額調整'],['other_bonus','其他獎金'],['source_store_name','來源門市'],['total','合計']];
const performanceFields:[string,string][] = [['business_days','營業天數'],['monthly_gross_profit_target','毛利目標'],['monthly_gross_profit_actual','實際毛利'],['activity_day_gross_profit','活動當日毛利'],['monthly_revenue_target','營收目標'],['monthly_revenue_actual','實際營收'],['monthly_customer_count_target','來客目標'],['monthly_customer_count_actual','實際來客'],['last_month_rx_target','慢箋目標'],['last_month_rx_actual','慢箋實際']];
const caps = computed(()=>meta.value.capabilities || {});
const locked = computed(()=>['submitted','confirmed'].includes(props.monthState));
const writable = computed(()=>!!fields[mode.value] || ['stats','supportHours','manual'].includes(mode.value));
const snapshot = ()=>JSON.stringify({entries:entries.value,form:form.value});
watch([entries,form],()=>{ if(writable.value && ready.value && !dialogLoading.value) props.tab.dirty = snapshot() !== baseline; },{deep:true,flush:'sync'});
const fmt = (n:any)=>n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-TW',{maximumFractionDigits:1});
const derived = computed(()=>{
 const s=meta.value.stats, customers=Number(s.total_customer_count)-Number(s.prescription_addon_only_count);
 return [['人力點值',s.total_staff_count == null ? null : Number(s.total_staff_count)+Number(s.admin_staff_count)*.5+Number(s.newbie_count)*.3],['日毛利',s.business_days>0 ? Math.round(s.total_gross_profit/s.business_days):null],['客毛利',customers>0?Math.round(s.total_gross_profit/customers):null],['日來客數',s.business_days>0?Math.round(customers/s.business_days*10)/10:null]];
});
async function load() {
 if (!props.tab.store || props.disabled) return;
 loading.value=true; error.value='';
 try { meta.value=await api(`monthly/tools?${new URLSearchParams({store:props.tab.store,month:props.tab.month})}`); }
 catch(e){ error.value=(e as Error).message; meta.value={capabilities:{},stats:{}}; }
 finally {loading.value=false;}
}
watch(()=>props.revision,load,{immediate:true});
async function read(op:string, extra:Record<string,string>={}) { return api(`monthly/tools?${new URLSearchParams({...context,op,...extra})}`); }
async function open(kind:string) {
 const sequence=++openSequence; requestId=crypto.randomUUID();
 context={store:props.tab.store,month:props.tab.month};
 mode.value=kind; activityDetail.value=null; activityYear.value=context.month.slice(0,4); ready.value=false; dialogError.value=''; dialogLoading.value=true; query.value=''; candidates.value=[]; selectedIndex.value=-1; importResult.value=null; file1.value=undefined; file2.value=undefined;
 entries.value=[]; form.value={}; readRows.value=[];
 try {
  if(fields[kind]) {
   const r=await read('allowance',{kind}); if(sequence!==openSequence)return; expected.value=r.expected; entries.value=r.records.map((x:any)=>({...x}));
   if(kind==='transport') entries.value=entries.value.map(r=>({...r,monthly_transport_expense:r.monthly_transport_expense || 0,transport_expense_notes:r.transport_expense_notes || ''}));
  } else if(kind==='stats'||kind==='supportHours') {
   const r=await read('meta'); if(sequence!==openSequence)return; meta.value=r;
   for(const [key] of kind==='stats'?statsFields:supportFields) form.value[key]=r.stats[key] ?? 0;
  } else if(kind==='manual') form.value={employee_code:'',employee_name:'',position:'專員',employment_type:'full_time',monthly_status:'full_month',work_days:new Date(Number(context.month.slice(0,4)),Number(context.month.slice(5)),0).getDate(),work_hours:0,is_pharmacist:false,newbie_level:'',notes:''};
  else if(['activity','bonuses','performance'].includes(kind)) { const r=await read(kind); if(sequence!==openSequence)return; readRows.value=kind==='bonuses' ? (r.data || []).flatMap((person:any)=>(person.entries || []).map((entry:any)=>({...entry,employee_code:person.employee_code,employee_name:person.employee_name}))) : r.data || r.records || []; }
  ready.value=true;
 } catch(e){dialogError.value=(e as Error).message;}
 finally { if(sequence===openSequence){baseline=snapshot(); props.tab.dirty=false; dialogLoading.value=false;} }
}
function close(force=false) { if(props.tab.busy)return; if(props.tab.dirty&&!force){discard.value=true;return;} ++openSequence; ++searchSequence; mode.value='';discard.value=false;props.tab.dirty=false; }
function add() { const r:any={employee_code:'',employee_name:''}; for(const [key,,type] of fields[mode.value]) r[key]=type==='number'?0:''; if(mode.value==='spring'){r.category='專員';r.bonus_amount=1500;} entries.value.push(r); }
async function search(index:number) {
 selectedIndex.value=index; const seq=++searchSequence; candidates.value=[];
 if(!query.value.trim())return;
 try {const r=await read('employees',{q:query.value}); if(seq===searchSequence)candidates.value=r.records;}catch(e){dialogError.value=(e as Error).message;}
}
function choose(e:any) {
 const r=mode.value==='manual'?form.value:entries.value[selectedIndex.value];
 r.employee_code=e.employee_code; r.employee_name=e.employee_name;
 if(mode.value==='manual'){r.is_pharmacist=!!e.is_pharmacist; if(props.options.positions?.includes(e.position))r.position=e.position;}
 if(mode.value==='spring'){r.category=e.is_pharmacist?'藥師':['主任','副店長','店長','督導','代理店長','督導(代理店長)'].includes(e.position)?'主管':'專員';category(r);}
 candidates.value=[];query.value='';selectedIndex.value=-1;
}
function category(r:any){r.bonus_amount=({藥師:2500,主管:2000,專員:1500} as any)[r.category];}
async function save() {
 if(!writable.value||dialogLoading.value||!ready.value)return false;
 props.tab.busy=true; dialogError.value='';
 try {
  const body:any={...context,op:fields[mode.value]?'allowance':mode.value};
  if(fields[mode.value]){body.kind=mode.value;body.records=entries.value;body.expected=expected.value;}
  else if(mode.value==='manual'){body.employee=form.value;body.requestId=requestId;}
  else {body.updates=form.value;body.version=meta.value.version;}
  await api('monthly/tools',{method:'POST',body:JSON.stringify(body)});
  props.tab.dirty=false;baseline=snapshot();message.value=`${titles[mode.value]}已儲存`;mode.value='';emit('refresh');return true;
 }catch(e){dialogError.value=(e as Error).message;return false;}
 finally {props.tab.busy=false;}
}
props.tab.save=save;
onBeforeUnmount(()=>{delete props.tab.save;});
async function importFile() {
 props.tab.busy=true;dialogError.value='';importResult.value=null;
 try {
  if(!file1.value)throw Error('請先選擇 Excel 檔案');
  const data=new FormData();const performance=mode.value==='importPerformance';
  data.set('kind',performance?'performance':'stats');data.set('month',context.month);data.set(performance?'file1':'file',file1.value);
  if(performance&&file2.value)data.set('file2',file2.value);
  importResult.value=await api('monthly/tools',{method:'POST',body:data,signal:AbortSignal.timeout(150000)});
  emit('refresh');
 }catch(e){dialogError.value=(e as Error).message;}
 finally {props.tab.busy=false;}
}
async function excel() {
 props.tab.busy=true;error.value='';
 try {
  const r=await api(`monthly/tools?${new URLSearchParams({op:'excel',store:props.tab.store,month:props.tab.month})}`);
  if(!r.data?.length)throw Error('沒有可匯出的已送審或已確認人員資料');
  const XLSX=await import('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(r.data),'人員狀態');XLSX.writeFile(book,`人員狀態_${props.tab.month}.xlsx`);
  message.value='人員狀態 Excel 已產生';
 }catch(e){error.value=(e as Error).message;}finally{props.tab.busy=false;}
}
async function pdf() {
 props.tab.busy=true;error.value='';
 try {
  const r=await api('monthly/tools',{method:'POST',body:JSON.stringify({op:'pdf',store:props.tab.store,month:props.tab.month})});
  const { generateSingleItemBonusPDF }=await import('../../../lib/reports/single-item-bonus-pdf');
  await generateSingleItemBonusPDF(r.staff,r.store_code,r.store_name,props.tab.month,r.visible_columns);
  message.value='獎金／津貼 PDF 已產生';
 }catch(e){error.value=(e as Error).message;}finally{props.tab.busy=false;}
}
async function activity(r:any){const sequence=++openSequence;dialogLoading.value=true;dialogError.value='';try{const data=await read('activityDetail',{id:r.id});if(sequence===openSequence)activityDetail.value=data;}catch(e){if(sequence===openSequence)dialogError.value=(e as Error).message;}finally{if(sequence===openSequence)dialogLoading.value=false;}}
</script>
<template>
 <p v-if="loading" role="status">載入門市統計與作業權限…</p>
 <div v-if="error" class="notice error" role="alert">{{error}} <button @click="load">重試</button></div>
 <p v-if="message" role="status" class="notice">{{message}}</p>
 <section v-if="caps.viewStats || caps.viewSupport" class="monthly-overview">
  <div v-if="caps.viewStats">
   <div class="monthly-section-title"><h2>門市每月統計資料</h2></div>
   <dl class="monthly-stats"><div v-for="[key,label] in statsFields" :key="key"><dt>{{label}}</dt><dd>{{fmt(meta.stats[key])}}</dd></div><div v-for="[label,value] in derived" :key="String(label)"><dt>{{label}}</dt><dd>{{fmt(value)}}</dd></div></dl>
  </div>
  <div v-if="caps.viewSupport" class="monthly-support"><div class="monthly-section-title"><h2>本月門市支援時數</h2></div><dl class="monthly-stats"><div v-for="[key,label] in supportFields" :key="key"><dt>{{label}}</dt><dd>{{fmt(meta.stats[key])}} 小時</dd></div></dl></div>
 </section>
 <p v-if="locked" class="muted">本月已送審或確認；如需修改填寫內容，請先使用「退回草稿」或「取消確認」。</p>
 <Teleport v-if="globalTarget" :to="globalTarget"> <div class="module-actions monthly-tools" aria-label="跨門市作業">
  <button v-if="caps.activity" :disabled="disabled||loading" @click="open('activity')">活動檢視</button>
  <button v-if="caps.importPerformance" :disabled="disabled||loading" @click="open('importPerformance')">匯入業績資料</button>
  <button v-if="caps.importStats" :disabled="disabled||loading" @click="open('importStats')">匯入門市統計</button>
</div></Teleport>
<Teleport v-if="storeTarget" :to="storeTarget"><div class="module-actions monthly-tools" aria-label="每月人員作業">
<button v-if="caps.editStats && !locked" :disabled="disabled||locked||loading" @click="open('stats')">編輯統計</button><button v-if="caps.editSupport && !locked" :disabled="disabled||locked||loading" @click="open('supportHours')">編輯支援時數</button>
  <button v-if="caps.manual && !locked" :disabled="disabled||locked||loading" @click="open('manual')">手動新增員工</button>
  <template v-for="kind in Object.keys(fields)" :key="kind"><button v-if="caps[kind] && !locked" :disabled="disabled||loading" @click="open(kind)">{{titles[kind]}}</button></template>
  <button v-if="caps.bonusDetails" :disabled="disabled||loading" @click="open('bonuses')">每月人員各式獎金明細</button>
  <button v-if="caps.performance" :disabled="disabled||loading" @click="open('performance')">該月業績狀況</button>
  <button v-if="caps.pdf" :disabled="disabled||loading||tab.busy" @click="excel">匯出 Excel</button>
  <button v-if="caps.pdf && !locked" :disabled="disabled||loading||tab.busy" @click="pdf">匯出當月獎金／津貼 PDF</button>
 </div>
</Teleport>
 <Modal v-if="mode" wide :title="titles[mode]" :busy="tab.busy" @cancel="close()">
  <div class="monthly-dialog">
   <p class="muted">{{tab.title}} · {{context.month}}</p>
   <p v-if="dialogLoading" role="status">載入中…</p>
   <p v-if="dialogError" class="notice error" role="alert">{{dialogError}}</p>
   <p v-if="locked && writable" class="notice">此月份已送審或確認，目前僅供查看。請先退回草稿再修改。</p>
   <form v-if="!dialogLoading && writable" @submit.prevent="save">
    <fieldset :disabled="tab.busy||locked||!ready" class="monthly-fieldset">
     <template v-if="fields[mode]">
      <p v-if="mode==='support'" class="muted">此處登記額外單品獎金；人員原有的上月單品獎金仍保留，匯出時依舊版規則合併。</p>
      <div class="module-table"><table><thead><tr><th>員編／姓名</th><th v-for="[,label] in fields[mode]">{{label}}</th><th v-if="mode!=='transport'">操作</th></tr></thead><tbody>
       <tr v-for="(r,index) in entries" :key="index"><td><span>{{r.employee_code}} {{r.employee_name}}</span><button v-if="mode!=='transport'" type="button" @click="selectedIndex=index;query='';candidates=[]">{{r.employee_name?'更換人員':'選擇人員'}}</button></td>
        <td v-for="[key,label,type] in fields[mode]" :key="key">
         <select v-if="type==='category'" v-model="r[key]" :aria-label="label" @change="category(r)"><option>藥師</option><option>主管</option><option>專員</option></select>
         <select v-else-if="type==='period'" v-model="r[key]" :aria-label="label" required><option value="">請選擇</option><option>中餐</option><option>晚餐</option><option>晚晚餐</option></select>
         <select v-else-if="type==='employeeType'" v-model="r[key]" :aria-label="label" required><option value="">請選擇</option><option>藥師</option><option>非藥師</option></select>
         <input v-else-if="type==='number'" v-model.number="r[key]" type="number" min="0" step="any" required :aria-label="label" />
         <input v-else v-model="r[key]" :type="type" :aria-label="label" :required="key!=='transport_expense_notes'" />
        </td><td v-if="mode!=='transport'"><button type="button" @click="entries.splice(index,1)">移除此列</button></td></tr>
       <tr v-if="!entries.length"><td :colspan="fields[mode].length+2">尚無紀錄。</td></tr>
      </tbody></table></div>
      <button v-if="mode!=='transport'" type="button" @click="add">新增一筆</button>
     </template>
     <div v-else-if="mode==='stats'||mode==='supportHours'" class="monthly-form-grid"><label v-for="[key,label] in mode==='stats'?statsFields:supportFields">{{label}}<input type="number" min="0" step="any" v-model.number="form[key]" required /></label></div>
     <div v-else-if="mode==='manual'" class="monthly-form-grid">
      <label>員工代號<input v-model="form.employee_code" maxlength="50" /></label><label>姓名<input v-model="form.employee_name" required maxlength="100" /></label><button type="button" @click="selectedIndex=0">搜尋既有人員</button>
      <label>職位<select v-model="form.position"><option v-for="p in options.positions" :value="p">{{p}}</option></select></label><label>僱用類型<select v-model="form.employment_type"><option value="full_time">正職</option><option value="part_time">兼職</option></select></label>
      <label>本月狀態<select v-model="form.monthly_status"><option v-for="s in options.statuses" :value="s.value">{{s.label}}</option></select></label>
      <label>階段<select v-model="form.newbie_level"><option value="">不適用</option><option v-for="s in options.levels" :value="s.value">{{s.label}}</option></select></label>
      <label>工作天數<input type="number" min="0" max="31" step="0.5" v-model.number="form.work_days" required /></label><label>工作時數<input type="number" min="0" max="744" step="0.5" v-model.number="form.work_hours" required /></label>
      <label class="monthly-check"><input type="checkbox" v-model="form.is_pharmacist" /> 藥師</label><label>備註<input v-model="form.notes" maxlength="2000" /></label>
     </div>
     <section v-if="selectedIndex>=0" class="monthly-picker"><label>搜尋員編或姓名<input v-model="query" @input="search(selectedIndex)" placeholder="輸入後顯示暫時候選名單" /></label><div class="monthly-candidates"><button v-for="e in candidates" type="button" @click="choose(e)">{{e.employee_code}} {{e.employee_name}}</button><p v-if="query&&!candidates.length">尚無搜尋結果</p></div><button type="button" @click="selectedIndex=-1">關閉搜尋</button></section>
    </fieldset>
    <div class="dialog-actions"><button type="button" @click="close()" :disabled="tab.busy">關閉</button><button v-if="!locked" class="primary" type="submit" :disabled="tab.busy||!ready">{{tab.busy?'儲存中…':'儲存'}}</button></div>
   </form>
   <template v-if="mode.startsWith('import')">
    <p class="notice">匯入月份：{{context.month}}。依檔案中的門市與員編更新該月份資料，範圍包含檔案內所有門市。</p>
    <label>{{mode==='importPerformance'?'業績毛利檔（必填）':'門市統計 Excel'}}<input type="file" accept=".xls,.xlsx" :disabled="tab.busy" @change="file1=($event.target as HTMLInputElement).files?.[0]" /></label>
    <label v-if="mode==='importPerformance'">銷售毛利檔（選填）<input type="file" accept=".xls,.xlsx" :disabled="tab.busy" @change="file2=($event.target as HTMLInputElement).files?.[0]" /></label>
    <div v-if="importResult" role="status"><p>{{importResult.message || '匯入處理完成'}}</p><p v-if="importResult.updated!==undefined">更新 {{importResult.updated}} 筆；略過 {{importResult.skipped}} 筆。</p><p v-if="importResult.details">成功 {{importResult.details.success}} 筆；失敗 {{importResult.details.failed}} 筆。</p><ul><li v-for="e in importResult.errors || importResult.details?.errors || []">{{e}}</li><li v-for="s in importResult.skippedDetails || []">{{s.employeeCode}} {{s.employeeName}}：{{s.reason}}</li></ul></div>
    <div class="dialog-actions"><button @click="close()" :disabled="tab.busy">關閉</button><button class="primary" @click="importFile" :disabled="tab.busy||!file1">{{tab.busy?'匯入中…':'確認匯入'}}</button></div>
   </template>
   <template v-if="['activity','bonuses','performance'].includes(mode)">
    <div class="module-actions" v-if="mode==='bonuses'||mode==='performance'">
     <button v-if="mode==='bonuses' && caps.bonusDetails" @click="quarterMode='quarterBonuses'">查看 Q{{quarterNumber}} 各式獎金總額</button>
     <button v-if="mode==='performance' && caps.performance" @click="quarterMode='quarterPerformance'">該季業績狀況</button>
    </div>
    <template v-if="mode==='activity'">
     <template v-if="!activityDetail"><label>活動年度<input type="number" min="2000" max="2099" v-model="activityYear" /></label><div class="module-table"><table><thead><tr><th>活動</th><th>期間</th><th>操作</th></tr></thead><tbody><tr v-for="r in visibleActivities"><td>{{r.name}}</td><td>{{r.start_date}}～{{r.end_date}}</td><td><button @click="activity(r)" :disabled="dialogLoading">查看活動規劃</button></td></tr></tbody></table></div></template>
     <ActivityPlan v-else :key="activityDetail.campaign.id" :data="activityDetail" :store="context.store" @back="activityDetail=null" @retry="activity(activityDetail.campaign)" />
    </template>
    <div v-else class="module-table"><table><thead><tr><th v-for="[,label] in mode==='bonuses'?bonusFields:performanceFields">{{label}}</th></tr></thead><tbody><tr v-for="r in readRows"><td v-for="[key] in mode==='bonuses'?bonusFields:performanceFields">{{key.startsWith('employee_')||key==='source_store_name'?r[key]:fmt(r[key])}}</td></tr></tbody></table></div>
    <p v-if="mode==='activity'&&!activityDetail&&!visibleActivities.length&&!dialogLoading">此年度尚無可查看的活動。</p><p v-else-if="mode!=='activity'&&!readRows.length&&!dialogLoading">此月份尚無資料。</p><div class="dialog-actions"><button @click="close()">關閉</button></div>
   </template>
   <div v-if="dialogLoading" class="dialog-actions"><button @click="close()">關閉</button></div>
  </div>
 </Modal>
 <MonthlyQuarter v-if="quarterMode" :kind="quarterMode" :store="context.store" :month="context.month" :store-label="tab.title" :bonus-fields="bonusFields" @close="quarterMode=''" />
 <Modal v-if="discard" title="放棄尚未儲存的內容？" @cancel="discard=false"><p>目前填寫的內容尚未儲存。</p><div class="dialog-actions"><button @click="discard=false">繼續編輯</button><button @click="close(true)">放棄並關閉</button></div></Modal>
</template>
<style scoped>
.monthly-check{display:flex!important;align-items:center;gap:8px}.monthly-check input{width:18px!important;height:18px;min-height:18px;padding:0;flex:0 0 18px}.monthly-dialog .dialog-actions{position:sticky;bottom:-28px;background:var(--surface,#fff);padding:12px 0;margin-top:16px;border-top:1px solid var(--line,#d8dfd1)}.monthly-overview{border-block:1px solid var(--border,#d8dfd1);padding:20px 0;margin-bottom:16px;display:grid;grid-template-columns:minmax(0,3fr) minmax(250px,1fr);gap:28px}.monthly-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.monthly-section-title h2{font-size:15px;margin:0}.monthly-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:18px 0 0}.monthly-stats dt{font-size:12px;color:var(--muted,#616d5a)}.monthly-stats dd{margin:5px 0 0;font-variant-numeric:tabular-nums;font-weight:600}.monthly-support .monthly-stats{grid-template-columns:1fr 1fr}.monthly-tools{flex-wrap:wrap}.monthly-dialog{width:min(1100px,calc(100vw - 100px));max-width:100%}.monthly-fieldset{border:0;padding:0;min-width:0}.monthly-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.monthly-form-grid label{display:grid;gap:6px}.monthly-picker{border-block:1px solid #d8dfd1;padding:16px 0;margin-top:16px}.monthly-candidates{display:flex;flex-wrap:wrap;gap:8px;max-height:200px;overflow:auto;margin-block:12px}.monthly-dialog td input{min-width:100px;width:100%;max-width:250px}.monthly-dialog td{vertical-align:top}.monthly-dialog td button{display:block;margin-top:6px}.monthly-dialog label>input[type=file]{display:block;margin-block:12px}.monthly-dialog .module-table{margin-block:16px;max-height:55vh}.monthly-dialog input[type=checkbox]{width:auto}@media(max-width:900px){.monthly-overview{grid-template-columns:1fr}.monthly-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.monthly-form-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.monthly-stats,.monthly-form-grid{grid-template-columns:1fr 1fr}.monthly-dialog{width:100%}.monthly-section-title{align-items:flex-start}.monthly-dialog .dialog-actions{flex-wrap:wrap}}
</style>
