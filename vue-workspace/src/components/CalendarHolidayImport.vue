<script setup lang="ts">
// 政府假日匯入：從人事總處載入 -> 預覽 -> 發布。M5 Q21：同一年度已有發布版本時，預覽顯示與現有版本的差異，
// 發布前再跳一次「取代現有版本」的二次確認（伺服器端也會擋：沒帶確認會回 409）。
import { computed, ref } from "vue";
import { api, ApiError } from "../api";
import Modal from "./Modal.vue";
import { holidayDiffSummary, type HolidayDiff, type HolidayRow } from "../../../lib/workspace/calendar-rules";

const HOLIDAY_LABELS: Record<string, string> = { national_holiday: "國定假日", substitute_holiday: "補假日", makeup_workday: "補行上班" };
const props = defineProps<{ year: number; hasPublished: boolean }>();
const emit = defineEmits<{ close: []; published: [message: string] }>();

const source = ref({ source_name: "行政院人事行政總處", source_url: "", source_revision: `${props.year - 1911} 年政府行政機關辦公日曆表` });
const rows = ref<HolidayRow[]>([]);
const existing = ref<{ source_name: string; source_revision: string | null; imported_at: string; count: number } | null>(null);
const diff = ref<HolidayDiff | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const confirming = ref(false);

async function preview() {
  loading.value = true;
  error.value = "";
  rows.value = [];
  diff.value = null;
  existing.value = null;
  try {
    const data = await api("calendar/holidays/preview", { method: "POST", body: JSON.stringify({ calendar_year: props.year, use_official_source: true }) });
    rows.value = data.holidays || [];
    existing.value = data.existing || null;
    diff.value = data.diff || null;
    source.value = {
      source_name: data.source_name || source.value.source_name,
      source_url: data.source_url || source.value.source_url,
      source_revision: data.source_revision || source.value.source_revision,
    };
  } catch (e) {
    error.value = (e as Error).message || "讀取官方日曆失敗";
  } finally {
    loading.value = false;
  }
}
const needsConfirm = computed(() => Boolean(existing.value));
function publishClick() {
  if (!rows.value.length) return;
  if (needsConfirm.value) confirming.value = true;
  else void publish(false);
}
async function publish(replace: boolean) {
  confirming.value = false;
  saving.value = true;
  error.value = "";
  try {
    const body: Record<string, unknown> = { calendar_year: props.year, ...source.value, holidays: rows.value };
    if (replace) body.confirm_replace = true;
    const data = await api("calendar/holidays", { method: "POST", body: JSON.stringify(body) });
    const g = data.googleSync?.status;
    emit(
      "published",
      g === "failed" || g === "partial"
        ? `${props.year} 年政府假日已發布，但 Google 同步尚未完整，請至同步區重試`
        : `${props.year} 年政府假日資料已發布（${rows.value.length} 筆）`,
    );
  } catch (e) {
    // 預覽之後別人先發布了新版本：伺服器回 409 與最新差異，改成二次確認流程。
    if (e instanceof ApiError && e.status === 409 && e.data?.requiresConfirm) {
      existing.value = e.data.existing || existing.value;
      diff.value = e.data.diff || diff.value;
      error.value = "這個年度已有發布版本，請核對差異後再確認取代。";
    } else error.value = (e as Error).message || "匯入政府假日失敗";
  } finally {
    saving.value = false;
  }
}
const fmt = (d: string) => d.replace(/-/g, "/");
const dateText = (iso: string) => new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
</script>

