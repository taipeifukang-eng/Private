<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace();
const stores = ref<any[]>([]),
  supervisors = ref<any[]>([]),
  managers = ref<any[]>([]);
const supervisor = ref(""),
  manager = ref(""),
  loading = ref(false),
  error = ref(""),
  result = ref<any>(null),
  differencesOnly = ref(false);
const photos = ref<string[]>([]),
  photoIndex = ref(0);
let sequence = 0;
const labels: Record<string, string> = {
  same: "扣分相同",
  missing: "缺少明細",
  manager_only: "僅經理扣分",
  supervisor_only: "僅督導扣分",
  both_different: "扣分不同",
};
const groups = computed(() => {
  const map = new Map<string, any[]>();
  for (const row of result.value?.items || []) {
    if (differencesOnly.value && row.status === "same") continue;
    const key = row.template.section_name || "未分類";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return [...map.entries()];
});
const counts = computed(() =>
  Object.keys(labels).map((key) => ({
    key,
    label: labels[key],
    count: (result.value?.items || []).filter((r: any) => r.status === key)
      .length,
  })),
);
async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  result.value = null;
  supervisor.value = "";
  manager.value = "";
  supervisors.value = [];
  managers.value = [];
  try {
    const data = await api<any>(
      "inspection-compare?" + new URLSearchParams({ store: props.tab.store }),
    );
    if (current !== sequence) return;
    stores.value = data.stores;
    supervisors.value = data.supervisorRecords;
    managers.value = data.managerRecords;
    supervisor.value = supervisors.value[0]?.id || "";
    manager.value =
      managers.value.find((r) => r.id === props.tab.recordId)?.id ||
      managers.value[0]?.id ||
      "";
    props.tab.title =
      "巡店比較 · " +
      (stores.value.find((s) => s.id === props.tab.store)?.store_name ||
        "選擇門市");
  } catch (e) {
    if (current === sequence) error.value = (e as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
async function compare() {
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  result.value = null;
  try {
    const data = await api<any>(
      "inspection-compare?" +
        new URLSearchParams({
          store: props.tab.store,
          supervisor: supervisor.value,
          manager: manager.value,
        }),
    );
    if (current === sequence) result.value = data;
  } catch (e) {
    if (current === sequence) error.value = (e as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
function showPhotos(urls: string[]) {
  photos.value = urls.filter(
    (url) =>
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ||
      /^https:\/\//.test(url),
  );
  photoIndex.value = 0;
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 對比分析</p>
      <h1>督導與經理巡店比較</h1>
      <p class="muted">比較同一門市兩次巡店的扣分、改善建議與照片。</p>
    </div>
    <button @click="load" :disabled="loading">重新整理</button>
  </header>
  <p v-if="error" role="alert" class="notice error">{{ error }}</p>
  <form class="filter-bar" @submit.prevent="compare">
    <label
      >門市<select
        aria-label="比較門市"
        v-model="tab.store"
        @change="load"
        :disabled="loading"
      >
        <option value="">選擇門市</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">
          {{ s.store_code }} {{ s.store_name }}
        </option>
      </select></label
    >
    <label
      >督導巡店<select
        aria-label="督導巡店"
        v-model="supervisor"
        @change="result = null"
        :disabled="loading"
        required
      >
        <option value="">選擇已完成紀錄</option>
        <option v-for="r in supervisors" :key="r.id" :value="r.id">
          {{ r.inspection_date }} · {{ r.inspector_name }} ·
          {{ r.total_score }} 分
        </option>
      </select></label
    >
    <label
      >經理巡店<select
        aria-label="經理巡店"
        v-model="manager"
        @change="result = null"
        :disabled="loading"
        required
      >
        <option value="">選擇已完成紀錄</option>
        <option v-for="r in managers" :key="r.id" :value="r.id">
          {{ r.inspection_date }} · {{ r.inspector_name }} ·
          {{ r.total_score }} 分
        </option>
      </select></label
    >
    <button class="primary" :disabled="loading || !supervisor || !manager">
      開始比較
    </button>
  </form>
  <p v-if="loading" role="status">載入比較資料…</p>
  <p
    v-else-if="tab.store && (!supervisors.length || !managers.length)"
    class="notice"
  >
    此門市尚未有可對比的督導與經理已完成紀錄。
  </p>
  <p class="muted">各提供最近 20 筆已完成紀錄，可選擇不同日期。</p>
  <template v-if="result">
    <div class="module-table">
      <table>
        <thead>
          <tr>
            <th>巡店</th>
            <th>日期</th>
            <th>總分 / 滿分</th>
            <th>評級</th>
            <th>整體建議</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="side in ['supervisor', 'manager']" :key="side">
            <th>{{ side === "supervisor" ? "督導" : "經理" }}</th>
            <td>{{ result[side].inspection_date }}</td>
            <td>
              {{ result[side].total_score }} /
              {{ result[side].max_possible_score }}
            </td>
            <td>{{ result[side].grade }}</td>
            <td style="white-space: pre-wrap">
              {{ result[side].supervisor_notes || "—" }}
            </td>
            <td>
              <button
                @click="
                  work.open('inspection-detail', tab.store, result[side].id)
                "
              >
                查看{{ side === "supervisor" ? "督導" : "經理" }}明細
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="module-actions">
      <span v-for="c in counts" :key="c.key"
        >{{ c.label }} {{ c.count }} 項</span
      >
    </p>
    <label
      ><input
        type="checkbox"
        v-model="differencesOnly"
      />只看扣分差異與缺少明細</label
    >
    <p v-if="!groups.length" class="notice">
      {{
        result.items.length
          ? "沒有符合條件的項目。"
          : "兩份紀錄皆沒有檢查明細，無法逐項比較。"
      }}
    </p>
    <details
      v-for="[section, rows] in groups"
      :key="section"
      :open="rows.some((r: any) => r.status !== 'same')"
    >
      <summary>{{ section }}（{{ rows.length }} 項）</summary>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th style="width: 24%">檢查項目</th>
              <th style="width: 30%">督導</th>
              <th style="width: 30%">經理</th>
              <th>比較</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.template.id">
              <th>
                {{ r.template.item_name }}
                <p class="muted">{{ r.template.item_description }}</p>
              </th>
              <td v-for="side in ['supervisor', 'manager']" :key="side">
                <template v-if="r[side]"
                  ><strong
                    >扣 {{ r[side].deduction_amount }} 分 · 得
                    {{ r[side].given_score }} / {{ r[side].max_score }}</strong
                  >
                  <p style="white-space: pre-wrap">
                    {{ r[side].notes || "—" }}
                  </p>
                  <p v-for="item in r[side].selected_items || []" :key="item">
                    {{ item
                    }}<span v-if="r[side].workspace_quantities?.[item] > 1">
                      × {{ r[side].workspace_quantities[item] }}</span
                    >
                  </p>
                  <button
                    v-if="r[side].photo_urls?.length"
                    @click="showPhotos(r[side].photo_urls)"
                  >
                    查看{{ side === "supervisor" ? "督導" : "經理" }}照片（{{
                      r[side].photo_urls.length
                    }}）
                  </button></template
                ><span v-else>無檢查明細</span>
              </td>
              <td>{{ labels[r.status] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </template>
  <Modal v-if="photos.length" title="比較巡店照片" @cancel="photos = []"
    ><img
      :src="photos[photoIndex]"
      alt="巡店比較照片"
      style="max-width: 100%; max-height: 65vh; object-fit: contain"
    />
    <div class="dialog-actions">
      <button :disabled="photoIndex === 0" @click="photoIndex--">上一張</button
      ><span>{{ photoIndex + 1 }} / {{ photos.length }}</span
      ><button
        :disabled="photoIndex >= photos.length - 1"
        @click="photoIndex++"
      >
        下一張</button
      ><button @click="photos = []">關閉照片</button>
    </div></Modal
  >
</template>
