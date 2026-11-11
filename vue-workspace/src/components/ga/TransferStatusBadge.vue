<script setup lang="ts">
import { STATUS_LABEL } from "../../../../lib/workspace/general-affairs/inventory-transfer-rules";
defineProps<{ status: string }>();
</script>

<template>
  <span class="tr-status" :class="'st-' + status" :data-status="status">{{ STATUS_LABEL[status] || status }}</span>
</template>

<style scoped>
.tr-status { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); white-space: nowrap; }
.st-REQUESTED { background: #fff3d6; color: #7a5300; border-color: #ecd391; }
.st-SOURCE_CONFIRMED { background: #e3f1fb; color: #14507a; border-color: #a9cde6; }
.st-IN_TRANSIT { background: #e5eafd; color: #243a8c; border-color: #aab6ea; }
.st-RECEIVED { background: #e2f4e6; color: #1b5e2f; border-color: #a6d4b1; }
.st-CANCELED { background: #eceff1; color: #455a64; border-color: #c4ccd0; }
:root[data-theme="dark"] .st-REQUESTED { background: #4a3d16; color: #f4d98a; border-color: #6b5a24; }
:root[data-theme="dark"] .st-SOURCE_CONFIRMED { background: #14354a; color: #a9d4ee; border-color: #2c5a7a; }
:root[data-theme="dark"] .st-IN_TRANSIT { background: #1e2a57; color: #b9c5f5; border-color: #3a4a8a; }
:root[data-theme="dark"] .st-RECEIVED { background: #17381f; color: #a6e0b5; border-color: #2c6a3d; }
:root[data-theme="dark"] .st-CANCELED { background: #2a3236; color: #c4ccd0; border-color: #4a565c; }
</style>
