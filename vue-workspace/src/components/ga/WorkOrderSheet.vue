<script setup lang="ts">
import { fmtTime } from "../../lib/ga-inventory-stock";
import { PRIORITY_LABEL } from "../../lib/ga-work-orders";

// G18 A4 工單表單內容（預覽與列印共用）：基本資料、問題描述、公開進度、照片；內部備註與強制結案原因只在「包含內部備註」時出現（W7）。
defineProps<{ data: any }>();
const storeText = (w: any) => [w.store_code, w.store_name].filter(Boolean).join(" ");
</script>

<template>
  <article class="inspection-report wo-sheet" data-testid="wo-sheet">
    <h1>維修工單表單</h1>
    <table class="wo-sheet-info">
      <tbody>
        <tr><th>工單編號</th><td data-testid="sheet-no">{{ data.work_order.wo_no }}</td><th>目前狀態</th><td>{{ data.work_order.status_label }}{{ data.work_order.stage_label ? "（" + data.work_order.stage_label + "）" : "" }}</td></tr>
        <tr><th>門市</th><td>{{ storeText(data.work_order) }}</td><th>回報日期</th><td>{{ fmtTime(data.work_order.reported_at) }}</td></tr>
        <tr><th>聯絡窗口</th><td>{{ data.work_order.contact_name || "—" }}</td><th>聯絡電話</th><td>{{ data.work_order.contact_phone || "—" }}</td></tr>
        <tr><th>問題類型</th><td>{{ [data.work_order.issue_type, data.work_order.category_name].filter(Boolean).join(" / ") || "—" }}</td><th>優先順序</th><td>{{ PRIORITY_LABEL[data.work_order.priority] || data.work_order.priority }}</td></tr>
        <tr><th>標題</th><td colspan="3">{{ data.work_order.title }}</td></tr>
      </tbody>
    </table>
    <h2>問題描述</h2>
    <p class="report-note">{{ data.work_order.description || "（沒有說明）" }}</p>
    <h2>處理進度</h2>
    <table v-if="data.public_timeline.length" class="wo-sheet-timeline" data-testid="sheet-timeline">
      <thead><tr><th style="width: 24%">時間</th><th style="width: 22%">階段</th><th>內容</th></tr></thead>
      <tbody><tr v-for="(t, i) in data.public_timeline" :key="i"><td>{{ fmtTime(t.at) }}</td><td>{{ t.stage_label || "" }}</td><td class="report-note">{{ t.text }}</td></tr></tbody>
    </table>
    <p v-else>尚無公開進度。</p>
    <template v-if="data.include_internal">
      <h2 data-testid="sheet-internal-title">內部備註（不對門市公開）</h2>
      <table v-if="data.internal_updates.length" class="wo-sheet-timeline" data-testid="sheet-internal">
        <tbody><tr v-for="(t, i) in data.internal_updates" :key="i"><td style="width: 24%">{{ fmtTime(t.at) }}</td><td class="report-note">{{ t.text }}</td></tr></tbody>
      </table>
      <p v-else>沒有內部備註。</p>
      <p v-if="data.force_close_reason" class="report-note" data-testid="sheet-force-reason">強制結案原因：{{ data.force_close_reason }}</p>
    </template>
    <template v-if="data.photos.length">
      <h2>照片</h2>
      <div class="report-photos" data-testid="sheet-photos">
        <figure v-for="p in data.photos" :key="p.id"><img v-if="p.signed_url" :src="p.signed_url" :alt="p.file_name" /><figcaption>{{ p.file_name }}{{ p.legacy ? "（舊版照片）" : "" }}</figcaption></figure>
      </div>
    </template>
    <footer>列印時間：{{ fmtTime(data.printed_at) }}</footer>
  </article>
</template>
