<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";

// 採購單選擇器：供應商（只列已建好且合作中的）、料件、位置、設備型號、門市。搜尋＋分頁（每次 20 筆，「顯示更多」），不一次載入全部。
const props = defineProps<{
  modelValue: string;
  kind: "vendor" | "part" | "location" | "template" | "store";
  label: string;
  testid?: string;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  initial?: any | null;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [string]; pick: [any | null] }>();
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
const textOf = (it: any) => {
  if (!it) return "";
  if (props.kind === "vendor") return it.alias ? `${it.name}（${it.alias}）` : it.name;
  if (props.kind === "part") return `${it.name}${it.part_code ? "（" + it.part_code + "）" : ""}`;
  if (props.kind === "location") return `${it.name}${it.code ? "（" + it.code + "）" : ""}`;
  if (props.kind === "template") return [it.name, it.brand, it.model].filter(Boolean).join(" / ");
  return `${it.short_name || it.store_name}（${it.store_code}）`;
};
const sub = (it: any) => {
  if (props.kind === "vendor") return [it.tax_id ? "統編 " + it.tax_id : "", it.payment_terms || ""].filter(Boolean).join("　");
  if (props.kind === "part") return [it.brand, it.model, it.specification, it.equipment_template ? "可轉設備型號：" + it.equipment_template.name : ""].filter(Boolean).join(" / ");
  if (props.kind === "location") return it.is_default ? "預設位置" : "";
  return "";
};
async function load(append = false) {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: "20" });
    if (debounced.value.trim()) qs.set("search", debounced.value.trim());
    const path = props.kind === "vendor" ? "general-affairs/purchase-orders/vendor-options?" : `general-affairs/purchase-orders/options?type=${props.kind}&`;
    const res = await api<{ data: any[]; total: number }>(path + qs);
    if (!latest.isLatest(n)) return;
    items.value = append ? [...items.value, ...res.data] : res.data;
    total.value = res.total;
  } catch (e) {
    if (latest.isLatest(n)) { items.value = append ? items.value : []; error.value = (e as Error).message; }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch(debounced, () => { page.value = 1; if (open.value) void load(); });
watch(() => props.initial, (v) => { if (v) selected.value = v; }, { immediate: true });
watch(() => props.modelValue, (v) => { if (!v) selected.value = null; });
function openList() { if (props.disabled) return; open.value = true; page.value = 1; void load(); }
function choose(it: any) { selected.value = it; open.value = false; emit("update:modelValue", it.id); emit("pick", it); }
function clear() { selected.value = null; q.value = ""; emit("update:modelValue", ""); emit("pick", null); }
const more = () => { page.value += 1; void load(true); };
const hasMore = computed(() => items.value.length < total.value);
const inputId = `pp-${Math.random().toString(36).slice(2, 8)}`;
const tid = computed(() => props.testid || `pp-${props.kind}`);
</script>

<template>
  <div class="po-picker">
    <span class="pk-label" :id="inputId + '-l'">{{ label }}<em v-if="required" class="req"> *</em></span>
    <div v-if="selected" class="pk-picked" :data-testid="tid + '-picked'">
      <span :data-testid="tid + '-text'">{{ textOf(selected) }}</span>
      <button v-if="!disabled" type="button" :data-testid="tid + '-clear'" @click="clear">{{ clearable ? "清除" : "更換" }}</button>
    </div>
    <template v-else>
      <input :id="inputId" v-model="q" type="search" :data-testid="tid" :disabled="disabled" :aria-labelledby="inputId + '-l'" :placeholder="placeholder || '輸入關鍵字搜尋，或點一下看清單'" autocomplete="off" @focus="openList" @click="openList" />
      <div v-if="open" class="pk-pop">
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <ul class="pk-list" role="listbox" :aria-label="label + '選項'">
          <li v-for="it in items" :key="it.id" role="option">
            <button type="button" class="pk-item" :data-testid="tid + '-option'" @click="choose(it)"><strong>{{ textOf(it) }}</strong><small v-if="sub(it)">{{ sub(it) }}</small></button>
          </li>
          <li v-if="!items.length && !loading && !error" class="pk-empty">{{ kind === "vendor" ? "找不到合作中的供應商（請先到舊版廠商管理頁新增）" : "找不到符合的項目" }}</li>
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
.po-picker { display: grid; gap: 4px; position: relative; min-width: 0; }
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
