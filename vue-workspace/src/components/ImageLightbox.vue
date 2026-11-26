<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampIndex, clampZoom, keyAction, swipeDirection } from "../../../lib/clinic-selfpay/lightbox";

// 圖片檢視器（M6 W31）：鍵盤（←→ 換張、Esc 關閉、+/-/0 縮放、Home/End）、手機左右滑動換張、按鈕與滾輪縮放、雙擊放大／還原、縮圖列。
const props = defineProps<{ urls: string[]; start?: number; title?: string }>();
const emit = defineEmits<{ close: [] }>();
const index = ref(clampIndex(props.start ?? 0, props.urls.length));
const zoom = ref(1);
const failed = ref<Record<number, boolean>>({});
const root = ref<HTMLElement>();
let previous: HTMLElement | null = null;
let startX = 0, startY = 0, tracking = false;

const count = computed(() => props.urls.length);
const label = computed(() => props.title || "健保系統截圖");

function go(i: number) {
  index.value = clampIndex(i, count.value);
  zoom.value = 1;
}
function setZoom(z: number) {
  zoom.value = clampZoom(z);
}
function onKey(event: KeyboardEvent) {
  const action = keyAction(event.key);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "close") emit("close");
  else if (action === "next") go(index.value + 1);
  else if (action === "prev") go(index.value - 1);
  else if (action === "first") go(0);
  else if (action === "last") go(count.value - 1);
  else if (action === "zoom-in") setZoom(zoom.value + ZOOM_STEP);
  else if (action === "zoom-out") setZoom(zoom.value - ZOOM_STEP);
  else setZoom(1);
}
function onWheel(event: WheelEvent) {
  event.preventDefault();
  setZoom(zoom.value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}
function onPointerDown(event: PointerEvent) {
  tracking = event.pointerType === "touch";
  startX = event.clientX;
  startY = event.clientY;
}
function onPointerUp(event: PointerEvent) {
  if (!tracking) return;
  tracking = false;
  if (zoom.value > 1) return; // 放大時的手指移動是平移，不換張
  const dir = swipeDirection(event.clientX - startX, event.clientY - startY);
  if (dir === "next") go(index.value + 1);
  else if (dir === "prev") go(index.value - 1);
}
watch(() => props.urls, () => (index.value = clampIndex(index.value, props.urls.length)));
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  document.body.style.overflow = "hidden";
  await nextTick();
  root.value?.focus();
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  previous?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="lb" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1" data-testid="lightbox" @keydown="onKey" @click.self="emit('close')">
      <header class="bar">
        <span data-testid="lb-counter">第 {{ index + 1 }} 張 / 共 {{ count }} 張</span>
        <span class="tools">
          <button type="button" aria-label="縮小" :disabled="zoom <= ZOOM_MIN" data-testid="lb-zoom-out" @click="setZoom(zoom - ZOOM_STEP)">－</button>
          <button type="button" aria-label="還原大小" data-testid="lb-zoom-reset" @click="setZoom(1)">{{ Math.round(zoom * 100) }}%</button>
          <button type="button" aria-label="放大" :disabled="zoom >= ZOOM_MAX" data-testid="lb-zoom-in" @click="setZoom(zoom + ZOOM_STEP)">＋</button>
          <button type="button" aria-label="關閉" data-testid="lb-close" @click="emit('close')">✕</button>
        </span>
      </header>
      <div class="stage" @wheel="onWheel" @pointerdown="onPointerDown" @pointerup="onPointerUp" @pointercancel="tracking = false">
        <button type="button" class="nav prev" aria-label="上一張" :disabled="index === 0" data-testid="lb-prev" @click="go(index - 1)">‹</button>
        <div class="viewport" :class="{ zoomed: zoom > 1 }">
          <p v-if="failed[index]" role="alert" data-testid="lb-error">這張截圖載入失敗（連結可能已過期，請重新開啟明細）</p>
          <img
            v-else
            :src="urls[index]"
            :alt="`${label} ${index + 1}`"
            :style="{ transform: `scale(${zoom})` }"
            data-testid="lb-image"
            draggable="false"
            @dblclick="setZoom(zoom > 1 ? 1 : 2)"
            @error="failed[index] = true"
          />
        </div>
        <button type="button" class="nav next" aria-label="下一張" :disabled="index >= count - 1" data-testid="lb-next" @click="go(index + 1)">›</button>
      </div>
      <footer v-if="count > 1" class="thumbs">
        <button v-for="(u, i) in urls" :key="u" type="button" :class="{ on: i === index }" :aria-label="`看第 ${i + 1} 張`" :aria-current="i === index" data-testid="lb-thumb" @click="go(i)">
          <img :src="u" alt="" loading="lazy" />
        </button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.lb { position: fixed; inset: 0; z-index: 2000; background: rgba(0, 0, 0, 0.88); display: flex; flex-direction: column; color: #fff; outline: none; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
.tools { display: flex; gap: 6px; }
.lb button { background: rgba(255, 255, 255, 0.16); color: #fff; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 6px; min-width: 40px; min-height: 40px; cursor: pointer; font-size: 1rem; }
.lb button:disabled { opacity: 0.35; cursor: default; }
.lb button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.stage { flex: 1; min-height: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px; touch-action: pan-y; }
.nav { font-size: 1.8rem; flex: none; min-height: 64px; }
.viewport { flex: 1; min-width: 0; height: 100%; display: grid; place-items: center; overflow: auto; }
.viewport img { max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.12s; transform-origin: center; user-select: none; }
.viewport.zoomed img { cursor: grab; }
.thumbs { display: flex; gap: 8px; padding: 10px 14px; overflow-x: auto; justify-content: center; }
.thumbs button { padding: 0; width: 64px; min-width: 64px; height: 48px; overflow: hidden; opacity: 0.6; }
.thumbs button.on { opacity: 1; border-color: #fff; border-width: 2px; }
.thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (max-width: 640px) { .nav { min-width: 44px; min-height: 64px; font-size: 1.4rem; } }
</style>
