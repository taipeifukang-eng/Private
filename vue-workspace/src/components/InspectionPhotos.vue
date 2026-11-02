<script setup lang="ts">
import {computed,ref,watch} from 'vue';
const props=defineProps<{urls?:string[];label:string;printMode?:boolean}>();defineEmits<{preview:[url:string]}>();
const failed=ref<number[]>([]);watch(()=>props.urls,()=>{failed.value=[];});
const photos=computed(()=>(Array.isArray(props.urls)?props.urls:[]).map(url=>{
 if(typeof url!=='string')return null;
 if(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(url))return url;
 try{return new URL(url).protocol==='https:'?url:null;}catch{return null;}
}));
</script>
<template><div v-if="photos.length" class="finding-photos"><figure v-for="(url,i) in photos" :key="i"><template v-if="printMode && url"><img class="print-photo" :src="url" :alt="`${label} ${i+1}`" @error="failed.push(i)"><span v-if="failed.includes(i)" role="status">照片 {{i+1}} 無法顯示</span></template><button v-else-if="url&&!failed.includes(i)" type="button" class="photo-thumbnail" :aria-label="`放大${label} ${i+1}`" @click="$emit('preview',url)"><img :src="url" :alt="`${label} ${i+1}`" loading="lazy" @error="failed.push(i)"><span>放大檢視</span></button><div v-else class="photo-unavailable" role="status">照片 {{i+1}} 無法顯示</div><figcaption>{{label}} {{i+1}}</figcaption></figure></div><p v-else class="no-photos">未附{{label}}</p></template>
<style scoped>
.print-photo{display:block;width:100%;height:180px;object-fit:contain}.finding-photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;align-content:start}.finding-photos figure{margin:0;min-width:0}.photo-thumbnail{width:100%;padding:0;overflow:hidden;position:relative;border:1px solid var(--line);background:var(--surface);display:block}.photo-thumbnail img{display:block;width:100%;height:180px;object-fit:contain}.photo-thumbnail span{display:block;padding:5px;font-size:11px;color:var(--muted)}figcaption{font-size:11px;color:var(--muted);padding-top:4px}.no-photos,.photo-unavailable{margin:0;padding:24px 14px;background:var(--surface);border:1px dashed var(--line);color:var(--muted);font-size:13px;text-align:center}.photo-unavailable{min-height:180px;display:grid;place-items:center}@media(max-width:700px){.photo-thumbnail img{height:160px}}
@media print{.finding-photos figure{break-inside:avoid}.print-photo{height:38mm}.no-photos{padding:10px}}
</style>
