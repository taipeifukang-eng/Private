<script setup lang="ts">
// 第 4 批 G27（D20、D21）：發起轉移與「更正所屬門市」的確認告知。固定寫明「進行中的單會一起轉到新門市」並列出受影響張數與清單。
import { computed } from "vue";
import { moveHeadline, moveSummary, type MovePreview } from "../../lib/ga-asset-move";

const props = defineProps<{ preview: MovePreview | null; toName?: string | null; loading?: boolean }>();
const lines = computed(() => moveSummary(props.preview));
</script>

<template>
  <section class="move-notice notice" role="note" aria-label="進行中的單會一起轉" data-testid="move-follow-notice">
    <p class="headline"><strong>{{ moveHeadline(toName) }}</strong></p>
    <p v-if="loading && !preview" class="muted" role="status">檢查進行中的單…</p>
    <template v-else-if="preview">
      <p v-for="l in lines" :key="l" class="line" data-testid="move-summary-line">{{ l }}</p>
      <ul v-if="preview.moving.length" class="docs" aria-label="會一起轉走的維修單">
        <li v-for="m in preview.moving" :key="m.request_id">{{ m.request_no }}　{{ m.title }}</li>
      </ul>
      <p v-if="preview.unlinked_work_orders.length" class="line"><small>需人工處理的舊式工單：{{ preview.unlinked_work_orders.map((w) => w.title).join("、") }}</small></p>
    </template>
    <p class="line"><small>轉過去之後，原門市只會留下已結案的單。不會發通知，單子的時間軸會留一筆紀錄。</small></p>
  </section>
</template>

<style scoped>
.move-notice { display: grid; gap: 4px; }
.move-notice p { margin: 0; }
.docs { margin: 2px 0 0; padding-left: 1.2em; }
</style>
