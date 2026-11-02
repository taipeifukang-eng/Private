<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
const props = withDefaults(defineProps<{ label?: string }>(), {
  label: "表格",
});
const top = ref<HTMLDivElement>(),
  viewport = ref<HTMLDivElement>(),
  width = ref(0),
  overflow = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  const el = viewport.value;
  if (!el || !el.clientWidth) return;
  width.value = el.scrollWidth;
  overflow.value = el.scrollWidth > el.clientWidth + 1;
  if (top.value) top.value.scrollLeft = el.scrollLeft;
}
function sync(from: "top" | "table") {
  const source = from === "top" ? top.value : viewport.value,
    target = from === "top" ? viewport.value : top.value;
  if (source && target && Math.abs(source.scrollLeft - target.scrollLeft) > 0.5)
    target.scrollLeft = source.scrollLeft;
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (viewport.value) {
    observer.observe(viewport.value);
    for (const child of viewport.value.children) observer.observe(child);
  }
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div class="synced-table">
    <div v-show="overflow" class="top-scrollbar">
      <span class="muted">左右捲動{{ props.label }}</span>
      <div
        ref="top"
        class="scroll-track"
        tabindex="0"
        role="region"
        :aria-label="`${props.label}上方橫向捲軸`"
        @scroll.passive="sync('top')"
      >
        <div :style="{ width: width + 'px', height: '1px' }"></div>
      </div>
    </div>
    <div
      ref="viewport"
      class="module-table table-viewport"
      @scroll.passive="sync('table')"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>
.synced-table {
  min-width: 0;
  max-width: 100%;
  position: relative;
}
.top-scrollbar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--surface);
  border-block: 1px solid var(--line);
  padding-top: 6px;
}
.top-scrollbar > span {
  display: block;
  font-size: 12px;
  padding: 0 8px 4px;
}
.scroll-track {
  overflow-x: scroll;
  overflow-y: hidden;
  height: 20px;
  max-width: 100%;
}
.scroll-track::-webkit-scrollbar { height: 14px; }
.scroll-track::-webkit-scrollbar-track { background: var(--line); }
.scroll-track::-webkit-scrollbar-thumb { background: var(--muted); border: 2px solid var(--line); border-radius: 7px; }
.scroll-track:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.table-viewport {
  margin-top: 0;
}
</style>
