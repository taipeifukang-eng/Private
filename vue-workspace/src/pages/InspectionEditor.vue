<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import SignatureInput from "../components/SignatureInput.vue";
import { scoreInspection } from "../../../lib/workspace/inspection-scoring";
const props = defineProps<{ tab: WorkTab }>(),
  work = useWorkspace();
const recordRemoved = computed(() =>
  work.deletedInspectionIds.includes(props.tab.recordId || ""),
);
const ready = ref(false);
const loading = ref(true),
  error = ref(""),
  message = ref(""),
  failed = ref(false),
  submitConfirm = ref(false),
  templates = ref<any[]>([]),
  grades = ref<any[]>([]),
  stores = ref<any[]>([]),
  templateHash = ref(""),
  version = ref(0),
  locked = ref(false),
  locating = ref(false),
  uploading = ref(false);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const form = ref<any>({
  store: props.tab.store,
  type: props.tab.payload?.type || "supervisor",
  date: today(),
  temperature: "",
  notes: "",
  gps: null,
  signature: "",
  supervisorSignature: "",
  scores: [],
  staff: [],
});
let baseline = "",
  pending: { serialized: string; writeId: string } | null = null;
const sections = computed(() => {
  const map = new Map<string, { name: string; items: any[] }>();
  for (const t of templates.value) {
    const key = t.section || "other";
    if (!map.has(key)) map.set(key, { name: t.section_name || key, items: [] });
    map.get(key)!.items.push(t);
  }
  return [...map.entries()];
});
const scoreResult = computed(() => {
  try {
    return {
      value: scoreInspection(templates.value, form.value.scores, grades.value),
      error: "",
    };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
});
watch(
  form,
  () => {
    if (!loading.value) {
      props.tab.dirty = JSON.stringify(form.value) !== baseline;
      message.value = "";
    }
  },
  { deep: true, flush: "sync" },
);
const disabled = computed(
  () => loading.value || locked.value || props.tab.busy || uploading.value,
);
function score(id: string) {
  return form.value.scores.find((s: any) => s.template_id === id);
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ type: form.value.type });
    if (props.tab.recordId) params.set("id", props.tab.recordId);
    else if (form.value.store) params.set("store", form.value.store);
    const r = await api("inspection-form?" + params);
    templates.value = r.templates;
    grades.value = r.grades;
    stores.value = r.stores;
    templateHash.value = r.templateHash;
    if (r.record) {
      const row = r.record;
      version.value = row.workspace_version;
      form.value = {
        ...form.value,
        store: row.store_id,
        date: row.inspection_date,
        temperature: row.indoor_temperature ?? "",
        notes: row.supervisor_notes || "",
        signature: row.signature_photo_url || "",
        supervisorSignature: row.supervisor_signature_url || "",
        gps: row.gps_timestamp
          ? {
              latitude: Number(row.gps_latitude),
              longitude: Number(row.gps_longitude),
              accuracy: Number(row.gps_accuracy),
              capturedAt: row.gps_timestamp,
            }
          : null,
        staff: r.staff.map((s: any) => ({
          ...s,
          employee_code: s.employee_code || "",
          position: s.position || "",
        })),
      };
    } else
      form.value.staff = r.roster.map((s: any) => ({
        ...s,
        employee_code: s.employee_code || "",
        employee_name: s.employee_name || "",
        position: s.position || "",
        is_duty_supervisor: false,
        is_manually_added: false,
      }));
    form.value.scores = r.templates.map((t: any) => {
      const old = r.results.find((s: any) => s.template_id === t.id);
      const checked = old?.selected_items || [];
      let quantities = old?.workspace_quantities || {};
      if (old && !Object.keys(quantities).length) {
        const counted = (t.checklist_items || []).filter(
          (o: any) => checked.includes(o.label) && o.requires_quantity,
        );
        if (counted.length === 1) {
          const fixed = (t.checklist_items || [])
            .filter(
              (o: any) => checked.includes(o.label) && !o.requires_quantity,
            )
            .reduce((n: number, o: any) => n + Number(o.deduction), 0);
          const inferred =
            (Number(old.deduction_amount) - fixed) /
            Number(counted[0].deduction);
          if (Number.isInteger(inferred) && inferred >= 1)
            quantities = { [counted[0].label]: inferred };
          else error.value = "舊紀錄缺少缺失數量，請逐項核對再儲存。";
        } else if (counted.length > 1)
          error.value = "舊紀錄缺少各項數量，請逐項核對再儲存。";
      }
      if (old) {
        for (const option of t.checklist_items || []) {
          if (
            option.requires_quantity &&
            checked.includes(option.label) &&
            quantities[option.label] == null
          ) {
            quantities[option.label] = 0;
          }
        }
      }
      return {
        template_id: t.id,
        checked_items: checked,
        quantities,
        notes: old?.notes || "",
        photos: old?.photo_urls || [],
      };
    });
    props.tab.title = props.tab.recordId
      ? "編輯巡店"
      : "新增" + (form.value.type === "manager" ? "經理" : "督導") + "巡店";
    ready.value = true;
    baseline = JSON.stringify(form.value);
    props.tab.dirty = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function loadRoster() {
  if (!form.value.store) return;
  error.value = "";
  try {
    const r = await api(
      "inspection-form?" +
        new URLSearchParams({
          type: form.value.type,
          store: form.value.store,
          ...(props.tab.recordId ? { id: props.tab.recordId } : {}),
        }),
    );
    for (const s of r.roster) {
      if (
        !form.value.staff.some(
          (x: any) =>
            x.employee_code === s.employee_code &&
            x.employee_name === s.employee_name,
        )
      )
        form.value.staff.push({
          ...s,
          employee_code: s.employee_code || "",
          employee_name: s.employee_name || "",
          position: s.position || "",
          is_duty_supervisor: false,
          is_manually_added: false,
        });
    }
    message.value = "已加入上月在職人員；請移除本次不在班的人員。";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function locate() {
  if (!navigator.geolocation) {
    error.value = "此瀏覽器不支援定位";
    return;
  }
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const now = Date.now();
      const timestamp =
        Number.isFinite(p.timestamp) && Math.abs(p.timestamp - now) <= 300000
          ? p.timestamp
          : now;
      form.value.gps = {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        capturedAt: new Date(timestamp).toISOString(),
      };
      form.value.date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp));
      locating.value = false;
    },
    () => {
      error.value = "定位失敗，請檢查瀏覽器定位權限後重試。";
      locating.value = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}
