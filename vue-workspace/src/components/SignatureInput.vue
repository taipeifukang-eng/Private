<script setup lang="ts">
import { ref, nextTick } from "vue";
import Modal from "./Modal.vue";
const props = defineProps<{
  modelValue: string;
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const opened = ref(false),
  canvas = ref<HTMLCanvasElement | null>(null),
  drawing = ref(false),
  // M4 Q12：沒畫任何筆跡前，「確認簽名」是灰的（與舊版一致），空白圖片不能當作已簽名。
  hasInk = ref(false);
async function open() {
  opened.value = true;
  hasInk.value = false;
  await nextTick();
  const ctx = canvas.value?.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 800, 260);
  ctx.strokeStyle = "#172019";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  if (props.modelValue) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, 800, 260);
    img.src = props.modelValue;
    hasInk.value = true;
  }
}
function point(e: PointerEvent) {
  const c = canvas.value!,
    r = c.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * c.width) / r.width,
    y: ((e.clientY - r.top) * c.height) / r.height,
  };
}
function start(e: PointerEvent) {
  if (!canvas.value) return;
  canvas.value.setPointerCapture(e.pointerId);
  drawing.value = true;
  const p = point(e),
    ctx = canvas.value.getContext("2d")!;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}
function move(e: PointerEvent) {
  if (!drawing.value) return;
  const p = point(e),
    ctx = canvas.value!.getContext("2d")!;
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  hasInk.value = true;
}
function clear() {
  const ctx = canvas.value?.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 800, 260);
  }
  hasInk.value = false;
}
function confirm() {
  if (!hasInk.value) return;
  emit("update:modelValue", canvas.value!.toDataURL("image/png"));
  opened.value = false;
}
</script>
<template>
  <div class="signature-input">
    <strong>{{ label }}</strong
    ><img v-if="modelValue" :src="modelValue" :alt="label" />
    <div class="module-actions">
      <button type="button" @click="open" :disabled="disabled">
        {{ modelValue ? "重新簽名" : "開啟簽名板" }}</button
      ><button
        v-if="modelValue"
        type="button"
        @click="emit('update:modelValue', '')"
        :disabled="disabled"
      >
        移除簽名
      </button>
    </div>
    <Modal v-if="opened" :title="label" @cancel="opened = false"
      ><p>以滑鼠或手指簽名，確認後才會套用到巡店表單。</p>
      <canvas
        ref="canvas"
        width="800"
        height="260"
        :aria-label="label + '繪製區'"
        @pointerdown.prevent="start"
        @pointermove.prevent="move"
        @pointerup="drawing = false"
        @pointercancel="drawing = false"
      />
      <div class="dialog-actions">
        <button type="button" @click="opened = false">取消</button
        ><button type="button" @click="clear">清除重簽</button
        ><button
          type="button"
          class="primary"
          data-testid="signature-confirm"
          :disabled="!hasInk"
          @click="confirm"
        >
          確認簽名
        </button>
      </div></Modal
    >
  </div>
</template>
