<script setup lang="ts">
import { computed, ref } from "vue";
import Modal from "./Modal.vue";
import { inspectionStats } from "../../../lib/workspace/inspection-list";
const props = defineProps<{
  month: string;
  records: any[];
  coverage: { visited: any[]; unvisited: any[] } | null;
}>();
const emit = defineEmits<{ month: [value: string]; detail: [record: any] }>();
const selected = ref("");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const byDay = computed(() => {
  const result = new Map<string, any[]>();
  for (const row of props.records) {
    const key = row.inspection_date.slice(0, 10);
    result.set(key, [...(result.get(key) || []), row]);
  }
  return result;
});
const days = computed(() => {
  const [y, m] = props.month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(Date.UTC(y, m, 0));
  end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());
  const result = [];
  for (let time = start.getTime(); time <= end.getTime(); time += 86400000) {
    const key = new Date(time).toISOString().slice(0, 10);
    result.push({
      key,
      day: Number(key.slice(-2)),
      current: key.startsWith(props.month),
      records: byDay.value.get(key) || [],
    });
  }
  return result;
});
const selectedRows = computed(() => byDay.value.get(selected.value) || []);
function move(delta: number) {
  const [y, m] = props.month.split("-").map(Number);
  emit(
    "month",
    new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7),
  );
  selected.value = "";
}
function detail(row: any) {
  selected.value = "";
  emit("detail", row);
}
// M4 Q1、Q2：只算所選月份、只算已完成（草稿、進行中不灌水）。
const stats = computed(() => inspectionStats(props.records));
</script>
<template>
  <div class="inspection-summary" aria-label="當月巡店統計" data-testid="inspection-stats">
    <span
      >總巡店次數 <strong data-stat="total">{{ stats.total }}</strong></span
    ><span
      >優秀（8–10 分） <strong data-stat="excellent">{{ stats.excellent }}</strong></span
    ><span
      >良好（6–7 分） <strong data-stat="good">{{ stats.good }}</strong></span
    ><span
      >需改善（0–5 分） <strong data-stat="improve">{{ stats.improve }}</strong></span
    ><small class="muted">只統計 {{ month }} 已完成的巡店單，草稿與進行中不列入。</small>
  </div>
  <div v-if="coverage" class="inspection-coverage">
    <details open data-testid="coverage-visited">
      <summary>{{ month }} 已巡店（{{ coverage.visited.length }}）</summary>
      <ul>
        <li v-for="s in coverage.visited" :key="s.id">
          {{ s.short_name || s.store_name }}
        </li>
      </ul>
      <p v-if="!coverage.visited.length">本月尚無已巡店門市。</p>
    </details>
    <details open data-testid="coverage-unvisited">
      <summary>{{ month }} 尚未巡店（{{ coverage.unvisited.length }}）</summary>
      <ul>
        <li v-for="s in coverage.unvisited" :key="s.id" :data-draft="s.has_draft ? 'true' : 'false'">
          {{ s.short_name || s.store_name }}
          <small v-if="s.has_draft" class="draft-tag">有草稿未送出</small>
        </li>
      </ul>
      <p v-if="!coverage.unvisited.length">本月範圍內門市皆已有巡店紀錄。</p>
    </details>
  </div>
  <section class="inspection-calendar" aria-label="巡店月曆">
    <header>
      <h2>{{ month }} 巡店月曆</h2>
      <div>
        <button @click="emit('month', today.slice(0, 7))">今天</button
        ><button aria-label="上個月" @click="move(-1)">‹</button
        ><button aria-label="下個月" @click="move(1)">›</button>
      </div>
    </header>
    <div class="calendar-scroll">
      <div class="calendar-week">
        <span v-for="day in ['日', '一', '二', '三', '四', '五', '六']">{{
          day
        }}</span>
      </div>
      <div class="calendar-days">
        <button
          v-for="d in days"
          :key="d.key"
          :class="{ outside: !d.current, today: d.key === today }"
          :aria-label="
            d.current
              ? `${d.key}，共 ${d.records.length} 筆巡店紀錄，查看全部`
              : `${d.key}，切換至該月份`
          "
          aria-haspopup="dialog"
          @click="
            d.current ? (selected = d.key) : emit('month', d.key.slice(0, 7))
          "
        >
          <span>{{ d.day }}</span
          ><span
            v-for="r in d.records.slice(0, 3)"
            :key="r.id"
            class="calendar-record"
            >{{ r.store?.short_name || r.store?.store_name || "門市"
            }}<small>{{
              r.grade == null ? "未評級" : `得分 ${r.grade}/10`
            }}</small></span
          ><small v-if="d.records.length > 3"
            >另有 {{ d.records.length - 3 }} 筆・查看全部</small
          >
        </button>
      </div>
    </div>
  </section>
  <Modal v-if="selected" :title="`${selected} 巡店紀錄`" @cancel="selected = ''"
    ><p v-if="!selectedRows.length">這一天沒有巡店紀錄。</p>
    <ul class="calendar-record-list">
      <li v-for="r in selectedRows" :key="r.id">
        <span
          ><strong>{{ r.store?.short_name || r.store?.store_name }}</strong
          ><br />{{ r.inspector }} ·
          {{ r.grade == null ? "未評級" : `${r.grade}/10 分` }}</span
        ><button @click="detail(r)">查看明細</button>
      </li>
    </ul>
    <div class="dialog-actions">
      <button @click="selected = ''">關閉</button>
    </div></Modal
  >
</template>
