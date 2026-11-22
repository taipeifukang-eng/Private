<script setup lang="ts">
import {computed} from 'vue';
const props=defineProps<{campaign:any;schedules:any[];events?:any[];trips?:any[]}>();
defineEmits<{select:[id:string]}>();
const iso=(d:Date)=>d.toISOString().slice(0,10);
const months=computed(()=>{
 const start=new Date(props.campaign.start_date+'T00:00:00Z'),end=new Date(props.campaign.end_date+'T00:00:00Z');
 const out:{key:string;cells:(string|null)[]}[]=[];
 if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<start)return out;
 for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
  const date=iso(d),key=date.slice(0,7);let m=out[out.length-1];
  if(!m||m.key!==key){m={key,cells:Array((d.getUTCDay()+6)%7).fill(null)};out.push(m);}
  m.cells.push(date);
 }
 for(const m of out)while(m.cells.length%7)m.cells.push(null);
 return out;
});
const key=(s:any)=>s?.supervisor_code||s?.supervisor_id||'unassigned';
const palette=['#526b40','#326a8a','#875133','#775b8c','#29766f','#8a6630','#85516c'];
const supervisors=computed(()=>{const map=new Map<string,string>();for(const r of props.schedules)map.set(key(r.store),r.store?.supervisor_name||'未指派督導');return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([id,name],i)=>({id,name,color:palette[i%palette.length]}));});
const color=(s:any)=>supervisors.value.find(r=>r.id===key(s))?.color||'#62705b';
const byDay=computed(()=>{const map:Record<string,any[]>={};for(const s of props.schedules)(map[s.activity_date]||=[]).push(s);return map;});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
</script>
<template><div class="activity-calendar">
 <div class="legend" aria-label="督導圖例"><span>督導：</span><span v-for="s in supervisors" :key="s.id" :style="{'--supervisor':s.color}" class="legend-item">{{s.name}}</span></div>
 <p class="mobile-hint">行事曆可左右滑動；點選門市查看完整規劃。</p>
 <div v-for="m in months" :key="m.key" class="calendar-month"><h4>{{m.key.slice(0,4)}} 年 {{Number(m.key.slice(5))}} 月</h4><div class="calendar-scroll" tabindex="0" :aria-label="m.key+' 活動行事曆'"><div class="calendar-grid">
  <div v-for="day in ['一','二','三','四','五','六','日']" class="weekday">{{day}}</div>
  <div v-for="(date,i) in m.cells" :key="date||'blank'+i" class="day" :class="{blank:!date,today:date===today}" :data-date="date">
   <template v-if="date"><strong>{{Number(date.slice(8))}}<small v-if="date===today"> 今天</small></strong>
    <p v-for="e in (events||[]).filter(e=>e.event_date===date)" :key="e.id" class="event">{{e.description||'特殊日期'}}<small v-if="e.is_blocked"> · 禁止自動排程</small></p>
    <button v-for="s in byDay[date]||[]" :key="s.id||s.store_id" class="store-event" :style="{'--supervisor':color(s.store)}" :aria-label="date+' '+s.store?.store_code+' '+s.store?.store_name+' 查看門市規劃'" @click="$emit('select',s.store_id)"><b>{{s.store?.store_code}} {{s.store?.store_name||'門市資料無法讀取'}}</b><small>{{s.store?.supervisor_name||'未指派督導'}}</small></button>
    <p v-for="t in (trips||[]).filter(t=>t.trip_date===date)" :key="t.id" class="trip">設備第 {{t.set_number}} 套<br>{{t.from_location}} → {{t.to_location}}<small v-if="t.notes"><br>{{t.notes}}</small></p>
   </template>
  </div>
 </div></div></div>
</div></template>
<style scoped>
.legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.legend-item{border-left:5px solid var(--supervisor);padding:4px 8px;font-size:13px}.calendar-month{margin:20px 0}.calendar-month h4{padding:12px;background:var(--surface,#eef1e8);margin:0}.calendar-scroll{overflow-x:auto;max-width:100%}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:770px;gap:4px}.weekday{text-align:center;padding:10px}.day{border:1px solid var(--line,#d9ddd2);min-height:100px;padding:6px;overflow-wrap:anywhere}.blank{background:var(--surface,#eef1e8)}.today{border:2px solid var(--accent,#526b40)}.store-event{display:block;width:100%;margin-top:6px;text-align:left;padding:7px;border:1px solid var(--supervisor);border-left-width:4px;white-space:normal;line-height:1.5;min-height:44px;background:var(--surface,#fff)}.store-event small{display:block;color:var(--muted,#62705b)}.event{color:#9b342c;font-size:12px;margin:5px 0}.trip{font-size:12px;background:var(--surface,#eef1e8);border-top:1px dashed var(--line,#bbb);padding:6px;margin:6px 0}.day strong{font-size:14px}.mobile-hint{font-size:12px;color:var(--muted,#62705b)}
@media print{.calendar-grid{min-width:0}.calendar-month{break-before:page}.calendar-month:first-of-type{break-before:auto}.day{min-height:75px}.mobile-hint{display:none}.store-event{color:black}.calendar-scroll{overflow:visible}}
</style>
