<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { api } from "../api";
import { type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>(),
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
const estimate = computed(() => {
  if (!data.value) return null;
  const days = Math.max(
    0,
    Math.round(
      (Date.parse(data.value.today) -
        Date.parse(data.value.master.inspection_date)) /
        86400000,
    ),
  );
  const rule = data.value.bonus.find(
    (b: any) => days >= b.day_from && days <= b.day_to,
  );
  return {
    days,
    percent: rule?.bonus_score || 0,
    score:
      Math.round(
        (data.value.record.deduction_amount * (rule?.bonus_score || 0)) / 10,
      ) / 10,
  };
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
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files) return;
  error.value = "";
  props.tab.busy = true;
  try {
    const files = Array.from(input.files);
    if (files.length + photos.value.length > 5)
      throw Error("最多可上傳 5 張照片");
    for (const file of files) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw Error("請選擇 JPEG、PNG 或 WebP 圖片");
      const bitmap = await createImageBitmap(file),
        scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      photos.value.push(canvas.toDataURL("image/jpeg", 0.7));
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    props.tab.busy = false;
    input.value = "";
  }
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
      狀態：{{ labels[data.displayStatus] }} · 改善期限：{{
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
      ><p v-if="estimate" class="notice">
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
          ><label
            >改善照片（1–5 張）<input
              aria-label="上傳改善照片"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              :disabled="photos.length >= 5"
              @change="upload"
          /></label>
          <div class="module-actions">
            <figure v-for="(url, i) in photos" :key="i">
              <img
                :src="url"
                :alt="'改善照片 ' + (i + 1)"
                style="width: 120px; height: 90px; object-fit: cover"
              />
              <figcaption>
                <button type="button" @click="show([url])">
                  放大照片 {{ i + 1 }}</button
                ><button type="button" @click="photos.splice(i, 1)">
                  移除照片 {{ i + 1 }}
                </button>
              </figcaption>
            </figure>
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
      <p v-else class="notice">目前沒有回報權限，或項目已逾期結案。</p>
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
