<script setup lang="ts">
import { computed } from "vue";
import { taskSchedule } from "../../../lib/workspace/task-schedule";
const props = defineProps<{ record: any }>();
const chart = computed(() => taskSchedule(props.record));
</script>
<template>
  <section class="task-gantt" aria-label="任務甘特排程">
    <h2>任務排程</h2>
    <p>
      {{ chart.explicit ? "預計時程" : "依項目日期推算" }}：{{ chart.start }} 至
      {{ chart.end }} · {{ chart.count }} 週
    </p>
    <p class="muted">
      無開始日期的項目依順序分配週次，標示為「推算」；進度顯示已儲存的結果。
    </p>
    <div class="gantt-scroll" tabindex="0" aria-label="每週排程表，可水平捲動">
      <table>
        <thead>
          <tr>
            <th scope="col">部門 / 項目</th>
            <th v-for="week in chart.weeks" :key="week.start" scope="col">
              {{ week.label
              }}<small>{{ week.start.slice(5) }}–{{ week.end.slice(5) }}</small>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="section in chart.sections" :key="section.id"
            ><tr class="gantt-section">
              <th :colspan="chart.count + 1" scope="rowgroup">
                {{ section.department
                }}<small
                  >負責人：{{ section.people.join("、") || "未指定" }}</small
                >
              </th>
            </tr>
            <tr v-for="item in section.items" :key="item.id">
              <th scope="row" :class="{ 'gantt-sub': item.sub }">
                {{ item.label
                }}<small
                  >{{ item.planned_start_date || "未設定" }} —
                  {{ item.planned_end_date || "未設定" }} ·
                  {{ item.status }}</small
                >
              </th>
              <td v-for="(_, index) in chart.weeks" :key="index">
                <span
                  v-if="index >= item.first && index <= item.last"
                  :class="[
                    'gantt-bar',
                    item.status === '已完成'
                      ? 'complete'
                      : item.status === '進行中'
                        ? 'progress'
                        : 'pending',
                  ]"
                  >{{
                    index === item.first
                      ? (item.estimated ? "推算 · " : "") + item.status
                      : "延續"
                  }}</span
                >
              </td>
            </tr></template
          >
          <tr v-if="!chart.sections.length">
            <td :colspan="chart.count + 1">尚未設定任務項目。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
.task-gantt {
  margin: 24px 0;
}
.gantt-scroll {
  overflow: auto;
  max-width: 100%;
  border: 1px solid var(--border, #d8ddcf);
}
table {
  border-collapse: collapse;
  min-width: 100%;
  font-size: 13px;
}
th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--border, #d8ddcf);
  text-align: left;
}
thead th {
  min-width: 112px;
  background: var(--surface, #edf0e8);
}
th:first-child {
  min-width: 240px;
  max-width: 360px;
}
small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  margin-top: 5px;
}
.gantt-section {
  background: var(--surface, #edf0e8);
}
.gantt-sub {
  padding-left: 28px;
}
.gantt-bar {
  display: block;
  white-space: nowrap;
  padding: 6px 8px;
  border-left: 3px solid #85651f;
  background: #f2ebda;
  color: #614509;
}
.gantt-bar.complete {
  border-color: #526b45;
  background: #e6eddf;
  color: #34492b;
}
.gantt-bar.pending {
  border-color: #7b8175;
  background: #eceee8;
  color: #42473e;
}
</style>
