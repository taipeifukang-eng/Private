<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount,watch} from 'vue';
import {api,taiwanMonth} from '../api';
import type {WorkTab} from '../stores';
import Modal from '../components/Modal.vue';
import {detailTotals,filterSortPage,nextSort,togglePosition,type SortDirection} from '../employee-purchases-view';
const props=defineProps<{tab:WorkTab}>();
const month=ref(props.tab.month||taiwanMonth()),loadedMonth=ref(''),position=ref(''),data=ref<any>(null),loading=ref(false),error=ref(''),message=ref(''),warnings=ref<string[]>([]);
const collapsed=ref(false),search=ref(''),page=ref(1),sortKey=ref(''),direction=ref(0);
const columns=[['recognized_store','認列門市'],['employee_code','員工代號'],['employee_name','員工姓名'],['employee_position','職稱'],['purchase_count','消費筆數'],['total_amount','消費總額']];
const money=(n:any)=>Math.round(Number(n||0)).toLocaleString('zh-TW');
const decimal=(n:any)=>Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
const fmt=(s:string)=>new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const result=computed(()=>filterSortPage(data.value?.rows||[],search.value,sortKey.value,direction.value as SortDirection,page.value));
const rows=computed(()=>({length:result.value.total})),pages=computed(()=>result.value.pages),visible=computed(()=>result.value.rows as any[]);
const totals=computed(()=>detailTotals(detail.value?.details||[]));
watch(search,()=>page.value=1);
function sort(k:string){const n=nextSort({key:sortKey.value,direction:direction.value as SortDirection},k);sortKey.value=n.key;direction.value=n.direction;page.value=1}
async function load(nextPosition=position.value,nextMonth=month.value){
 if(loading.value)return;loading.value=true;error.value='';
 try{const result=await api('employee-purchases?'+new URLSearchParams({year_month:nextMonth,position:nextPosition}));data.value=result;position.value=nextPosition;month.value=nextMonth;loadedMonth.value=nextMonth;props.tab.month=nextMonth;page.value=1;}
 catch(e:any){error.value=e.message}finally{loading.value=false}
}
function monthChanged(){if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)&&month.value!==loadedMonth.value)void load(position.value,month.value)}
const selected=ref<any>(null),detail=ref<any>(null),detailError=ref(''),detailLoading=ref(false);
async function showDetail(row:any){selected.value=row;detail.value=null;detailError.value='';detailLoading.value=true;
 try{detail.value=await api('employee-purchases/employee-details?'+new URLSearchParams({year_month:loadedMonth.value,employee_code:row.employee_code||'',employee_name:row.employee_name||''}))}catch(e:any){detailError.value=e.message}finally{detailLoading.value=false}}
