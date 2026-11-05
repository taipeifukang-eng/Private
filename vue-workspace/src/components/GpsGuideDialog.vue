<script setup lang="ts">
import { ref, computed } from "vue";
import Modal from "./Modal.vue";
import {
  GPS_GUIDE_TABS,
  GPS_LINE_BROWSER_NOTICE,
  detectGpsDevice,
  getDefaultGuideTab,
  getGpsFailureNote,
  isLineInAppBrowser,
  type GpsFailureKind,
  type GpsGuideTabId,
} from "../../../lib/inspection/gps-policy";
// 開啟定位教學：內容取自共用的 gps-policy（與舊版 GpsGuideDialog 文字一致）。
const props = defineProps<{
  failureKind?: GpsFailureKind | null;
  failureMessage?: string;
}>();
const emit = defineEmits<{ close: []; retry: [] }>();
const ua = navigator.userAgent,
  touch = { maxTouchPoints: navigator.maxTouchPoints };
const tab = ref<GpsGuideTabId>(getDefaultGuideTab(ua, touch));
const inLine = isLineInAppBrowser(ua);
const device = detectGpsDevice(ua, touch);
const note = computed(() =>
  getGpsFailureNote(
    props.failureKind,
    device === "ios" || device === "android",
  ),
);
const current = computed(
  () => GPS_GUIDE_TABS.find((t) => t.id === tab.value) || GPS_GUIDE_TABS[0],
);
</script>
<template>
  <Modal title="開啟定位教學" @cancel="emit('close')">
    <div class="gps-guide" data-testid="gps-guide-dialog">
      <p v-if="failureMessage" class="gps-guide-failure">
        {{ failureMessage }}
      </p>
      <p
        v-if="inLine"
        class="gps-guide-line"
        data-testid="gps-guide-line-notice"
      >
        {{ GPS_LINE_BROWSER_NOTICE }}
      </p>
      <p v-if="note" class="gps-guide-note" data-testid="gps-guide-note">
        {{ note }}
      </p>
      <div class="gps-guide-tabs" role="tablist">
        <button
          v-for="t in GPS_GUIDE_TABS"
          :key="t.id"
          type="button"
          role="tab"
          :aria-selected="t.id === tab"
          :class="{ active: t.id === tab }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <ol
        class="gps-guide-steps"
        :data-testid="`gps-guide-steps-${current.id}`"
      >
        <li v-for="(step, i) in current.steps" :key="i">
          <span class="gps-guide-no">{{ i + 1 }}</span
          ><span class="gps-guide-icon" aria-hidden="true">{{ step.icon }}</span
          ><span class="gps-guide-text">{{ step.text }}</span>
        </li>
      </ol>
    </div>
    <div class="dialog-actions">
      <button type="button" @click="emit('close')">關閉</button
      ><button
        type="button"
        class="primary"
        data-testid="gps-guide-retry"
        @click="emit('retry')"
      >
        我開好了，重新定位
      </button>
    </div>
  </Modal>
</template>
