<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { api } from "../api";
import { useWorkspace, useSession, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import ImprovementPhotoUpload from "../components/ImprovementPhotoUpload.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace(),
  session = useSession(),
  data = ref<any>(null),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  description = ref(""),
  photos = ref<string[]>([]),
  confirm = ref(false),
  preview = ref<string[]>([]),
  index = ref(0);
let baseline = "";
const snapshot = () =>
  JSON.stringify({ description: description.value, photos: photos.value });
watch(
  [description, photos],
  () => {
    if (data.value && !loading.value) props.tab.dirty = snapshot() !== baseline;
  },
  { deep: true, flush: "sync" },
);
const labels: Record<string, string> = {
  pending: "待改善",
  overdue: "已逾期",
  improved: "已改善",
};
// 預估回補由伺服器用與資料庫相同的算法算出（台灣日期、逾期回補 0）。
const estimate = computed(() => {
  const e = data.value?.estimate;
  return e ? { days: e.days_taken, percent: e.percent, score: e.bonus_score, overdue: e.overdue } : null;
});
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<any>(`improvement-detail?id=${props.tab.recordId}`);
    description.value = data.value.record.improvement_description || "";
    photos.value = data.value.record.improvement_photo_urls || [];
    baseline = snapshot();
    props.tab.dirty = false;
    props.tab.title = "改善回報 · " + data.value.record.item_name;
    props.tab.submitOnly = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function show(urls: string[]) {
  preview.value = urls.filter(
    (u) =>
      /^https:\/\//.test(u) ||
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u),
  );
  index.value = 0;
}
function onPhotoError(message: string) {
  error.value = message;
}
async function submit() {
  if (props.tab.busy) return;
  error.value = "";
  props.tab.busy = true;
  try {
    const saved = await api<any>("improvement-detail", {
      method: "POST",
      body: JSON.stringify({
        id: props.tab.recordId,
        version: data.value.record.updated_at,
        description: description.value,
        photos: photos.value,
      }),
    });
    data.value.record = saved.record;
    data.value.canSubmit = false;
    data.value.displayStatus = "improved";
    baseline = snapshot();
    props.tab.dirty = false;
    confirm.value = false;
    message.value =
      "改善內容已送出，回補 " + saved.record.bonus_score + " 分。";
  } catch (e) {
    error.value = (e as Error).message;
    confirm.value = false;
  } finally {
    props.tab.busy = false;
  }
}
onMounted(load);
onBeforeUnmount(() => {
  props.tab.busy = false;
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 改善回報</p>
      <h1>改善項目與回報</h1>
      <p v-if="data" class="muted">
        {{ data.store?.store_code }} {{ data.store?.store_name }} ·
        {{ data.master?.inspection_date }} · {{ data.inspector }}
      </p>
    </div>
    <button @click="load" :disabled="loading || tab.busy || tab.dirty">
      重新整理
    </button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <p v-if="message" role="status" class="notice">{{ message }}</p>
  <p v-if="loading" role="status">載入改善項目…</p>
  <template v-else-if="data"
    ><h2>{{ data.record.section_name }} / {{ data.record.item_name }}</h2>
    <p>
      狀態：{{ labels[data.displayStatus] }}<span v-if="data.remaining && data.record.status !== 'improved'"> （{{ data.remaining }}）</span> · 改善期限：{{
        data.record.deadline
      }}
      · 原扣分：{{ data.record.deduction_amount }}
    </p>
    <p v-for="item in data.record.selected_items" :key="item">{{ item }}</p>
    <p style="white-space: pre-wrap">
      {{ data.record.issue_description || "沒有額外問題說明" }}
    </p>
    <button
      v-if="data.record.issue_photo_urls?.length"
      @click="show(data.record.issue_photo_urls)"
    >
      查看問題照片（{{ data.record.issue_photo_urls.length }}）
    </button>
    <template v-if="data.canSubmit"
      ><p v-if="data.displayStatus === 'overdue'" class="notice" data-testid="overdue-note">
        此項目已超過改善期限（{{ data.record.deadline }}），仍可補報並留下改善紀錄與照片，但回補 0 分。
      </p>
      <p v-else-if="estimate" class="notice" data-testid="estimate-note">
        距巡店 {{ estimate.days }} 天，依目前規則預估回補扣分
        {{ estimate.percent }}%（{{ estimate.score }} 分），以實際提交結果為準。
      </p>
      <details>
        <summary>回補規則</summary>
        <p v-for="b in data.bonus" :key="b.day_from">
          {{ b.day_from }}–{{ b.day_to }} 天：回補扣分 {{ b.bonus_score }}% ·
          {{ b.description }}
        </p>
        <p v-if="!data.bonus.length">目前未設定回補規則。</p>
      </details>
      <form class="inspection-editor" @submit.prevent="confirm = true">
        <fieldset :disabled="tab.busy">
          <legend>填寫改善回報</legend>
          <label
            >改善說明<textarea
              aria-label="改善說明"
              v-model="description"
              required
              maxlength="8000"
              rows="5"
              style="width: 100%"
            /></label
          >
          <div class="improvement-photos">
            <span class="improvement-photos-title">改善照片（1–5 張）</span>
            <ImprovementPhotoUpload
              :photos="photos"
              @add="photos.push($event)"
              @remove="photos.splice($event, 1)"
              @preview="show([photos[$event]])"
              @error="onPhotoError"
              @busy="tab.busy = $event"
            />
          </div>
          <button
            class="primary"
            :disabled="!description.trim() || !photos.length || tab.busy"
          >
            提交改善回報
          </button>
        </fieldset>
      </form></template
    >
    <template v-else
      ><h2>改善結果</h2>
      <p v-if="data.record.status === 'improved'">
        完成 {{ data.record.days_taken }} 天 · 回補
        {{ data.record.bonus_score }} 分 · {{ data.record.improved_at }}
      </p>
      <p v-else class="notice" data-testid="no-submit-note">您沒有提交此項目改善的權限（管理員、該門市店長或有「提交改善」權限者可回報）。</p>
      <p style="white-space: pre-wrap">
        {{ data.record.improvement_description || "尚未回報" }}
      </p>
      <button
        v-if="data.record.improvement_photo_urls?.length"
        @click="show(data.record.improvement_photo_urls)"
      >
        查看改善照片
      </button></template
    ></template
  >
  <p v-if="data && session.data?.capabilities.inspections" class="module-actions">
    <button data-testid="open-inspection" @click="work.open('inspection-detail', data.record.store_id, data.record.inspection_id)">查看完整巡店記錄 →</button>
  </p>
  <Modal
    v-if="confirm"
    title="提交改善回報"
    :busy="tab.busy"
    @cancel="confirm = false"
    ><p>送出後會記錄改善時間並計算回補分數，此頁無法再修改。</p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="confirm = false">繼續編輯</button
      ><button class="primary" :disabled="tab.busy" @click="submit">
        確認提交
      </button>
    </div></Modal
  >
  <Modal v-if="preview.length" title="改善照片" @cancel="preview = []"
    ><img
      :src="preview[index]"
      alt="改善照片預覽"
      style="max-width: 100%; max-height: 65vh; object-fit: contain"
    />
    <div class="dialog-actions">
      <button :disabled="index === 0" @click="index--">上一張</button
      ><span>{{ index + 1 }} / {{ preview.length }}</span
      ><button :disabled="index === preview.length - 1" @click="index++">
        下一張</button
      ><button @click="preview = []">關閉照片</button>
    </div></Modal
  >
</template>