<template>
  <Modal :title="hasPublished ? '更新政府假日資料' : '匯入政府假日'" wide :busy="saving" @cancel="!saving && emit('close')">
    <div class="holiday-import" data-testid="holiday-import">
      <p class="muted">{{ year }} 年 · 政府公告參考資料。系統會依年度自動載入人事總處一般版辦公日曆，預覽核對後再發布。</p>
      <p v-if="error" role="alert" class="notice error">{{ error }}</p>

      <section v-if="diff && existing" class="diff" data-testid="holiday-diff" aria-label="與現有版本的差異">
        <h3>與現有版本的差異</h3>
        <p>
          現有版本：{{ existing.source_name }}{{ existing.source_revision ? ` · ${existing.source_revision}` : "" }}，共 {{ existing.count }} 筆，匯入於 {{ dateText(existing.imported_at) }}。
        </p>
        <p><strong data-testid="holiday-diff-summary">{{ holidayDiffSummary(diff) }}</strong></p>
        <ul v-if="!diff.identical">
          <li v-for="r in diff.added.slice(0, 10)" :key="`a${r.holiday_date}`">新增　{{ fmt(r.holiday_date) }} {{ r.name }}（{{ HOLIDAY_LABELS[r.day_type] }}）</li>
          <li v-for="r in diff.removed.slice(0, 10)" :key="`r${r.holiday_date}`">移除　{{ fmt(r.holiday_date) }} {{ r.name }}（{{ HOLIDAY_LABELS[r.day_type] }}）</li>
          <li v-for="r in diff.renamed.slice(0, 10)" :key="`n${r.holiday_date}`">改名　{{ fmt(r.holiday_date) }} {{ r.before }} → {{ r.after }}</li>
          <li v-for="r in diff.retyped.slice(0, 10)" :key="`t${r.holiday_date}`">改類型　{{ fmt(r.holiday_date) }} {{ HOLIDAY_LABELS[r.before] || r.before }} → {{ HOLIDAY_LABELS[r.after] || r.after }}</li>
        </ul>
      </section>
      <p v-else-if="rows.length && !existing" class="muted">{{ year }} 年目前沒有發布版本，這是第一次匯入。</p>

      <section v-if="rows.length" class="preview" aria-label="假日資料預覽">
        <h3>辨識到 {{ rows.length }} 筆日期 <small>來源：{{ source.source_name }} · {{ source.source_revision }}</small></h3>
        <ul>
          <li v-for="r in rows.slice(0, 8)" :key="r.holiday_date">
            <span>{{ fmt(r.holiday_date) }}</span><span>{{ r.name }}</span><small>{{ HOLIDAY_LABELS[r.day_type] }}</small>
          </li>
        </ul>
        <p v-if="rows.length > 8" class="muted">另有 {{ rows.length - 8 }} 筆，發布後會完整匯入。</p>
      </section>

      <div class="dialog-actions">
        <button :disabled="saving" @click="emit('close')">取消</button>
        <a href="https://data.gov.tw/dataset/14718" target="_blank" rel="noreferrer" class="link-button">人事總處開放資料（年度 CSV）</a>
        <button :disabled="loading || saving" @click="preview">{{ loading ? "載入中…" : "從人事總處載入" }}</button>
        <button class="primary" :disabled="saving || loading || !rows.length" @click="publishClick">{{ saving ? "發布中…" : "確認發布" }}</button>
      </div>
    </div>
  </Modal>

  <Modal v-if="confirming && existing && diff" title="確認取代現有版本" @cancel="confirming = false">
    <div data-testid="holiday-confirm">
      <p>
        {{ year }} 年已有發布版本（{{ existing.count }} 筆）。發布後舊版本會被取代，全公司看到的假日立即改變，並自動同步 Google 日曆（被移除的假日會在 Google 上刪除）。
      </p>
      <p><strong>{{ holidayDiffSummary(diff) }}</strong></p>
      <p>請確認選對年度與檔案，再按「確認取代」。</p>
    </div>
    <div class="dialog-actions">
      <button @click="confirming = false">返回核對</button>
      <button class="danger" @click="publish(true)">確認取代</button>
    </div>
  </Modal>
</template>

<style scoped>
.holiday-import { display: grid; gap: 14px; }
h3 { margin: 0 0 6px; font-size: 15px; }
h3 small { margin-left: 8px; color: var(--muted); font-weight: 400; }
p { margin: 0; }
.diff { border: 1px solid var(--line); border-left: 3px solid #b18b42; border-radius: 6px; padding: 12px 14px; display: grid; gap: 6px; }
.diff ul, .preview ul { list-style: none; margin: 0; padding: 0; display: grid; }
.diff li { padding: 3px 0; }
.preview li { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.preview li span:nth-child(2) { flex: 1; }
.preview small { color: var(--muted); }
.link-button { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); text-decoration: none; }
</style>