async function photo(id: string, event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new Error("請選擇 JPEG、PNG 或 WebP 圖片");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)),
      c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close();
    score(id).photos.push(c.toDataURL("image/jpeg", 0.7));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    input.value = "";
    uploading.value = false;
  }
}
async function save(status = "draft") {
  if (recordRemoved.value) {
    error.value = "此巡店已刪除，不能儲存；本頁填寫內容仍保留。";
    return false;
  }
  error.value = "";
  if (disabled.value) return false;
  if (!form.value.store || form.value.temperature === "") {
    error.value = "請選擇門市並輸入室內溫度";
    failed.value = true;
    return false;
  }
  if (scoreResult.value.error) {
    error.value = scoreResult.value.error;
    failed.value = true;
    return false;
  }
  props.tab.busy = true;
  try {
    const body = {
      ...form.value,
      temperature: Number(form.value.temperature),
      id: props.tab.recordId || null,
      version: version.value,
      templateHash: templateHash.value,
      status,
    };
    const serialized = JSON.stringify(body);
    if (pending?.serialized !== serialized)
      pending = { serialized, writeId: crypto.randomUUID() };
    const r = await api("inspection-form", {
      method: "POST",
      body: JSON.stringify({ ...body, writeId: pending.writeId }),
    });
    props.tab.recordId = r.record.id;
    version.value = r.record.workspace_version;
    baseline = JSON.stringify(form.value);
    props.tab.dirty = false;
    pending = null;
    submitConfirm.value = false;
    message.value = status === "completed" ? "巡店已完成提交" : "草稿已儲存";
    locked.value = status === "completed";
    props.tab.title = locked.value ? "已提交巡店" : "編輯巡店";
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    failed.value = true;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = () => save("draft");
onBeforeUnmount(() => {
  delete props.tab.save;
});
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">
        巡店 / {{ form.type === "manager" ? "經理" : "督導" }}
      </p>
      <h1>{{ tab.recordId ? "編輯巡店" : "新增巡店" }}</h1>
      <p class="muted">選擇缺失項目及數量，系統依範本計分。</p>
    </div>
    <button
      v-if="locked"
      @click="work.open('inspection-detail', form.store, tab.recordId)"
    >
      查看已提交紀錄
    </button>
  </header>
  <p v-if="recordRemoved" class="notice error" role="alert">
    此巡店已在其他頁籤刪除，不能儲存；本頁草稿仍保留供核對。
  </p>
  <p v-if="loading" role="status">載入巡店表單…</p>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <button v-if="!loading && !ready" @click="load">重新載入表單</button>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <form
    v-if="!loading && ready"
    @submit.prevent="submitConfirm = true"
    class="inspection-editor"
  >
    <fieldset :disabled="disabled">
      <legend>基本資料</legend>
      <div class="module-form-grid">
        <label
          >門市<select v-model="form.store" aria-label="巡店門市" required>
            <option value="">選擇門市</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">
              {{ s.store_code }} {{ s.store_name }}
            </option>
          </select></label
        ><label
          >巡店日期<input
            type="date"
            v-model="form.date"
            :disabled="!!form.gps"
            required /></label
        ><label
          >室內溫度（°C）<input
            type="number"
            step="0.1"
            min="-99.9"
            max="99.9"
            v-model="form.temperature"
            required
        /></label>
      </div>
      <div class="module-actions">
        <button type="button" @click="locate" :disabled="locating">
          {{ locating ? "定位中…" : "取得 GPS 定位" }}</button
        ><span v-if="form.gps"
          >{{ form.gps.latitude.toFixed(5) }},
          {{ form.gps.longitude.toFixed(5) }} · 精度
          {{ Math.round(form.gps.accuracy) }} 公尺</span
        ><button v-if="form.gps" type="button" @click="form.gps = null">
          清除定位
        </button>
      </div>
      <p v-if="form.gps" class="muted">巡店日期依定位時間（台北）認列。</p>
    </fieldset>
    <fieldset :disabled="disabled">
      <legend>當班人員</legend>
      <div class="module-actions">
        <button type="button" @click="loadRoster" :disabled="!form.store">
          加入上月在職名冊</button
        ><button
          type="button"
          @click="
            form.staff.push({
              employee_code: '',
              employee_name: '',
              position: '',
              is_duty_supervisor: false,
              is_manually_added: true,
            })
          "
        >
          手動新增人員
        </button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>員編</th>
              <th>姓名</th>
              <th>職位</th>
              <th>當班督導</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in form.staff" :key="i">
              <td>
                <input
                  v-model="s.employee_code"
                  :aria-label="`人員 ${Number(i) + 1} 員編`"
                  maxlength="20"
                />
              </td>
              <td>
                <input
                  v-model="s.employee_name"
                  :aria-label="`人員 ${Number(i) + 1} 姓名`"
                  required
                  maxlength="100"
                />
              </td>
              <td>
                <input
                  v-model="s.position"
                  :aria-label="`人員 ${Number(i) + 1} 職位`"
                  maxlength="50"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  v-model="s.is_duty_supervisor"
                  :aria-label="`人員 ${Number(i) + 1} 當班督導`"
                />
              </td>
              <td>
                <button type="button" @click="form.staff.splice(i, 1)">
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!form.staff.length" class="muted">尚未加入本次當班人員。</p>
    </fieldset>
    <div class="inspection-summary">
      <strong>總分 {{ scoreResult.value?.total ?? "—" }} / 220</strong
      ><span>評級 {{ scoreResult.value?.grade ?? "—" }} / 10</span
      ><span>扣分 {{ scoreResult.value?.deduction ?? "—" }}</span>
    </div>
    <p v-if="scoreResult.error" class="notice error">{{ scoreResult.error }}</p>
    <fieldset :disabled="disabled">
      <legend>巡店檢查項目</legend>
      <details
        v-for="[key, section] in sections"
        :key="key"
        open
        class="inspection-section"
      >
        <summary>{{ section.name }} · {{ section.items.length }} 項</summary>
        <section
          v-for="t in section.items"
          :key="t.id"
          class="inspection-score-item"
        >
          <h3>
            {{ t.item_name }} <small>滿分 {{ t.max_score }}</small>
          </h3>
          <p class="muted">{{ t.item_description }}</p>
          <div
            v-for="o in t.checklist_items || []"
            :key="o.label"
            class="inspection-check"
          >
            <label
              ><input
                type="checkbox"
                :value="o.label"
                v-model="score(t.id).checked_items"
              />{{ o.label }}（扣 {{ o.deduction }} 分{{
                o.requires_quantity ? " / " + (o.unit || "件") : ""
              }}）</label
            ><label
              v-if="
                o.requires_quantity &&
                score(t.id).checked_items.includes(o.label)
              "
              >數量<input
                type="number"
                min="1"
                step="1"
                :aria-label="o.label + '數量'"
                :value="score(t.id).quantities[o.label] || 1"
                @input="
                  score(t.id).quantities[o.label] = Number(
                    ($event.target as HTMLInputElement).value,
                  )
                "
            /></label>
          </div>
          <label
            >改善建議 / 備註<textarea
              v-model="score(t.id).notes"
              maxlength="4000"
              rows="2"
              :aria-label="t.item_name + '備註'"
            />
          </label>
          <div class="inspection-photos">
            <figure v-for="(url, i) in score(t.id).photos" :key="i">
              <img
                :src="url"
                :alt="t.item_name + '照片' + (Number(i) + 1)"
              /><button type="button" @click="score(t.id).photos.splice(i, 1)">
                移除照片 {{ Number(i) + 1 }}
              </button>
            </figure>
          </div>
          <label v-if="score(t.id).photos.length < 5"
            >加入問題照片（最多 5 張）<input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :aria-label="t.item_name + '加入照片'"
              @change="photo(t.id, $event)"
          /></label>
        </section>
      </details>
    </fieldset>
    <fieldset :disabled="disabled">
      <legend>巡店備註與簽名</legend>
      <label
        >巡店備註<textarea v-model="form.notes" maxlength="8000" rows="4" />
      </label>
      <div class="module-form-grid">
        <SignatureInput
          v-model="form.signature"
          label="門市人員簽名"
          :disabled="disabled"
        /><SignatureInput
          v-model="form.supervisorSignature"
          label="督導簽名"
          :disabled="disabled"
        />
      </div>
    </fieldset>
    <div class="module-actions">
      <button type="button" @click="save('draft')" :disabled="disabled">
        儲存草稿</button
      ><button class="primary" :disabled="disabled">提交巡店</button>
    </div>
  </form>
  <Modal
    v-if="submitConfirm"
    title="提交巡店"
    :busy="tab.busy"
    @cancel="submitConfirm = false"
    ><p>提交後將完成此巡店，不能繼續編輯。請確認評分、當班人員及附件。</p>
    <div class="dialog-actions">
      <button @click="submitConfirm = false" :disabled="tab.busy">
        返回檢查</button
      ><button class="primary" @click="save('completed')" :disabled="tab.busy">
        確認提交
      </button>
    </div></Modal
  ><Modal v-if="failed" title="巡店尚未儲存" @cancel="failed = false"
    ><p>{{ error }}</p>
    <p>表單內容仍保留，請修正或稍後重試。</p>
    <div class="dialog-actions">
      <button @click="failed = false">返回編輯</button>
    </div></Modal
  >
</template>
