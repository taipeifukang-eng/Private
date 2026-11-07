<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import { type WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import {
  bonusImpactNotice,
  findBonusOverlap,
} from "../../../lib/workspace/inspection-settings-rules";
const props = defineProps<{ tab: WorkTab }>(),
  kind = props.tab.payload?.kind || "template",
  form = ref<any>(null),
  version = ref(0),
  templates = ref<any[]>([]),
  bonusRules = ref<any[]>([]),
  pendingCount = ref(0),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  deactivate = ref(false);
const title = computed(() =>
  kind === "grades"
    ? "編輯評級對照"
    : (props.tab.recordId ? "編輯" : "新增") +
      (kind === "template" ? "檢查項目" : "回補規則"),
);
const sections = computed(() =>
  Array.from(new Map(templates.value.map((t) => [t.section, t])).values()),
);
let baseline = "",
  pending: { serialized: string; writeId: string } | null = null;
watch(
  form,
  () => {
    if (!loading.value && form.value) {
      props.tab.dirty = JSON.stringify(form.value) !== baseline;
      message.value = "";
    }
  },
  { deep: true, flush: "sync" },
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const d = await api<any>("inspection-settings");
    version.value = d.version;
    templates.value = d.templates;
    bonusRules.value = d.bonus;
    pendingCount.value = d.pendingImprovements ?? 0;
    let row;
    if (kind === "grades") row = d.grades;
    else if (props.tab.recordId)
      row = (kind === "template" ? d.templates : d.bonus).find(
        (r: any) => r.id === props.tab.recordId,
      );
    else
      row =
        kind === "template"
          ? {
              section: "section_1",
              section_name:
                d.templates.find((r: any) => r.section === "section_1")
                  ?.section_name || "新區塊",
              section_order: 1,
              item_name: "",
              item_description: "",
              item_order: 1,
              max_score: 5,
              checklist_items: [],
              is_active: true,
            }
          : {
              day_from: 8,
              day_to: 10,
              bonus_score: 0,
              description: "",
              sort_order: d.bonus.length + 1,
              is_active: true,
            };
    if (!row) throw Error("找不到設定項目");
    form.value = JSON.parse(JSON.stringify(row));
    if (kind === "template") {
      form.value.item_description ||= "";
      form.value.checklist_items ||= [];
    }
    if (kind === "bonus") form.value.description ||= "";
    baseline = JSON.stringify(form.value);
    props.tab.dirty = false;
    props.tab.title = title.value;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function chooseSection(e: Event) {
  const row = sections.value.find(
    (s) => s.section === (e.target as HTMLSelectElement).value,
  );
  if (row) {
    form.value.section = row.section;
    form.value.section_name = row.section_name;
    form.value.section_order = row.section_order;
  }
}
async function save() {
  if (props.tab.busy || !form.value) return false;
  if (kind === "bonus") {
    // M4 Q7：啟用中的規則天數不能重疊（空缺允許）；伺服器端另有交易內檢查。
    if (Number(form.value.day_to) < Number(form.value.day_from)) {
      error.value = "結束天數不能小於起始天數";
      return false;
    }
    const clash = findBonusOverlap(bonusRules.value, {
      id: props.tab.recordId,
      day_from: Number(form.value.day_from),
      day_to: Number(form.value.day_to),
      is_active: !!form.value.is_active,
    });
    if (clash) {
      error.value = `啟用中的回補天數範圍不能重疊：與 ${clash.day_from}–${clash.day_to} 天的規則重疊，請先調整其中一條。`;
      return false;
    }
  }
  props.tab.busy = true;
  error.value = "";
  try {
    const payload = {
      kind,
      id: props.tab.recordId || null,
      version: version.value,
      data: form.value,
    };
    const serialized = JSON.stringify(payload);
    if (!pending || pending.serialized !== serialized)
      pending = { serialized, writeId: crypto.randomUUID() };
    const r = await api<any>("inspection-settings", {
      method: "POST",
      body: JSON.stringify({ ...payload, writeId: pending.writeId }),
    });
    version.value = r.version;
    if (r.id) props.tab.recordId = r.id;
    if (kind === "bonus") {
      const saved = { ...form.value, id: props.tab.recordId };
      bonusRules.value = [
        ...bonusRules.value.filter((x) => x.id !== saved.id),
        saved,
      ];
    }
    baseline = JSON.stringify(form.value);
    props.tab.dirty = false;
    pending = null;
    message.value = "設定已儲存";
    props.tab.title = title.value;
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function disable() {
  form.value.is_active = false;
  if (await save()) deactivate.value = false;
  else deactivate.value = false;
}
props.tab.save = save;
onMounted(load);
onBeforeUnmount(() => {
  props.tab.save = undefined;
});
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">巡店 / 管理設定</p>
      <h1>{{ title }}</h1>
    </div>
    <button @click="load" :disabled="loading || tab.dirty || tab.busy">
      重新載入
    </button>
  </header>
  <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
  <p v-if="loading" role="status">載入設定…</p>
  <form v-else-if="form" class="inspection-editor" @submit.prevent="save">
    <fieldset :disabled="tab.busy">
      <legend>{{ title }}</legend>
      <template v-if="kind === 'template'"
        ><label
          >沿用區塊<select aria-label="沿用區塊" @change="chooseSection">
            <option value="">選擇現有區塊，或自行填寫</option>
            <option v-for="s in sections" :key="s.section" :value="s.section">
              {{ s.section_name }}
            </option>
          </select></label
        >
        <div class="module-form-grid">
          <label
            >區塊代碼<input
              aria-label="區塊代碼"
              v-model="form.section"
              required
              maxlength="50" /></label
          ><label
            >區塊名稱<input
              aria-label="區塊名稱"
              v-model="form.section_name"
              required
              maxlength="100" /></label
          ><label
            >區塊排序<input
              aria-label="區塊排序"
              type="number"
              v-model.number="form.section_order"
              min="1"
              max="5"
              required /></label
          ><label
            >項目名稱<input
              aria-label="項目名稱"
              v-model="form.item_name"
              required
              maxlength="200" /></label
          ><label
            >項目排序<input
              aria-label="項目排序"
              type="number"
              v-model.number="form.item_order"
              min="0"
              max="9999"
              required /></label
          ><label
            >項目滿分<input
              aria-label="項目滿分"
              type="number"
              v-model.number="form.max_score"
              step="0.1"
              min="0.1"
              max="220"
              required
          /></label>
        </div>
        <label
          >檢查說明<textarea
            aria-label="檢查說明"
            v-model="form.item_description"
            maxlength="4000"
            rows="3"
            style="width: 100%"
          />
        </label>
        <h2>缺失與扣分</h2>
        <div class="module-table">
          <table>
            <thead>
              <tr>
                <th>缺失名稱</th>
                <th>扣分</th>
                <th>數量計算</th>
                <th>單位</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, i) in form.checklist_items" :key="i">
                <td>
                  <input
                    :aria-label="'缺失 ' + (Number(i) + 1) + ' 名稱'"
                    v-model="item.label"
                    required
                    maxlength="300"
                  />
                </td>
                <td>
                  <input
                    :aria-label="'缺失 ' + (Number(i) + 1) + ' 扣分'"
                    type="number"
                    v-model.number="item.deduction"
                    step="0.1"
                    min="0"
                    :max="form.max_score"
                    required
                  />
                </td>
                <td>
                  <input
                    :aria-label="'缺失 ' + (Number(i) + 1) + ' 依數量計分'"
                    type="checkbox"
                    v-model="item.requires_quantity"
                  />
                </td>
                <td>
                  <input
                    :aria-label="'缺失 ' + (Number(i) + 1) + ' 單位'"
                    v-model="item.unit"
                    maxlength="30"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    @click="form.checklist_items.splice(i, 1)"
                  >
                    移除缺失 {{ Number(i) + 1 }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          type="button"
          @click="
            form.checklist_items.push({
              label: '',
              deduction: 1,
              requires_quantity: false,
              unit: '',
            })
          "
        >
          新增缺失選項
        </button></template
      >
      <template v-else-if="kind === 'grades'"
        ><p>
          0 級最低分為 0；各評級最低分數需遞增。此次修改不批次重算已完成紀錄。
        </p>
        <div class="module-table">
          <table>
            <thead>
              <tr>
                <th>評級</th>
                <th>最低分數</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in form" :key="g.grade">
                <th>{{ g.grade }}</th>
                <td>
                  <input
                    :aria-label="'評級 ' + g.grade + ' 最低分數'"
                    type="number"
                    v-model.number="g.min_score"
                    step="0.1"
                    min="0"
                    max="220"
                    required
                    :readonly="g.grade === 0"
                  />
                </td>
              </tr>
            </tbody>
          </table></div
      ></template>
      <template v-else
        ><div class="module-form-grid">
          <label
            >起始天數<input
              aria-label="起始天數"
              type="number"
              v-model.number="form.day_from"
              min="0"
              max="3650"
              required /></label
          ><label
            >結束天數<input
              aria-label="結束天數"
              type="number"
              v-model.number="form.day_to"
              min="0"
              max="3650"
              required /></label
          ><label
            >回補比例（%）<input
              aria-label="回補比例"
              type="number"
              v-model.number="form.bonus_score"
              min="0"
              max="100"
              step="0.1"
              required /></label
          ><label
            >排序<input
              aria-label="規則排序"
              type="number"
              v-model.number="form.sort_order"
              min="0"
              max="9999"
              required
          /></label>
        </div>
        <label
          >規則說明<textarea
            aria-label="規則說明"
            v-model="form.description"
            maxlength="200"
            rows="3"
            style="width: 100%"
          />
        </label>
        <p class="muted">
          啟用規則的天數不可重疊（天數之間有空缺時，該天數回補 0）；新回報將按此比例計算。已回補完成的分數維持原紀錄。
          改善期限＝巡店日加上所有啟用規則中最大的天數，停用最長的規則後，日後新產生的改善期限會變短。
        </p>
        <p class="warn-notice" role="status" data-testid="bonus-impact">
          {{ bonusImpactNotice(pendingCount) }}
        </p></template
      >
      <label v-if="kind !== 'grades'"
        ><input type="checkbox" v-model="form.is_active" />啟用</label
      >
      <div class="dialog-actions">
        <button
          v-if="tab.recordId && kind !== 'grades' && form.is_active"
          type="button"
          class="danger"
          @click="deactivate = true"
        >
          停用{{ kind === "template" ? "項目" : "規則" }}</button
        ><button class="primary">
          {{ tab.busy ? "儲存中…" : "儲存設定" }}
        </button>
      </div>
    </fieldset>
  </form>
  <Modal
    v-if="deactivate"
    title="停用設定"
    :busy="tab.busy"
    @cancel="deactivate = false"
    ><p>停用後不再供新巡店或新回報使用，既有紀錄會保留。</p>
    <p v-if="kind === 'bonus'" class="warn-notice">
      {{ bonusImpactNotice(pendingCount) }}
    </p>
    <div class="dialog-actions">
      <button :disabled="tab.busy" @click="deactivate = false">取消</button
      ><button class="danger" :disabled="tab.busy" @click="disable">
        確認停用
      </button>
    </div></Modal
  >
</template>
