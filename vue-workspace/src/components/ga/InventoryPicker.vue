<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";
import { fmtNum, locationText, partText } from "../../lib/ga-inventory-stock";

// 庫存選擇器（位置、料件、位置的料件設定）：搜尋＋分頁（每次 20 筆，「顯示更多」），避免舊版一次載入上千筆被截斷。
// kind=locations：啟用中的位置；parts：啟用中的料件（篩選用）；location-parts：指定位置已設定的料件（過帳用，顯示目前庫存）。
const props = defineProps<{
  modelValue: string;
  kind: "locations" | "parts" | "location-parts";
  label: string;
  locationId?: string;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [string]; pick: [any | null]; message: [string] }>();

const q = ref("");
const debounced = useDebounced(q, 300);
const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref("");
const selected = ref<any | null>(null);
const open = ref(false);
const latest = useLatest();
const message = ref("");

const textOf = (it: any) => {
  if (props.kind === "locations") return locationText(it, it.store);
  if (props.kind === "parts") return partText(it);
  return partText(it.part);
};
const sub = (it: any) => {
  if (props.kind === "location-parts") return `目前庫存 ${fmtNum(it.currentBalance?.quantity_base ?? 0)} ${it.part?.base_unit || ""}`;
  if (props.kind === "parts") return it.base_unit || "";
  return it.is_default ? "預設位置" : "";
};
const idOf = (it: any) => (props.kind === "location-parts" ? it.part_id : it.id);

async function load(append = false) {
  if (props.kind === "location-parts" && !props.locationId) { items.value = []; total.value = 0; return; }
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ type: props.kind, page: String(page.value), pageSize: "20" });
    if (debounced.value.trim()) qs.set("search", debounced.value.trim());
    if (props.kind === "location-parts") qs.set("locationId", props.locationId!);
    const res = await api<{ data: any[]; total: number; message?: string; partCatalogAccess?: boolean }>("general-affairs/inventory/options?" + qs);
    if (!latest.isLatest(n)) return;
    items.value = append ? [...items.value, ...res.data] : res.data;
    total.value = res.total;
    message.value = res.message || "";
    if (res.message) emit("message", res.message);
  } catch (e) {
    if (latest.isLatest(n)) { items.value = append ? items.value : []; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch(debounced, () => { page.value = 1; if (open.value) load(); });
watch(() => props.locationId, () => { selected.value = null; emit("update:modelValue", ""); emit("pick", null); items.value = []; page.value = 1; q.value = ""; if (open.value) load(); });
watch(() => props.modelValue, (v) => { if (!v) selected.value = null; });
function openList() {
  if (props.disabled) return;
  open.value = true;
  page.value = 1;
  void load();
}
function choose(it: any) {
  selected.value = it;
  open.value = false;
  emit("update:modelValue", idOf(it));
  emit("pick", it);
}
function clear() {
  selected.value = null;
  q.value = "";
  emit("update:modelValue", "");
  emit("pick", null);
}
function more() { page.value += 1; void load(true); }
const hasMore = computed(() => items.value.length < total.value);
const inputId = `pk-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <div class="inv-picker">
    <span class="pk-label" :id="inputId + '-l'">{{ label }}<em v-if="required" class="req"> *</em></span>
    <div v-if="selected" class="pk-picked" data-testid="picker-picked">
      <span>{{ textOf(selected) }}</span>
      <button v-if="!disabled" type="button" @click="clear">{{ clearable ? "清除" : "更換" }}</button>
    </div>
    <template v-else>
      <input :id="inputId" v-model="q" type="search" :disabled="disabled" :aria-labelledby="inputId + '-l'" :placeholder="placeholder || '輸入關鍵字搜尋，或點一下看清單'" autocomplete="off" @focus="openList" @click="openList" />
      <div v-if="open" class="pk-pop">
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <p v-else-if="message" class="notice" role="status">{{ message }}</p>
        <ul class="pk-list" role="listbox" :aria-label="label + '選項'">
          <li v-for="it in items" :key="idOf(it)" role="option">
            <button type="button" class="pk-item" @click="choose(it)"><strong>{{ textOf(it) }}</strong><small v-if="sub(it)">{{ sub(it) }}</small></button>
          </li>
          <li v-if="!items.length && !loading && !error" class="pk-empty">{{ kind === "location-parts" && !locationId ? "請先選擇位置" : "找不到符合的項目" }}</li>
        </ul>
        <div class="pk-foot">
          <span class="muted">共 {{ total }} 筆<template v-if="loading">，載入中…</template></span>
          <button v-if="hasMore && !loading" type="button" @click="more">顯示更多</button>
          <button type="button" @click="open = false">收起</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.inv-picker { display: grid; gap: 4px; position: relative; min-width: 0; }
.pk-label { font-size: 13px; }
.req { color: var(--danger, #b3261e); font-style: normal; }
.pk-picked { display: flex; gap: 8px; align-items: center; justify-content: space-between; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; background: var(--surface); min-height: 40px; overflow-wrap: anywhere; }
.pk-picked button { flex: none; min-height: 30px; padding: 3px 10px; font-size: 12px; }
.pk-pop { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); max-height: 300px; overflow: auto; padding: 6px; display: grid; gap: 6px; }
.pk-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.pk-item { display: grid; gap: 2px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 6px; min-height: 40px; overflow-wrap: anywhere; }
.pk-item:hover, .pk-item:focus-visible { background: var(--soft); }
.pk-item small { color: var(--muted); }
.pk-empty { text-align: center; color: var(--muted); padding: 10px; }
.pk-foot { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.pk-foot button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
</style>
