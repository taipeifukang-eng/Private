<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import { errorText, type PaymentRequest } from "../../lib/ga-payments";
import { PRINT_FIELD_LIMITS, UNIT_MAX_LEN, buildPaperPrint } from "../../../../lib/workspace/general-affairs/payment-print-rules";

// 請款單紙本列印欄位（申請部門、申請人、檢附單據、申請事由）：獨立儲存，不影響請款單草稿的版本。
// 需請款管理權限；除了已作廢，已送出與已付款也能改（只影響列印字樣，不動金額與狀態）。欄位留白＝列印時用系統預設值。
const props = defineProps<{ pr: PaymentRequest; canManage: boolean; testPrefix: string }>();
const emit = defineEmits<{ (e: "saved", pr: PaymentRequest): void }>();
const dept = ref("");
const name = ref("");
const docs = ref("");
const reason = ref("");
const busy = ref(false);
const error = ref("");
const done = ref("");
const utility = computed(() => props.pr.source === "UTILITY");
const editable = computed(() => props.canManage && props.pr.status !== "VOID");
// 使用單位逐列可改：列出列印出來的資料列（項次、預設使用單位、可改的輸入框）。預設值需要門市簡稱與帳單備註，所以另外讀一次列印補充資料。
type PrintExtra = Parameters<typeof buildPaperPrint>[1];
const extra = ref<PrintExtra>(null);
async function loadExtra() {
  try {
    const r = await api<{ print_extra?: PrintExtra }>(`general-affairs/payment-requests/${props.pr.id}`);
    extra.value = r.print_extra ?? null;
  } catch { extra.value = null; }
}
onMounted(loadExtra);
watch(() => props.pr.id, loadExtra);
const unitRows = computed(() => buildPaperPrint(props.pr, extra.value, null).rows.filter((r) => r.key !== ""));
const units = ref<Record<string, string>>({});
function load() {
  units.value = { ...(props.pr.print_units || {}) };
  dept.value = props.pr.applicant_dept || "";
  name.value = props.pr.applicant_name || "";
  docs.value = props.pr.attach_docs || "";
  reason.value = props.pr.reason_override || "";
}
watch(() => [props.pr.id, props.pr.applicant_dept, props.pr.applicant_name, props.pr.attach_docs, props.pr.reason_override, JSON.stringify(props.pr.print_units || {})], load, { immediate: true });
const dirty = computed(() => dept.value.trim() !== (props.pr.applicant_dept || "") || name.value.trim() !== (props.pr.applicant_name || "") || docs.value.trim() !== (props.pr.attach_docs || "") || reason.value.trim() !== (props.pr.reason_override || "") || unitsChanged());
const savedUnit = (k: string) => (props.pr.print_units || {})[k] || "";
function unitsChanged() {
  const keys = new Set([...unitRows.value.map((r) => r.key), ...Object.keys(props.pr.print_units || {})]);
  for (const k of keys) if ((units.value[k] ?? "").trim() !== savedUnit(k) && (unitRows.value.some((r) => r.key === k) || savedUnit(k))) return true;
  return false;
}
// 送出：目前每一列的值（空白＝清除覆寫）；已不存在的舊列一併清掉。
function unitsPayload() {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(props.pr.print_units || {})) out[k] = null;
  for (const r of unitRows.value) out[r.key] = (units.value[r.key] ?? "").trim() || null;
  return out;
}
async function save() {
  if (busy.value || !editable.value) return;
  busy.value = true; error.value = ""; done.value = "";
  try {
    const res = await api<{ data: PaymentRequest }>(`general-affairs/payment-requests/${props.pr.id}/print-fields`, {
      method: "PATCH",
      body: JSON.stringify({ applicant_dept: dept.value.trim() || null, applicant_name: name.value.trim() || null, attach_docs: docs.value.trim() || null, reason_override: reason.value.trim() || null, units: unitsPayload() }),
    });
    done.value = "已儲存列印欄位。";
    emit("saved", res.data);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const tid = (s: string) => `${props.testPrefix}-pf-${s}`;
</script>

<template>
  <section class="pf-box" :data-testid="tid('box')">
    <h2>列印欄位</h2>
    <p class="muted">「列印請款單」紙本表頭會印這些欄位；留白就用系統預設值。{{ editable ? "已送出或已付款也能修改，修改只影響列印字樣，並記錄在操作紀錄。" : "" }}</p>
    <div class="pf-grid">
      <label>申請部門<input v-model="dept" :maxlength="PRINT_FIELD_LIMITS.applicant_dept" :disabled="!editable" :placeholder="'留白＝建立人所屬部門'" :data-testid="tid('dept')" /></label>
      <label>申請人<input v-model="name" :maxlength="PRINT_FIELD_LIMITS.applicant_name" :disabled="!editable" :placeholder="'留白＝建立人（' + (pr.created_by_name || '—') + '）'" :data-testid="tid('name')" /></label>
      <label>檢附單據<input v-model="docs" :maxlength="PRINT_FIELD_LIMITS.attach_docs" :disabled="!editable" :placeholder="utility ? '留白＝繳費單' : '留白＝發票'" :data-testid="tid('docs')" /></label>
      <label>申請事由<input v-model="reason" :maxlength="PRINT_FIELD_LIMITS.reason_override" :disabled="!editable" :placeholder="utility ? '留白＝帳單月份加費用類型，例 115年11月電費' : '留白＝採購單號加品名'" :data-testid="tid('reason')" /></label>
    </div>
    <div v-if="unitRows.length" class="pf-units" :data-testid="tid('units')">
      <table>
        <caption>使用單位（每一列可以單獨修改；留白＝{{ utility ? "門市簡稱，有帳單備註會接在後面" : "空白" }}）</caption>
        <thead><tr><th>項次</th><th>預設使用單位</th><th>列印的使用單位</th></tr></thead>
        <tbody>
          <tr v-for="r in unitRows" :key="r.key" :data-testid="tid('unit-row')">
            <td class="no">{{ r.no }}</td>
            <td class="def">{{ r.defaultUnit || "（空白）" }}</td>
            <td><input v-model="units[r.key]" :maxlength="UNIT_MAX_LEN" :disabled="!editable" :placeholder="r.defaultUnit || '留白＝空白'" :aria-label="'第 ' + r.no + ' 列使用單位'" :data-testid="tid('unit-' + r.no)" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="reason.trim()" class="muted">填了申請事由，紙本每一列都會印這句話（不再自動加月份與電號數）。</p>
    <p v-if="error" class="notice error" role="alert" :data-testid="tid('error')">{{ error }}</p>
    <p v-if="done && !dirty" class="notice success" role="status" :data-testid="tid('done')">{{ done }}</p>
    <div v-if="editable"><button type="button" :disabled="busy || !dirty" :data-testid="tid('save')" @click="save">儲存列印欄位</button></div>
  </section>
</template>

<style scoped>
.pf-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; margin-bottom: 14px; }
.pf-box h2 { margin: 0; font-size: 16px; }
.pf-box p { margin: 0; overflow-wrap: anywhere; }
.pf-box label { display: grid; gap: 4px; min-width: 0; }
.pf-units { overflow-x: auto; }
.pf-units table { width: 100%; border-collapse: collapse; font-size: 14px; }
.pf-units caption { text-align: left; color: var(--muted, #666); padding-bottom: 4px; }
.pf-units th, .pf-units td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
.pf-units .no { width: 56px; text-align: center; }
.pf-units .def { color: var(--muted, #666); overflow-wrap: anywhere; }
.pf-units input { width: 100%; box-sizing: border-box; }
.pf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
</style>
