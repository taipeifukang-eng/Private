<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { FileText, ImageIcon, X } from "lucide-vue-next";
import { formatBytes, prepareFile, releasePreview, UPLOAD_LIMITS, type PreparedFile } from "../lib/upload";

// 全站共用上傳選擇器（Q2）：選檔、檔案檢查、照片縮小、預覽。只負責「準備好要上傳的檔案」，實際傳送由呼叫端決定。
// 沿用 InspectionPhotoCapture／ImprovementPhotoUpload 的做法：原生 input 隱藏、中文按鈕、依序處理並通知父層忙碌狀態。
const props = withDefaults(
  defineProps<{ modelValue: PreparedFile[]; max?: number; disabled?: boolean; label?: string; imagesOnly?: boolean }>(),
  { max: UPLOAD_LIMITS.maxFilesPerRequest, label: "選擇檔案", imagesOnly: false },
);
const emit = defineEmits<{ "update:modelValue": [items: PreparedFile[]]; busy: [busy: boolean]; error: [message: string] }>();
const input = ref<HTMLInputElement>();
const processing = ref(0);
const errors = ref<string[]>([]);
const accept = props.imagesOnly
  ? "image/jpeg,image/png,image/webp,image/heic,image/heif"
  : "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
watch(processing, (n) => emit("busy", n > 0));
let chain: Promise<void> = Promise.resolve();
let queued = 0;
let current: PreparedFile[] = props.modelValue;
watch(() => props.modelValue, (v) => (current = v));

function onChange(event: Event) {
  const el = event.target as HTMLInputElement;
  const files = Array.from(el.files || []);
  el.value = "";
  errors.value = [];
  for (const file of files) {
    if (current.length + queued >= props.max) {
      errors.value.push(`最多一次上傳 ${props.max} 個檔案，其餘已略過`);
      break;
    }
    queued++;
    processing.value++;
    chain = chain.then(async () => {
      try {
        const result = await prepareFile(file);
        if (result.ok) {
          current = [...current, result.item];
          emit("update:modelValue", current);
        } else errors.value.push(result.message);
      } finally {
        queued--;
        processing.value--;
      }
    });
  }
  chain.then(() => errors.value.length && emit("error", errors.value[0]));
}
function remove(item: PreparedFile) {
  releasePreview(item);
  current = current.filter((i) => i.id !== item.id);
  emit("update:modelValue", current);
}
onBeforeUnmount(() => current.forEach(releasePreview));
</script>

<template>
  <div class="upload-picker">
    <div class="upload-actions">
      <button type="button" :disabled="disabled || modelValue.length >= max" @click="input?.click()">
        <ImageIcon :size="16" /> {{ label }}
      </button>
      <input ref="input" type="file" multiple :accept="accept" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="upload-input" @change="onChange" />
      <span class="muted">{{ imagesOnly ? "圖片" : "圖片與 PDF" }}；照片會自動縮小（長邊約 2000 像素），其他檔最大 4MB；一次最多 {{ max }} 個</span>
      <span v-if="processing" class="muted" role="status">處理中…</span>
    </div>
    <ul v-if="modelValue.length" class="upload-list" aria-label="待上傳的檔案">
      <li v-for="item in modelValue" :key="item.id">
        <img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.file.name" />
        <span v-else class="upload-icon"><FileText :size="22" /></span>
        <span class="upload-name"
          ><strong>{{ item.file.name }}</strong>
          <small>{{ formatBytes(item.file.size) }}<template v-if="item.shrunk">（已從 {{ formatBytes(item.originalSize) }} 縮小）</template></small></span
        >
        <button type="button" class="icon-button" :aria-label="'移除 ' + item.file.name" :disabled="disabled" @click="remove(item)"><X :size="15" /></button>
      </li>
    </ul>
    <p v-for="message in errors" :key="message" class="field-error" role="alert">{{ message }}</p>
  </div>
</template>

<style scoped>
.upload-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.upload-actions button { display: inline-flex; align-items: center; gap: 6px; }
.upload-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.upload-list li { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; background: var(--surface); }
.upload-list img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; }
.upload-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 4px; background: var(--soft); color: var(--muted); }
.upload-name { flex: 1; min-width: 0; }
.upload-name strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.upload-name small { display: block; color: var(--muted); }
</style>
