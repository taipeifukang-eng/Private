<script setup lang="ts">
import { ref } from "vue";
// M4 追加要求：問題照片連續拍照，與舊版 app/inspection/new/page.tsx 一致。
//  - 大的「拍照」按鈕（手機 96×96），點下去直接開後鏡頭（accept=image/* + capture=environment）。
//  - 拍完立即顯示縮圖、輸入欄位重置，按鈕留在原位可馬上再拍，到 5 張為止。
//  - 壓縮（長邊 800px）在背景依序處理，不鎖按鈕，快速連拍不遺失任何一張。
const MAX = 5;
const props = defineProps<{ photos: string[]; name: string }>();
const emit = defineEmits<{
  add: [dataUrl: string];
  remove: [index: number];
  error: [message: string];
}>();
const processing = ref(0);
let chain: Promise<void> = Promise.resolve();
// 已排入處理（尚未加入）的張數，避免快速連拍超過 5 張。
let queued = 0;
async function compress(file: File): Promise<string> {
  if (file.type && !file.type.startsWith("image/"))
    throw new Error("請選擇圖片檔");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const url = c.toDataURL("image/jpeg", 0.7);
  if (url.length > 1_400_000) throw new Error("單張照片過大，請重新拍攝");
  return url;
}
function onChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = ""; // 立即重置，下一次拍照才會再觸發 change
  for (const file of files) {
    if (props.photos.length + queued >= MAX) {
      emit("error", "每個項目最多 5 張照片");
      break;
    }
    queued++;
    processing.value++;
    chain = chain.then(async () => {
      try {
        emit("add", await compress(file));
      } catch (e) {
        emit("error", (e as Error).message || "照片處理失敗，請重新拍攝");
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
        <img :src="url" :alt="name + '照片' + (i + 1)" />
        <button
          type="button"
          class="photo-remove"
          :aria-label="`刪除照片 ${i + 1}`"
          @click="emit('remove', i)"
        >
          ×
        </button>
      </figure>
      <label v-if="photos.length < MAX" class="photo-capture-button">
        <span aria-hidden="true">📷</span><span>拍照</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          class="photo-capture-input"
          :aria-label="name + '拍照'"
          data-testid="photo-capture-input"
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
    <p v-else-if="!photos.length" class="muted">點擊拍照按鈕直接開啟相機</p>
  </div>
</template>
