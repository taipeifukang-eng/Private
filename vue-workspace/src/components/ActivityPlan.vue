<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Modal from './Modal.vue';
import ActivityCalendar from './ActivityCalendar.vue';
import ActivityOverview from './ActivityOverview.vue';
import ActivityImagePreview from './ActivityImagePreview.vue';
import ActivityStoreFill from './ActivityStoreFill.vue';
import ActivitySupportAssign from './ActivitySupportAssign.vue';
import type { WorkTab } from '../stores';
import { pdfExportBlocked, scheduledManaged } from '../../../lib/workspace/activity-view-rules';
// W20：viewer 是伺服器依舊版規則（Q7）算好的管轄門市與按鈕條件；tab 用來回報填報中的未儲存狀態。
const props = defineProps<{ data: any; store: string; backLabel?:string; viewer?:any; tab?:WorkTab; totalStores?:number; focus?:string }>();
const emit = defineEmits<{ back: []; retry: [] }>();
const onlyStore = ref(false), selected = ref('');
const detailHeading = ref<HTMLElement>();
const overview=ref(''),department=ref(''),list=ref(false);
const peopleTabId='activity-people-'+crypto.randomUUID();
const peopleTabs=[{key:'staff',label:'人員配置'},{key:'support',label:'支援請求／分配'}];
function peopleKey(e:KeyboardEvent){
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();overview.value=e.key==='Home'?'staff':e.key==='End'?'support':overview.value==='staff'?'support':'staff';
 (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>('[data-key="'+overview.value+'"]')?.focus();
}
const calendarHost=ref<HTMLElement>(),exporting=ref(false),exportError=ref('');
async function exportCalendar(){
 if(!calendarHost.value||exporting.value)return;
 exporting.value=true;exportError.value='';
 try{const {exportActivityCalendar}=await import('../activity-calendar-pdf');await exportActivityCalendar(calendarHost.value,props.data.campaign.name,subtitle.value);}
 catch{exportError.value='排程 PDF 匯出失敗，請稍後重試。';}finally{exporting.value=false;}
}
function selectStore(id:string) { selected.value=id; }
const localTab=reactive({dirty:false,busy:false,submitOnly:false}) as unknown as WorkTab;
const workTab=computed(()=>props.tab||localTab);
const allScheduledIds=computed(()=>Array.from(new Set<string>(props.data.schedules.map((s:any)=>s.store_id))));
const subtitle=computed(()=>'活動期間：'+props.data.campaign.start_date+' ~ '+props.data.campaign.end_date+(props.totalStores!=null?'　|　總門市數：'+props.totalStores+' 間':'')+'　|　已排程：'+allScheduledIds.value.length+' 間');
// Q7（照舊版）：人力查看與 Check List 只列自己管轄、且有排程的門市。
const managed=computed(()=>props.viewer?.managedStores||[]);
const managedScheduled=computed(()=>scheduledManaged(managed.value,allScheduledIds.value));
const managedIds=computed(()=>managedScheduled.value.map((s:any)=>s.id));
const checklistBadge=computed(()=>{const items=plan.value.checklist||[];if(!items.length)return 0;let n=0;for(const st of managedScheduled.value)for(const it of items)if(!(plan.value.completions||[]).some((c:any)=>c.store_id===st.id&&c.checklist_item_id===it.id&&c.is_completed))n++;return n;});
const supportOpen=ref(false),filling=ref<{store:any;kind:string}|null>(null);
const fillPermissions=computed(()=>({details:false,requests:false,ownStaff:!!props.viewer?.canViewStaffOverview,headcount:!!props.viewer?.canViewStaffOverview,supportStaff:!!props.viewer?.canAssignSupport,completions:true}));
function fillStore(id:string,kind:string){const store=managed.value.find((s:any)=>s.id===id);if(store)filling.value={store,kind};}
function fillClosed(){filling.value=null;emit('retry');}
onMounted(()=>{if(props.focus==='marketing'||props.focus==='merchandise')department.value=props.focus;});
const scheduledCount=computed(()=>new Set(schedules.value.map((s:any)=>s.store_id)).size);
const plan = computed(() => props.data.plan || {});
const pdfBlocked = computed(() => pdfExportBlocked(plan.value.errors));
const schedules = computed(() => [...props.data.schedules].filter(s => !onlyStore.value || s.store_id === props.store).sort((a,b) => a.activity_date.localeCompare(b.activity_date) || (a.store?.store_code || '').localeCompare(b.store?.store_code || '')));
const rows = (key: string) => (plan.value[key] || []).filter((r:any) => r.store_id === selected.value);
const detail = computed(() => rows('details')[0] || {});
const counts = computed(() => rows('headcount')[0]);
const support = computed(() => (plan.value.requests || []).filter((r:any) => r.requesting_store_id === selected.value));
const assigned = (id:string) => (plan.value.supportStaff || []).filter((r:any) => r.support_request_id === id);
const completion = (id:string) => rows('completions').find((r:any) => r.checklist_item_id === id) || {};
const storeName = computed(() => props.data.schedules.find((s:any) => s.store_id === selected.value)?.store);
const groups = computed(() => props.data.campaign.campaign_type === 'inventory' ? [
  { title:'盤點配置', fields:[['has_external_inventory_company','外盤公司'],['planned_inventory_time','預計盤點時間'],['inventory_staff','盤點組人員']] },
] : [
  { title:'外場與檢測', fields:[['outdoor_vendor','外場廠商'],['red_bean_cake','紅豆餅／雞蛋糕'],['circulation','循環'],['quantum','量子'],['bone_density','骨密']] },
  { title:'活動人員配置', fields:[['supervisor','督導'],['manager','經理'],['tasting','試飲'],['activity_team','活動組'],...Array.from({length:6},(_,i)=>['sales'+(i+1),'業務 '+(i+1)]),['indoor_pt1','內場工讀 1（09–13）'],['indoor_pt2','內場工讀 2（09–13）']] },
]);
const labels:Record<string,string> = {details:'門市配置',ownStaff:'本店人員',requests:'支援需求',supportStaff:'支援指派',headcount:'預估人數',checklist:'工作清單',completions:'完成情形',trips:'設備車次',departments:'部門規劃',stores:'督導資訊',events:'特殊日期'};
const dept = computed(() => plan.value.departments || {});
function array(value:any):string[] { if(Array.isArray(value)) return value; if(!value)return []; try { const p=JSON.parse(value);return Array.isArray(p)?p:[value]; } catch{return [value];} }
const images = computed(() => array(dept.value.marketing_image_urls).length ? array(dept.value.marketing_image_urls) : array(dept.value.marketing_image_data));
const imageNames = computed(() => array(dept.value.marketing_image_names || dept.value.marketing_image_name));
const safeImage = (url:string) => /^(https?:\/\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(url || '') ? url : '';
const gallery=ref<{items:{url:string;name:string}[];index:number}|null>(null);
const marketingImages=computed(()=>images.value.map((url,i)=>({url:safeImage(url),name:imageNames.value[i]||'行銷規劃圖 '+(i+1)})).filter(i=>i.url));
function openMarketing(index:number){gallery.value={items:marketingImages.value,index};}
function openMerchandise(){gallery.value={items:[{url:safeImage(dept.value.merchandise_gift_rules_data),name:dept.value.merchandise_gift_rules_name||'滿額贈規則圖表'}],index:0};}
const safeFile = (url:string) => /^(https?:\/\/|data:application\/[\w.+-]+;base64,)/i.test(url || '') ? url : '';
</script>
<template>
 <div class="activity-plan">
  <header class="plan-header"><div><h3>{{data.campaign.name}}</h3><p>{{data.campaign.start_date}}～{{data.campaign.end_date}} · {{data.campaign.campaign_type==='inventory'?'盤點活動':'促銷活動'}}</p><p v-if="totalStores!=null" data-testid="plan-counts">總門市數：{{totalStores}} 間 · 已排程：{{allScheduledIds.length}} 間</p></div><button @click="$emit('back')">{{backLabel||'返回活動清單'}}</button></header>
  <div v-if="Object.keys(plan.errors || {}).length" role="alert" class="notice error"><p v-for="(message,key) in plan.errors" :key="key">{{labels[key]}}：{{message}}</p><button @click="$emit('retry')">重新讀取規劃</button></div>
  <div class="plan-tools"><button v-if="viewer?.showSupport" data-testid="btn-support" @click="supportOpen=true">支援請求</button><button v-if="viewer?.showChecklist" class="badge-host" data-testid="btn-checklist" @click="overview='checklist'">前置 Check List<span v-if="checklistBadge>0" class="count-badge" data-testid="checklist-badge">{{checklistBadge>99?'99+':checklistBadge}}</span></button><button v-if="viewer?.showStaffOverview" data-testid="btn-staff" @click="overview='staff'">活動人力查看</button><button data-testid="btn-marketing" @click="department='marketing'">行銷部</button><button data-testid="btn-merchandise" @click="department='merchandise'">商品部</button><button data-testid="btn-export-pdf" :disabled="exporting||pdfBlocked" @click="exportCalendar">{{exporting?'匯出中…':'匯出排程 PDF'}}</button></div>
  <p v-if="exportError" role="alert">{{exportError}}</p><section class="schedule-section"><div class="schedule-heading"><h4>門市活動排程</h4><p>目前可見已排程 {{scheduledCount}} 間門市 · {{schedules.length}} 筆排程</p></div><div class="plan-tools"><label v-if="store" class="monthly-check"><input type="checkbox" v-model="onlyStore" @change="selected=''" />只顯示目前門市</label><button @click="list=!list">{{list?'顯示行事曆':'顯示門市日期總覽'}}</button></div>
   <div ref="calendarHost" v-show="!list"><ActivityCalendar :campaign="data.campaign" :schedules="schedules" :events="plan.events" :trips="plan.trips" @select="selectStore"/></div>
   <div v-show="list" class="module-table"><table><thead><tr><th>日期</th><th>門市代號</th><th>門市</th><th>督導</th><th>規劃結果</th></tr></thead><tbody><tr v-for="s in schedules" :key="s.id"><td>{{s.activity_date}}</td><td>{{s.store?.store_code}}</td><td>{{s.store?.store_name || '門市資料無法讀取'}}</td><td>{{s.store?.supervisor_name || '未指派督導'}}</td><td><button @click="selectStore(s.store_id)">查看門市規劃</button></td></tr></tbody></table></div><p v-if="!schedules.length">此範圍尚無活動排程。</p>
  </section>
  <Modal v-if="selected" :title="(storeName?.store_code||'')+' '+(storeName?.store_name||'門市')+' · 活動規劃'" wide @cancel="selected=''"><div class="activity-plan">
  <section v-if="selected" aria-label="門市規劃明細">
   <p>活動日期：{{data.schedules.find((s:any)=>s.store_id===selected)?.activity_date}} · 督導：{{storeName?.supervisor_name || '未指派督導'}}</p>
   <h4 ref="detailHeading" tabindex="-1">{{storeName?.store_code}} {{storeName?.store_name}} · 規劃明細</h4>
   <p v-if="plan.errors?.details" role="alert">門市配置：{{plan.errors.details}}</p><template v-if="!plan.errors?.details"><div v-for="g in groups" :key="g.title"><h5>{{g.title}}</h5><dl><div v-for="[key,label] in g.fields" :key="key"><dt>{{label}}</dt><dd>{{detail[key] || '尚未填寫'}}</dd></div></dl></div><p class="pre">備註：{{detail.notes || '無'}}</p></template>
   <h5>本店活動人員</h5><p v-if="plan.errors?.ownStaff">{{plan.errors.ownStaff}}</p><template v-else><div class="module-table"><table><thead><tr><th>員工代號</th><th>姓名</th><th>職位</th></tr></thead><tbody><tr v-for="r in rows('ownStaff')" :key="r.id"><td>{{r.employee_code}}</td><td>{{r.employee_name}}</td><td>{{r.position || '—'}}</td></tr></tbody></table></div><p v-if="!rows('ownStaff').length">尚未安排本店人員。</p></template>
   <h5>支援需求與指派人員</h5><p v-if="plan.errors?.requests || plan.errors?.supportStaff">支援資訊讀取不完整，請重試。</p><template v-else><div class="module-table"><table><thead><tr><th>支援門市</th><th>需求人數</th><th>已指派人員</th><th>備註</th></tr></thead><tbody><tr v-for="r in support" :key="r.id"><td>{{r.supporting_store?.store_code}} {{r.supporting_store?.store_name}}</td><td>{{r.requested_count}}</td><td><span v-for="s in assigned(r.id)" :key="s.id" class="staff">{{s.employee_code}} {{s.employee_name}} {{s.position}}</span><span v-if="!assigned(r.id).length">尚未指派</span></td><td>{{r.notes || '—'}}</td></tr></tbody></table></div><p v-if="!support.length">尚無支援需求。</p></template>
   <h5>人力預估</h5><p v-if="plan.errors?.headcount">{{plan.errors.headcount}}</p><p v-else-if="counts">本店 {{counts.own_staff_count}} 人／額外支援 {{counts.extra_support_count}} 人／督導 {{counts.supervisor_count}} 人／合計 {{counts.total}} 人<span v-if="counts.notes"> · {{counts.notes}}</span></p><p v-else>尚未設定人力預估。</p>
   <h5>前置工作清單</h5><p v-if="plan.errors?.checklist || plan.errors?.completions">清單或完成情形讀取失敗，請重試。</p><template v-else><div class="module-table"><table><thead><tr><th>事項</th><th>安排人員／期限</th><th>門市負責人</th><th>完成狀態</th><th>規劃備註／店長回報</th></tr></thead><tbody><tr v-for="r in plan.checklist" :key="r.id"><td>{{r.task_name}}</td><td>{{r.assigned_person || '—'}}／{{r.deadline || '未設定'}}</td><td>{{completion(r.id).store_assigned_person || '尚未指派'}}</td><td>{{completion(r.id).is_completed?'已完成':'未完成'}}<br>{{completion(r.id).completed_at?.slice(0,10)}}</td><td class="pre">{{r.notes || '—'}}<br>{{completion(r.id).manager_note || '尚無回報'}}</td></tr></tbody></table></div><p v-if="!plan.checklist?.length">尚無前置工作項目。</p></template>
  </section>
  <div class="dialog-actions"><button @click="selected=''">關閉門市規劃</button></div></div></Modal>
  <Modal v-if="overview" :title="overview==='checklist'?'前置 Check List':'活動人力查看'" wide @cancel="overview=''">
   <template v-if="overview==='staff'||overview==='support'">
    <div class="people-tabs" role="tablist" aria-label="活動人力分頁"><button v-for="t in peopleTabs" :key="t.key" :id="peopleTabId+'-'+t.key" role="tab" :data-key="t.key" :aria-selected="overview===t.key" :aria-controls="peopleTabId+'-panel-'+t.key" :tabindex="overview===t.key?0:-1" @click="overview=t.key" @keydown="peopleKey">{{t.label}}</button></div>
    <div v-for="t in peopleTabs" v-show="overview===t.key" :key="t.key" role="tabpanel" :id="peopleTabId+'-panel-'+t.key" :aria-labelledby="peopleTabId+'-'+t.key" tabindex="0"><ActivityOverview :kind="t.key" :data="data" :schedules="schedules" :only="t.key==='staff'?managedIds:null" :fillable="t.key==='staff'&&!!viewer?.canViewStaffOverview" @select="selectStore" @fill="id=>fillStore(id,'people')"/></div>
   </template>
   <ActivityOverview v-else kind="checklist" :data="data" :schedules="schedules" :only="managedIds" fillable @select="selectStore" @fill="id=>fillStore(id,'checklist')"/>
   <div class="dialog-actions"><button @click="overview=''">關閉總覽</button></div>
  </Modal>
  <Modal v-if="department" :title="department==='marketing'?'行銷部規劃':'商品部規劃'" wide @cancel="department=''"><div class="activity-plan"><p v-if="plan.errors?.departments" role="alert">{{plan.errors.departments}}</p>
  <section v-if="!plan.errors?.departments"><div v-if="department==='marketing'"><h4>行銷部規劃</h4><p class="pre">{{dept.marketing_content || '尚無行銷內容。'}}</p><p v-if="dept.marketing_rules" class="pre">{{dept.marketing_rules}}</p><div class="assets"><button v-for="(item,i) in marketingImages" :key="item.url" class="image-thumbnail" @click="openMarketing(i)" :aria-label="'預覽 '+item.name"><img :src="item.url" :alt="item.name" /><span>{{item.name}}</span></button></div>
   </div><div v-if="department==='merchandise'"><h4>商品部規劃</h4><p class="pre">{{dept.merchandise_supply_content || '尚無商品供應說明。'}}</p><button v-if="safeImage(dept.merchandise_gift_rules_data)" class="image-thumbnail" @click="openMerchandise" :aria-label="'預覽 '+(dept.merchandise_gift_rules_name||'滿額贈規則圖表')"><img class="gift-image" :src="safeImage(dept.merchandise_gift_rules_data)" :alt="dept.merchandise_gift_rules_name || '滿額贈規則圖表'" /></button><p v-if="safeFile(dept.merchandise_allocation_file_data)"><a :href="safeFile(dept.merchandise_allocation_file_data)" :download="dept.merchandise_allocation_file_name || '活動百貨配量.xlsx'" target="_blank" rel="noopener noreferrer">下載 {{dept.merchandise_allocation_file_name || '活動百貨配量'}}</a></p>
  </div></section><div class="dialog-actions"><button @click="department=''">關閉部門規劃</button></div></div></Modal>
 <Modal v-if="supportOpen" title="支援請求管理" wide @cancel="!workTab.busy&&!workTab.dirty&&(supportOpen=false)"><ActivitySupportAssign :campaign="data.campaign" :managed-stores="managed" :schedules="data.schedules" :can-assign="!!viewer?.canAssignSupport" :tab="workTab" @changed="$emit('retry')"/><div class="dialog-actions"><button :disabled="workTab.busy||workTab.dirty" @click="supportOpen=false">關閉支援請求</button></div></Modal>
 <ActivityStoreFill v-if="filling" :campaign="data.campaign" :store="filling.store" :initial="filling.kind" :sections="[filling.kind]" :permissions="fillPermissions" :tab="workTab" @close="fillClosed"/>
 <ActivityImagePreview v-if="gallery" :items="gallery.items" :initial-index="gallery.index" @close="gallery=null"/>
 </div>
</template>
<style scoped>
.badge-host{position:relative}.count-badge{position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.people-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line,#d9ddd2);margin:12px 0 20px;padding-bottom:8px;flex-wrap:wrap}.people-tabs [aria-selected="true"]{background:var(--accent,#526b40);color:white;border-color:var(--accent,#526b40)}
.plan-header,.schedule-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.plan-header h3{margin:0;font-size:17px}.plan-header p,.schedule-heading p{margin:6px 0;font-size:13px}.activity-plan .schedule-section{margin-top:12px;padding-top:4px}.plan-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
.activity-plan .monthly-check{display:flex;align-items:center;gap:8px;margin:12px 0}.activity-plan .monthly-check input{width:18px;height:18px;min-height:18px;margin:0}.activity-plan section{border-top:1px solid var(--border,#d9ddd2);margin-top:24px;padding-top:12px}.activity-plan h4{font-size:16px;margin:12px 0}.activity-plan h5{font-size:14px;margin:20px 0 10px}.activity-plan dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0}.activity-plan dt{color:var(--muted,#62705b);font-size:12px}.activity-plan dd{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.pre{white-space:pre-wrap;overflow-wrap:anywhere}.staff{display:block}.assets{display:flex;flex-wrap:wrap;gap:16px}.assets .image-thumbnail{max-width:220px}.image-thumbnail{padding:8px;max-width:100%;text-align:left}.image-thumbnail span{display:block;overflow-wrap:anywhere;margin-top:8px}.assets img,.gift-image{display:block;max-width:100%;max-height:360px;object-fit:contain}.activity-plan a{color:var(--accent,#526b40);text-decoration:underline}.activity-plan td{vertical-align:top}@media(max-width:650px){.activity-plan dl{grid-template-columns:1fr}.assets .image-thumbnail{max-width:100%}}
</style>
