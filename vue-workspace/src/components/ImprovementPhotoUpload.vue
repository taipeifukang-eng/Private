<script setup lang="ts">
import { ref, watch } from "vue";
// M4 F 節：改善回報「上傳改善照片」改為中文樣式按鈕（不出現瀏覽器原生的英文 Choose Files）。
// 風格與 InspectionPhotoCapture.vue 一致（共用 .photo-capture-* 樣式）：
//  - 大的「選擇照片」按鈕（原生 input 隱藏），可一次多選，到 5 張為止。
//  - 縮圖右上角 × 可刪除，點縮圖可放大。
//  - 與巡店拍照不同：這裡是從相簿／檔案挑選，所以不帶 capture 屬性；只收 JPEG、PNG、WebP。
//  - 壓縮（長邊 800px）依序處理，處理中通知父層（busy）避免此時送出。
const MAX = 5;
const props = defineProps<{ photos: string[] }>();
const emit = defineEmits<{
  add: [dataUrl: string];
  remove: [index: number];
  preview: [index: number];
  error: [message: string];
  select: [];
  busy: [busy: boolean];
}>();
const processing = ref(0);
watch(processing, (n) => emit("busy", n > 0));
let chain: Promise<void> = Promise.resolve();
let queued = 0;
async function compress(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("請選擇 JPEG、PNG 或 WebP 圖片");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const url = c.toDataURL("image/jpeg", 0.7);
  if (url.length > 1_400_000) throw new Error("單張照片過大，請換一張");
  return url;
}
function onChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  emit("select"); // 每次重新選檔先通知父層清掉上一次的錯誤訊息
  for (const file of files) {
    if (props.photos.length + queued >= MAX) {
      emit("error", "最多可上傳 5 張照片");
      break;
    }
    queued++;
    processing.value++;
    chain = chain.then(async () => {
      try {
        emit("add", await compress(file));
      } catch (e) {
        emit("error", (e as Error).message || "照片處理失敗，請換一張");
      } finally {
        queued--;
        processing.value--;
      }
    });
  }
}
</script>
<template>
  <div class="photo-capture" :data-photo-count="photos.length">
    <div class="photo-capture-grid">
      <figure v-for="(url, i) in photos" :key="i" class="photo-thumb">
        <img
          :src="url"
          :alt="'改善照片 ' + (i + 1)"
          class="photo-thumb-zoom"
          @click="emit('preview', i)"
        />
        <button
          type="button"
          class="photo-remove"
          :aria-label="`刪除改善照片 ${i + 1}`"
          @click="emit('remove', i)"
        >
          ×
        </button>
      </figure>
      <label v-if="photos.length < MAX" class="photo-capture-button">
        <span aria-hidden="true">＋</span><span>選擇照片</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          class="photo-capture-input"
          aria-label="上傳改善照片"
          data-testid="improvement-photo-input"
          @change="onChange"
        />
      </label>
    </div>
    <p v-if="processing" class="muted" role="status">
      照片處理中（{{ processing }}）…
    </p>
    <p v-if="photos.length >= MAX" class="muted photo-limit">
      ✓ 已達上傳上限（5張）
    </p>
    <p v-else-if="!photos.length" class="muted">
      點擊按鈕選擇照片，可一次選多張
    </p>
  </div>
</template>
