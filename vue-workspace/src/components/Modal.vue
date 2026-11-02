<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
const props = defineProps<{ title: string; busy?: boolean; wide?: boolean }>();
const emit = defineEmits<{ cancel: [] }>();
const element = ref<HTMLDialogElement>();
const titleId = `dialog-${crypto.randomUUID()}`;
let previous: HTMLElement | null = null;
onMounted(() => {
  previous = document.activeElement as HTMLElement;
  element.value?.showModal();
});
onBeforeUnmount(() => {
  element.value?.close();
  previous?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><dialog
      ref="element"
      class="dialog"
      :style="wide ? { width: '1180px' } : undefined"
      :aria-labelledby="titleId"
      @cancel.prevent="!props.busy && emit('cancel')"
    >
      <h2 :id="titleId">{{ title }}</h2>
      <slot /></dialog
  ></Teleport>
</template>