const importing=ref(false),file=ref<File|null>(null),confirmed=ref(false),importError=ref(''),discard=ref(false);
watch(file,v=>props.tab.dirty=!!v,{flush:'sync'});
function openImport(){importing.value=true;importError.value='';confirmed.value=false}
function closeImport(){if(props.tab.busy)return;if(file.value)discard.value=true;else importing.value=false}
function choose(e:Event){file.value=(e.target as HTMLInputElement).files?.[0]||null;confirmed.value=false;importError.value=''}
async function upload(){
 if(!file.value||!confirmed.value||props.tab.busy)return false;
 if(!/\.(xlsx|xls)$/i.test(file.value.name)){importError.value='僅支援 .xlsx 或 .xls 檔案';return false}
 props.tab.busy=true;importError.value='';
 try{const fd=new FormData();fd.append('file',file.value);const result=await api('employee-purchases/import',{method:'POST',body:fd,signal:AbortSignal.timeout(180000)});
 message.value=`匯入完成：歸屬月份 ${result.year_month}，${result.imported} 筆，已比對 ${result.matched} 筆，未比對 ${result.unmatched} 筆，跳過 ${result.skipped} 筆，總金額 ${money(result.total_amount)}`;
 warnings.value=result.errors||[];file.value=null;importing.value=false;confirmed.value=false;await load(position.value,result.year_month);return true;
 }catch(e:any){importError.value=e.message;return false}finally{props.tab.busy=false}
}
props.tab.save=upload;onBeforeUnmount(()=>{props.tab.save=undefined});onMounted(()=>load());
</script>
<template>
<section class="purchase-page">
<header class="heading"><div><small>組織與門市 / 員工購物</small><h1>員工購物管理</h1><p class="muted" data-page-intro>匯入 POS 每月員工購物銷售資料，依當月人員快照統計不同職稱的購物金額。</p></div><div class="actions"><button :disabled="loading||tab.busy" @click="load()">重新整理</button><button v-if="data?.capabilities.import" class="primary" :disabled="loading||tab.busy" @click="openImport">匯入 POS Excel</button></div></header>
<p v-if="error" role="alert" class="notice error">{{error}}</p><p v-if="message" role="status" class="notice">{{message}}</p><details v-if="warnings.length"><summary>匯入警告（{{warnings.length}}）</summary><ul><li v-for="(w,i) in warnings" :key="i">{{w}}</li></ul></details>
<form class="filters" @submit.prevent="load(position,month)"><label>月份<input v-model="month" type="month" required :disabled="loading||tab.busy" @change="monthChanged" /></label><button class="primary" :disabled="loading||tab.busy">查詢員購</button><span v-if="loadedMonth">顯示 {{loadedMonth}} · {{position||'全部職稱'}}</span></form>
<p v-if="loading" role="status">載入中…</p>
<template v-if="data">
<div class="totals"><div>購物總金額<strong>{{money(data.total_amount)}}</strong></div><div>明細筆數<strong>{{money(data.total_count)}}</strong></div><div>已比對／未比對<strong>{{money(data.matched_count)}} / {{money(data.unmatched_count)}}</strong></div></div>
<p class="muted" v-if="data.latest_batch">最後匯入：{{data.latest_batch.file_name}} · {{fmt(data.latest_batch.imported_at)}} · {{data.latest_batch.row_count}} 筆</p><p v-else class="muted">此月份尚無匯入紀錄</p>
<section class="position-section"><div class="section-title"><h2>職稱金額彙總</h2><label>職稱<select aria-label="職稱篩選" :value="position" :disabled="loading||tab.busy" @change="load(($event.target as HTMLSelectElement).value,loadedMonth)"><option value="">全部職稱</option><option v-for="p in data.positions" :key="p">{{p}}</option></select></label></div>
<div class="position-grid"><button :aria-pressed="!position" :disabled="loading||tab.busy" @click="load('',loadedMonth)">全部職稱<strong>{{money(data.summary_by_position.reduce((s:number,r:any)=>s+Number(r.total_amount),0))}}</strong></button><button v-for="s in data.summary_by_position" :key="s.position" :aria-pressed="position===s.position" :disabled="loading||tab.busy" @click="load(togglePosition(position,s.position),loadedMonth)">{{s.position}}<strong>{{money(s.total_amount)}}</strong><small>{{s.employee_count}} 人 · {{s.sales_count}} 筆 · 數量 {{decimal(s.total_quantity)}} · 毛利 {{money(s.gross_profit)}}</small></button></div>
<p v-if="!data.summary_by_position.length&&!loading">尚無此月份員工購物資料</p></section>
<div class="section-title"><h2>員工消費彙總</h2><button :aria-expanded="!collapsed" @click="collapsed=!collapsed">{{collapsed?'展開彙總':'收合彙總'}}</button></div>
<div v-show="!collapsed"><div class="filters"><label>搜尋員工或門市<input v-model="search" type="search" placeholder="員工代號、姓名或認列門市" /></label><span>符合 {{rows.length}} 位</span></div>
<div class="module-table"><table><thead><tr><th v-for="[key,label] in columns" :key="key" :aria-sort="sortKey===key&&direction?(direction===1?'ascending':'descending'):'none'"><button class="sort" @click="sort(key)">{{label}} {{sortKey===key&&direction?(direction===1?'↑':'↓'):'↕'}}</button></th><th>操作</th></tr></thead><tbody><tr v-for="r in visible" :key="r.id"><td>{{r.recognized_store_code}} {{r.recognized_store_name||'未認列門市'}}</td><td>{{r.employee_code||'—'}}</td><td>{{r.employee_name||'未比對員工'}}</td><td>{{r.employee_position||'未比對職稱'}}</td><td>{{money(r.purchase_count)}}</td><td>{{money(r.total_amount)}}</td><td><button :disabled="loading||(!r.employee_code&&!r.employee_name)" @click="showDetail(r)">查看明細</button></td></tr><tr v-if="!rows.length"><td colspan="7">沒有符合條件的員工資料</td></tr></tbody></table></div>
<footer class="actions pager"><span>第 {{page}} / {{pages}} 頁</span><button :disabled="page<=1" @click="page--">上一頁</button><button :disabled="page>=pages" @click="page++">下一頁</button></footer></div>
</template>
</section>
<Modal v-if="selected" :title="(selected.employee_name||selected.employee_code)+' · 購物明細'" wide @cancel="selected=null"><p>{{loadedMonth}} · {{selected.employee_code}} · {{selected.recognized_store_code}} {{selected.recognized_store_name}}</p><p v-if="detailLoading" role="status">載入中…</p><div v-if="detailError" role="alert" class="notice error">{{detailError}} <button @click="showDetail(selected)">重試</button></div><template v-if="detail"><p class="detail-total" data-detail-totals>購買筆數 {{money(totals.purchaseCount)}} · 數量加總 {{decimal(totals.quantity)}} · 金額加總 {{money(totals.totalAmount)}} · 毛利加總 {{money(totals.grossProfit)}}</p><div class="module-table"><table><thead><tr><th>購物門市</th><th>品號</th><th>品名</th><th>筆數</th><th>數量</th><th>毛利</th><th>金額</th></tr></thead><tbody><tr v-for="(r,i) in detail.details" :key="i"><td>{{r.purchase_store_code}} {{r.purchase_store_name}}</td><td>{{r.product_code}}</td><td>{{r.product_name}}</td><td>{{r.purchase_count}}</td><td>{{decimal(r.quantity)}}</td><td>{{money(r.gross_profit)}}</td><td>{{money(r.total_amount)}}</td></tr><tr v-if="!detail.details.length"><td colspan="7">沒有此員工的購物明細</td></tr></tbody></table></div><small>沿用舊版查詢範圍：每個員工識別欄位最多讀取 5,000 筆原始明細。</small></template><footer class="actions"><button @click="selected=null">關閉</button></footer></Modal>
<Modal v-if="importing" title="匯入 POS Excel" :busy="tab.busy" @cancel="closeImport"><p>POS 檔第一列會視為無效列（GridBand1），第二列需包含門市代號、銷售日期、銷售序號、會員編號、會員名稱、品號、品名、數量、總金額等欄位。系統會依銷售日期自動判定匯入月份。</p><p class="notice">系統依檔案的銷售日期判定月份，會覆蓋該月份全部門市的員購資料，與目前查詢月份無關。跨月份檔案須先拆分。</p><p v-if="importError" role="alert" class="notice error">{{importError}}</p><form @submit.prevent="upload"><label>POS Excel 檔案<input type="file" accept=".xlsx,.xls" :disabled="tab.busy" @change="choose" /></label><p v-if="file">已選：{{file.name}}</p><label class="check"><input v-model="confirmed" type="checkbox" :disabled="tab.busy" />我確認以此檔案覆蓋銷售月份的整月資料</label><footer class="actions"><button type="button" :disabled="tab.busy" @click="closeImport">取消</button><button class="primary" :disabled="!file||!confirmed||tab.busy">{{tab.busy?'匯入中…':'匯入並覆蓋銷售月份資料'}}</button></footer></form></Modal>
<Modal v-if="discard" title="放棄尚未匯入的檔案？" @cancel="discard=false"><p>檔案尚未匯入，關閉後需重新選取。</p><footer class="actions"><button @click="discard=false">繼續匯入</button><button class="danger" @click="file=null;discard=false;importing=false">放棄檔案</button></footer></Modal>
</template>
<style scoped>
.purchase-page{max-width:1700px;margin:auto}h1{font-size:26px;margin:10px 0 24px}h2{font-size:18px;margin:0}.heading,.section-title,.actions,.filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.heading,.section-title{justify-content:space-between}.filters{margin:22px 0;align-items:end}label{display:flex;flex-direction:column;gap:7px}input,select{padding:10px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink)}small,.muted{color:var(--muted)}.totals{display:flex;gap:42px;flex-wrap:wrap;padding:20px 0;border-block:1px solid var(--line)}strong{display:block;color:var(--primary);font-size:20px;margin-top:8px}.position-section{margin:28px 0}.position-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:16px}.position-grid button{text-align:left;background:var(--surface);border:1px solid var(--line);padding:16px}.position-grid button[aria-pressed=true]{border:2px solid var(--primary);background:var(--soft)}.position-grid small{display:block;margin-top:10px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{background:var(--soft)}.sort{background:transparent;border:0;padding:0;color:inherit}.notice{padding:14px;background:var(--soft);border-left:3px solid var(--primary);white-space:pre-line}.error,.danger{color:#a32a23}.pager{margin-top:16px}.pager span{margin-right:auto}footer.actions{justify-content:flex-end;margin-top:20px}.check{flex-direction:row;align-items:center;margin:20px 0}.check input{width:18px;height:18px;min-height:18px;flex:0 0 18px;padding:0}.detail-total{font-weight:bold}@media(max-width:760px){.filters label{width:100%}.totals{gap:20px}.position-grid{grid-template-columns:1fr}.heading .actions{width:100%}}
</style>
