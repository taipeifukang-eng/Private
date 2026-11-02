<script setup lang="ts">
import {computed,ref} from 'vue';
import Modal from './Modal.vue';
const props=defineProps<{items:{url:string;name:string}[];initialIndex:number}>();
defineEmits<{close:[]}>();
const index=ref(Math.max(0,Math.min(props.initialIndex,props.items.length-1))),loading=ref(true),failed=ref(false),attempt=ref(0);
const current=computed(()=>props.items[index.value]);
function move(delta:number){if(props.items.length<2)return;index.value=(index.value+delta+props.items.length)%props.items.length;loading.value=true;failed.value=false;}
function retry(){failed.value=false;loading.value=true;attempt.value++;}
function key(e:KeyboardEvent){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}}
</script>
<template><Modal title="發布圖片預覽" wide @cancel="$emit('close')"><div class="image-preview" @keydown="key">
 <div class="image-controls"><div v-if="items.length>1" class="image-navigation"><button aria-label="上一張圖片" @click="move(-1)">上一張</button><button aria-label="下一張圖片" @click="move(1)">下一張</button></div><p role="status" aria-live="polite">{{index+1}} / {{items.length}} · {{current?.name}}</p><button @click="$emit('close')">關閉圖片預覽</button></div>
 <p v-if="loading" role="status">圖片載入中…</p><p v-if="failed" role="alert">圖片無法載入，請重試。<button @click="retry">重新載入圖片</button></p>
 <button v-if="current" class="preview-picture" :disabled="items.length<2" :aria-label="items.length>1?'點擊圖片查看下一張':'發布圖片'" @click="move(1)"><img :key="index+'-'+attempt" :src="current.url" :alt="current.name" @load="loading=false;failed=false" @error="loading=false;failed=true" /></button>
 <p v-if="items.length>1" class="image-hint">點擊圖片或使用左右方向鍵切換；最後一張會回到第一張。</p>
</div></Modal></template>
<style scoped>
.image-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between}.image-controls p{flex:1;min-width:120px;overflow-wrap:anywhere}.image-navigation{display:flex;gap:8px}.preview-picture{display:block;width:100%;padding:0;border:0;background:transparent;cursor:pointer}.preview-picture:disabled{opacity:1;cursor:default}.preview-picture img{display:block;max-width:100%;max-height:68vh;width:auto;height:auto;object-fit:contain;margin:auto}.image-hint{font-size:12px;color:var(--muted,#62705b)}@media(max-width:600px){.image-controls p{flex-basis:100%;order:3;margin:4px 0 12px}.preview-picture img{max-height:60vh}}
</style>
