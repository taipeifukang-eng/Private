<script setup lang="ts">
// A4 列印報表（M4 W16）：版面照舊版 components/PrintInspectionReport.tsx（報告編號、店址、得分率、列印時間、
// 督導改善建議手寫空格、督導建議流程、簽名日期、督導未簽名時印姓名），再加兩項已核可的補強：
//  Q20 店長已回報改善時，該項下方多印回報說明、照片與回補分數；Q21 流程說明改印系統算出的期限日期與回補級距。
import { computed, ref } from "vue";
import { followupNotice, printFindings, reportNumber, scoreRate, scoreTrio } from "../../../lib/workspace/inspection-print";
import { formatTaipeiDate, formatTaipeiDateTime } from "../taipei-time";
const props = defineProps<{ data: any }>();
const failed = ref<string[]>([]);
const record = computed(() => props.data.record);
const items = computed(() => printFindings(props.data.results || [], props.data.improvements || []));
const trio = computed(() => scoreTrio(record.value));
const notice = computed(
  () =>
    props.data.followup ||
    followupNotice({ inspectionDate: record.value.inspection_date, rules: props.data.bonusRules || [] }),
);
const printedAt = formatTaipeiDateTime(new Date());
const date = computed(() => formatTaipeiDate(record.value.inspection_date) || record.value.inspection_date);
const safe = (url: unknown) =>
  typeof url === "string" && (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || /^https:\/\//.test(url)) ? url : null;
const photos = (urls: unknown) => (Array.isArray(urls) ? urls.map(safe).filter((u): u is string => !!u) : []);
const hasGps = computed(() => record.value.gps_latitude != null && record.value.gps_longitude != null && record.value.gps_latitude !== "" && record.value.gps_longitude !== "");
const supervisorLabel = computed(() => (record.value.inspection_type === "manager" ? "經理人員" : "督導人員"));
const quantities = (r: any, item: string) => (r.workspace_quantities?.[item] > 1 ? ` × ${r.workspace_quantities[item]}` : "");
const hasImproved = computed(() => (props.data.improvements || []).some((i: any) => i.status === "improved"));
</script>
<template>
  <article class="inspection-report" data-testid="print-report">
    <header class="report-head">
      <h1>門市巡店檢核報告</h1>
      <div class="report-meta">
        <div>
          <p><strong>店鋪名稱：</strong>{{ data.store?.store_name }}</p>
          <p><strong>店鋪代碼：</strong>{{ data.store?.store_code }}</p>
          <p><strong>店鋪地址：</strong>{{ data.store?.address || "" }}</p>
        </div>
        <div>
          <p><strong>檢核日期：</strong>{{ date }}</p>
          <p><strong>{{ supervisorLabel }}：</strong>{{ data.inspector || "未知" }}</p>
          <p data-testid="report-no"><strong>報告編號：</strong>{{ reportNumber(record.id) }}</p>
          <p v-if="record.indoor_temperature != null"><strong>室內溫度：</strong>{{ record.indoor_temperature }}°C</p>
        </div>
      </div>
      <p v-if="hasGps" class="report-small">GPS 定位：{{ Number(record.gps_latitude).toFixed(6) }}, {{ Number(record.gps_longitude).toFixed(6) }}</p>
      <div v-if="data.staff?.length" class="report-staff">
        <p class="report-small"><strong>當班人員（{{ data.staff.length }} 人）：</strong></p>
        <table>
          <thead><tr><th>員編</th><th>姓名</th><th>職位</th><th>當班主管</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in data.staff" :key="i">
              <td>{{ s.employee_code || "-" }}</td><td>{{ s.employee_name }}</td><td>{{ s.position || "-" }}</td><td>{{ s.is_duty_supervisor ? "✓" : "" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </header>

    <section class="report-score" data-testid="report-score">
      <h2>評分總覽</h2>
      <table>
        <tbody>
          <tr><th>總得分</th><th>總分</th><th>得分率</th><th>評級</th></tr>
          <tr>
            <td data-testid="score-total">{{ record.total_score }}</td>
            <td>{{ record.max_possible_score }}</td>
            <td>{{ scoreRate(record.total_score, record.max_possible_score) }}%</td>
            <td>{{ record.grade }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="trio.bonus > 0 || hasImproved" class="report-small" data-testid="score-trio">
        原始得分 {{ trio.original }} · 改善回補 +{{ trio.bonus }} · 最終得分 {{ trio.final }}（回補已加進總得分）
      </p>
    </section>

    <section v-if="record.supervisor_notes" class="report-notes">
      <h2>此次巡店督導其他建議</h2>
      <p class="report-note">{{ record.supervisor_notes }}</p>
    </section>

    <section v-if="items.length" class="report-issues" data-testid="report-issues">
      <h2 class="report-red">待改善項目彙整</h2>
      <p class="report-small" data-testid="deadline-notice">{{ notice.text }}</p>
      <div v-for="(item, index) in items" :key="item.result.id" class="report-issue" data-testid="report-issue">
        <h3><span class="report-no">{{ index + 1 }}</span> {{ item.result.template?.section_name }} - {{ item.result.template?.item_name }}</h3>
        <p class="report-red">扣分：<strong>-{{ item.result.deduction_amount }}</strong> 分</p>
        <ul v-if="item.result.selected_items?.length">
          <li v-for="(label, i) in item.result.selected_items" :key="i">{{ label }}{{ quantities(item.result, label) }}</li>
        </ul>
        <div v-if="item.result.notes" class="report-box"><strong>缺失說明：</strong><span class="report-note">{{ item.result.notes }}</span></div>
        <div v-if="photos(item.result.photo_urls).length">
          <p class="report-small"><strong>缺失照片：</strong></p>
          <div class="report-photos">
            <figure v-for="(url, i) in photos(item.result.photo_urls)" :key="i">
              <img :src="url" :alt="`缺失照片 ${i + 1}`" @error="failed.push(url)" /><figcaption>照片 {{ i + 1 }}</figcaption>
            </figure>
          </div>
        </div>
        <div class="report-small"><strong>督導改善建議：</strong><div class="report-handwriting" data-testid="handwriting-box"></div></div>
        <template v-for="f in item.improvements" :key="f.id">
          <div v-if="f.status === 'improved'" class="report-followup" data-testid="report-followup">
            <p><strong>店長改善回報：</strong>已改善 · {{ f.days_taken ?? "—" }} 天完成 · 回補 {{ f.bonus_score ?? 0 }} 分</p>
            <p class="report-note">{{ f.improvement_description || "未填寫改善說明" }}</p>
            <div v-if="photos(f.improvement_photo_urls).length" class="report-photos">
              <figure v-for="(url, i) in photos(f.improvement_photo_urls)" :key="i">
                <img :src="url" :alt="`改善照片 ${i + 1}`" @error="failed.push(url)" /><figcaption>改善照片 {{ i + 1 }}</figcaption>
              </figure>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section class="report-signatures" :class="{ 'report-newpage': !items.length }" data-testid="report-signatures">
      <h2>回饋與簽名確認</h2>
      <div class="report-box" data-testid="flow-note">
        <h3>督導建議流程：</h3>
        <ol>
          <li>店長/店主管收到報告後，應於 <strong data-testid="flow-deadline">{{ notice.deadline }}</strong> 前確認並回報所有待改善項目<span v-if="notice.tiers.length">（{{ notice.tiers.join("、") }}）</span></li>
          <li>針對每項缺失擬定具體改善計畫與完成時間</li>
          <li>拍照記錄改善前後對比照片，上傳至系統</li>
          <li>督導將於<strong>下次巡店時</strong>進行複查，確認改善成效</li>
          <li>每月督導巡店紀錄分數，將列入月度績效考核</li>
        </ol>
      </div>
      <div class="report-sign-grid">
        <div class="report-box">
          <p><strong>店長/當班主管確認簽名：</strong></p>
          <div class="report-signature"><img v-if="safe(record.signature_photo_url)" :src="safe(record.signature_photo_url)!" alt="店長/當班主管確認簽名" /></div>
          <p class="report-small" data-testid="store-sign-date">{{ record.signature_photo_url ? `簽名日期：${date}` : "簽名日期：_____________" }}</p>
        </div>
        <div class="report-box">
          <p><strong>{{ supervisorLabel }}：</strong></p>
          <div class="report-signature"><img v-if="safe(record.supervisor_signature_url)" :src="safe(record.supervisor_signature_url)!" alt="督導簽名" /><span v-else data-testid="inspector-name">{{ data.inspector || "" }}</span></div>
          <p class="report-small">巡店日期：{{ date }}</p>
        </div>
      </div>
    </section>

    <footer>
      <p>本報告由系統自動生成 | 列印時間：{{ printedAt }} | 巡店單號：{{ record.inspection_no }}</p>
      <p>如有疑問，請聯繫督導人員或管理部門</p>
    </footer>
  </article>
</template>
<style scoped>
.report-head{border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:16px}.report-small{font-size:12px}.report-red{color:#b3261e}.report-no{display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#b3261e;color:#fff;font-size:12px}.report-box{border:1px solid #999;border-radius:4px;padding:10px;margin:8px 0}.report-followup{border:1px solid #2e7d32;border-radius:4px;padding:10px;margin:8px 0;background:#f4faf4;break-inside:avoid}.report-sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.report-newpage{break-before:page}.report-staff table{font-size:12px}.report-score table th{text-align:center}.report-score table td{text-align:center;font-size:20px;font-weight:700}.report-issue{break-inside:avoid;border:1px solid #e6b1ae;border-radius:4px;padding:12px;margin:12px 0;background:#fff8f7}
@media(max-width:700px){.report-sign-grid{grid-template-columns:1fr}}
</style>
