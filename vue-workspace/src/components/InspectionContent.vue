<script setup lang="ts">
import {computed} from 'vue';
import InspectionFinding from './InspectionFinding.vue';
import InspectionPhotos from './InspectionPhotos.vue';
const props=defineProps<{data:any;printMode?:boolean;canReport?:boolean}>();
defineEmits<{preview:[url:string];report:[id:string]}>();
const data=computed(()=>props.data);
const related = (r: any) => (data.value?.improvements || []).filter((i: any) => i.inspection_result_id ? i.inspection_result_id === r.id : i.template_id && i.template_id === r.template_id);
const needsAttention = (r: any) => Number(r.deduction_amount) > 0 || (r.given_score != null && r.max_score != null && Number(r.given_score) < Number(r.max_score)) || r.is_improvement || related(r).length > 0;
const findings = computed(() => (data.value?.results || []).filter(needsAttention));
const otherResults = computed(() => (data.value?.results || []).filter((r: any) => !needsAttention(r)));
const orphanImprovements = computed(() => (data.value?.improvements || []).filter((i: any) => !(data.value?.results || []).some((r: any) => related(r).includes(i))));
const orphanResult = (i: any) => ({id: 'improvement-' + i.id, template: {section_name:i.section_name,item_name:i.item_name}, notes:i.issue_description, photo_urls:i.issue_photo_urls,deduction_amount:i.deduction_amount,is_improvement:true});
const unscored = computed(() => otherResults.value.filter((r: any) => r.given_score == null).length);
const gpsLink = computed(() => {
  const record = data.value?.record;
  const latitude = record?.gps_latitude;
  const longitude = record?.gps_longitude;
  if (latitude == null || longitude == null || String(latitude).trim() === '' || String(longitude).trim() === '') return null;
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { url: `https://www.google.com/maps?q=${lat},${lng}`, label: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
});

const status=computed(()=>({draft:'草稿',in_progress:'進行中',completed:'已完成',closed:'已結案'} as Record<string,string>)[data.value.record.status] || data.value.record.status || '未提供');
</script>
<template>
<div class="inspection-content" :class="{'print-content':printMode}">
<section class="record-section" aria-label="巡店基本資料">
<dl class="record-meta">
<div><dt>巡店單號</dt><dd>{{data.record.inspection_no || '未提供'}}</dd></div>
<div><dt>巡店門市</dt><dd>{{data.store?.store_code}} {{data.store?.store_name || '未提供'}}</dd></div>
<div><dt>巡店日期</dt><dd>{{data.record.inspection_date || '未提供'}}</dd></div>
<div><dt>{{data.record.inspection_type==='manager'?'經理人員':'督導人員'}}</dt><dd>{{data.inspector || '未提供'}}</dd></div>
<div><dt>狀態</dt><dd>{{status}}</dd></div>
<div><dt>GPS 定位</dt><dd><a v-if="gpsLink" :href="gpsLink.url" target="_blank" rel="noopener noreferrer" :aria-label="`${gpsLink.label}，另開 Google Maps`">{{gpsLink.label}} ↗ Google Maps</a><span v-else>無有效定位座標</span><small v-if="data.record.gps_timestamp">{{data.record.gps_timestamp}}</small></dd></div>
</dl>
<div class="inspection-summary"><strong>得分 {{data.record.total_score ?? '—'}} / {{data.record.max_possible_score ?? '—'}}</strong><span>評級 {{data.record.grade || '—'}}</span><span v-if="data.improvements?.length">改善回補 {{data.record.improvement_bonus || 0}} 分</span></div>
</section>
<section class="record-section" aria-label="室內溫度"><h2>室內溫度</h2><p>{{data.record.indoor_temperature ?? '未記錄'}}<span v-if="data.record.indoor_temperature != null"> °C</span></p></section>
<section class="record-section" aria-label="當班人員資訊"><h2>當班人員資訊</h2><div v-if="data.staff?.length" class="staff-table"><table><thead><tr><th>員編</th><th>姓名</th><th>職位</th><th>當班主管</th></tr></thead><tbody><tr v-for="(person,i) in data.staff" :key="i"><td>{{person.employee_code || '—'}}</td><td>{{person.employee_name || '—'}}</td><td>{{person.position || '—'}}</td><td>{{person.is_duty_supervisor?'是':'—'}}</td></tr></tbody></table></div><p v-else class="muted">未記錄當班人員</p></section>
<section class="record-section findings-section" aria-label="需改善項目"><h2>需改善項目（{{findings.length + orphanImprovements.length}} 項）</h2>
<InspectionFinding v-for="r in findings" :key="r.id" :result="r" :improvements="related(r)" :can-report="!!canReport && !printMode" :print-mode="printMode" @preview="$emit('preview',$event)" @report="$emit('report',$event)" />
<InspectionFinding v-for="i in orphanImprovements" :key="i.id" :result="orphanResult(i)" :improvements="[i]" :can-report="!!canReport && !printMode" :print-mode="printMode" @preview="$emit('preview',$event)" @report="$emit('report',$event)" />
<p v-if="!findings.length && !orphanImprovements.length">{{data.results.length?'目前沒有扣分或標記需改善的項目。':'此巡店記錄尚無檢查明細。'}}</p><p v-if="unscored" class="muted">另有 {{unscored}} 項未評分。</p>
    <details v-if="otherResults.length && !printMode" class="inspection-secondary">
      <summary>其他檢查項目（{{ otherResults.length }}） · 未扣分 {{ otherResults.length - unscored }} 項<span v-if="unscored">、未評分 {{ unscored }} 項</span></summary>
      <details v-for="r in otherResults" :key="r.id" class="inspection-other-item">
        <summary>{{ r.template?.section_name }} / {{ r.template?.item_name || '檢查項目' }} · {{ r.given_score == null ? '未評分' : `${r.given_score} / ${r.max_score}` }}</summary>
        <p v-if="r.template?.item_description" class="muted">{{ r.template.item_description }}</p>
        <p v-if="r.notes" class="inspection-remarks">{{ r.notes }}</p>
        <p v-for="item in r.selected_items || []" :key="item">{{ item }}<span v-if="r.workspace_quantities?.[item] > 1"> × {{ r.workspace_quantities[item] }}</span></p>
        <InspectionPhotos v-if="r.photo_urls?.length" :urls="r.photo_urls" label="檢查照片" @preview="$emit('preview',$event)" />
      </details>
    </details>

</section>
<section class="record-section" aria-label="簽名確認"><h2>簽名確認</h2><div class="signature-grid"><div><h3>店長／當班主管簽名</h3><InspectionPhotos :urls="data.record.signature_photo_url?[data.record.signature_photo_url]:[]" label="店長／當班主管簽名" :print-mode="printMode" @preview="$emit('preview',$event)" /></div><div><h3>巡店人員簽名</h3><InspectionPhotos :urls="data.record.supervisor_signature_url?[data.record.supervisor_signature_url]:[]" label="巡店人員簽名" :print-mode="printMode" @preview="$emit('preview',$event)" /></div></div></section>
<section class="record-section" aria-label="備註說明"><h2>備註說明</h2><p class="inspection-remarks">{{data.record.supervisor_notes || '無備註說明'}}</p></section>
</div>
</template>
<style scoped>
.inspection-content{max-width:1100px}.record-section{padding:18px 0;border-bottom:1px solid var(--line,#ccc)}.record-section h2{font-size:18px;margin:0 0 14px}.record-section h3{font-size:14px}.record-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0 0 20px}.record-meta dt{font-size:12px;color:var(--muted,#555);margin-bottom:6px}.record-meta dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.record-meta dd small{display:block;color:var(--muted,#555)}.record-meta a{text-decoration:underline}.inspection-summary{border-bottom:0;display:flex;flex-wrap:wrap;gap:12px 24px;font-size:13px}.inspection-remarks{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.staff-table table{min-width:0;width:100%;border-collapse:collapse;table-layout:fixed}.staff-table td,.staff-table th{text-align:left;padding:10px;border-bottom:1px solid var(--line,#ccc);overflow-wrap:anywhere;white-space:normal}.staff-table th{font-size:12px;color:var(--muted,#555)}.inspection-secondary{padding:18px 0}.inspection-secondary summary{cursor:pointer}.inspection-other-item{padding:12px}.print-content{max-width:none}.print-content .record-meta{grid-template-columns:repeat(3,minmax(0,1fr))}@media(max-width:700px){.record-meta,.print-content .record-meta{grid-template-columns:1fr 1fr;gap:16px}.signature-grid{grid-template-columns:1fr}.staff-table td,.staff-table th{padding:6px;font-size:12px}}@media print{.print-content .record-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.record-section{padding:10px 0}.signature-grid{grid-template-columns:1fr 1fr;break-inside:avoid}.record-meta{break-inside:avoid}.record-section h2{font-size:14pt;break-after:avoid}.record-section p{orphans:3;widows:3}}
</style>
