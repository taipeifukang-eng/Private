<script setup lang="ts">
// 第 4 批 G27（D21）：轉移單詳情「搬走的單」明細：一起轉到新門市的維修單（含工單），與沒搬、要人工處理的舊式工單。
import { computed } from "vue";
import { groupMoved, type MovedRow } from "../../lib/ga-asset-move";

const props = defineProps<{ rows: MovedRow[]; completed: boolean }>();
const grouped = computed(() => groupMoved(props.rows));
</script>

<template>
  <section class="moved" data-testid="moved-requests">
    <h4>搬走的單</h4>
    <p v-if="!completed" class="muted">轉入門市確認收到後，進行中的維修單會一起轉過去，名單會顯示在這裡。</p>
    <template v-else>
      <p v-if="!grouped.requests.length" class="muted" data-testid="moved-none">這次沒有進行中的維修單需要轉走。</p>
      <ul v-else aria-label="搬走的維修單">
        <li v-for="r in grouped.requests" :key="r.id" data-testid="moved-request">
          <strong>{{ r.doc_no }}</strong>　{{ r.doc_title }}
          <small v-if="r.work_order" class="muted">（含工單：{{ r.work_order.doc_title }}）</small>
        </li>
      </ul>
      <template v-if="grouped.unlinked.length">
        <p class="notice" role="note">以下舊式工單沒有連到需求單，不會自動轉，請總務人工處理：</p>
        <ul aria-label="沒有搬的舊式工單">
          <li v-for="w in grouped.unlinked" :key="w.id" data-testid="moved-unlinked">{{ w.doc_title }}</li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.moved ul { margin: 4px 0; padding-left: 1.2em; }
.moved h4 { margin: 12px 0 4px; }
</style>
