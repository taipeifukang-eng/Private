<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";

// G01 分類選擇器（設備、設施、料件共用）。舊版一次載入全部分類；新版改為搜尋（伺服端，含完整路徑）與逐層瀏覽，
// 不再受筆數限制。只列啟用中的分類；modelValue 是分類 id。
type Option = { id: string; name: string; code: string; path: string; child_count: number; is_active: boolean };
const props = withDefaults(defineProps<{ type: "equipment" | "facility" | "part"; modelValue: string; label?: string; disabled?: boolean; required?: boolean; error?: string }>(), { label: "分類", disabled: false, required: false });
const emit = defineEmits<{ "update:modelValue": [id: string]; select: [option: Option | null] }>();
const query = ref("");
const debounced = useDebounced(query, 250);
const options = ref<Option[]>([]);
const parent = ref<Option | null>(null); // 目前瀏覽到的上層
const total = ref(0);
const loading = ref(false);
const error = ref("");
const open = ref(false);
// 使用者有沒有主動操作過搜尋框（輸入文字、點選搜尋框或按「更換」）。對話框開啟時瀏覽器會自動把焦點放到第一個欄位（就是這個搜尋框），
// 那時已選分類的名稱還在載入；若把那次自動聚焦當成「要換分類」，名稱載入完成後也不會顯示。
// 不看按鍵：Tab、Enter 這類按鍵不代表要換分類（真的要找分類一定會輸入文字或點選）。
let touched = false;
const selected = ref<Option | null>(null);
const latest = useLatest();
const inputId = `cat-${crypto.randomUUID()}`;

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ type: props.type, active: "true", pageSize: "50" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    else if (parent.value) q.set("parentId", parent.value.id);
    const res = await api<{ data: Option[]; meta: { total: number } }>("general-affairs/categories?" + q);
    if (!latest.isLatest(n)) return;
    options.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    if (latest.isLatest(n)) error.value = (e as Error).message;
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
async function resolveSelected() {
  if (!props.modelValue) {
    selected.value = null;
    return;
  }
  if (selected.value?.id === props.modelValue) return;
  try {
    const res = await api<{ data: Option }>(`general-affairs/categories/${props.modelValue}?type=${props.type}`);
    selected.value = res.data;
    if (!touched && !query.value) open.value = false; // 只是自動聚焦展開的，名稱載入後收起來顯示已選分類
  } catch {
    selected.value = null;
  }
}
function choose(o: Option) {
  touched = true;
  selected.value = o;
  emit("update:modelValue", o.id);
  emit("select", o);
  open.value = false;
  query.value = "";
}
function clear() {
  selected.value = null;
  emit("update:modelValue", "");
  emit("select", null);
}
function browse(o: Option) {
  parent.value = o;
  query.value = "";
}
function up() {
  parent.value = null;
  query.value = "";
}
watch([debounced, parent], () => open.value && load());
watch(open, (v) => v && load());
watch(() => props.modelValue, resolveSelected);
onMounted(resolveSelected);
</script>

<template>
  <div class="cat-picker" @focusout="(e: FocusEvent) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && (open = false)">
    <label :for="inputId">{{ label }}<span v-if="required" class="required"> 必填</span></label>
    <div v-if="selected && !open" class="cat-selected">
      <span><strong>{{ selected.name }}</strong><small class="muted"> {{ selected.path }}</small></span>
      <span class="cat-actions">
        <button type="button" :disabled="disabled" @click="touched = true; open = true">更換</button>
        <button v-if="!required" type="button" :disabled="disabled" @click="clear">清除</button>
      </span>
    </div>
    <input
      v-else
      :id="inputId"
      v-model="query"
      type="search"
      role="combobox"
      :aria-expanded="open"
      aria-autocomplete="list"
      :disabled="disabled"
      :placeholder="'搜尋或瀏覽' + label + '（名稱、代碼）'"
      @focus="open = true"
      @input="touched = true"
      @pointerdown="touched = true"
    />
    <div v-if="open" class="cat-pop" role="listbox" :aria-label="label + '選項'">
      <div v-if="parent && !debounced.trim()" class="cat-crumb">
        <button type="button" @click="up">← 回最上層</button><span class="muted">{{ parent.path }}</span>
        <button type="button" class="pick-parent" @click="choose(parent)">選「{{ parent.name }}」本身</button>
      </div>
      <p v-if="loading" class="muted cat-note" role="status">載入中…</p>
      <p v-else-if="error" class="field-error cat-note" role="alert">{{ error }}</p>
      <p v-else-if="!options.length" class="muted cat-note">找不到符合的{{ label }}。</p>
      <ul v-else>
        <li v-for="o in options" :key="o.id" role="option" :aria-selected="o.id === modelValue">
          <button type="button" class="cat-opt" @click="choose(o)"><strong>{{ o.name }}</strong><small class="muted"> {{ o.code }}　{{ o.path !== o.name ? o.path : "" }}</small></button>
          <button v-if="o.child_count && !debounced.trim()" type="button" class="cat-more" :aria-label="'展開 ' + o.name + ' 的子分類'" @click="browse(o)">子分類 ({{ o.child_count }}) ›</button>
        </li>
      </ul>
      <p v-if="total > options.length" class="muted cat-note">共 {{ total }} 筆，只顯示前 {{ options.length }} 筆，請輸入關鍵字縮小範圍。</p>
    </div>
    <small v-if="selected && !open && selected.is_active === false && type !== 'part'" class="cat-inactive muted" role="status" data-testid="category-inactive-hint">這個分類已停用：不換分類仍可儲存其他欄位；要換分類只能選啟用中的分類。</small>
    <span v-if="error && !open" class="field-error">{{ error }}</span>
    <span v-if="props.error" class="field-error" role="alert">{{ props.error }}</span>
  </div>
</template>

<style scoped>
.cat-picker { position: relative; }
.cat-selected { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--line); border-radius: 5px; padding: 6px 10px; background: var(--surface); }
.cat-selected small { display: block; }
.cat-inactive { display: block; margin-top: 4px; }
.cat-actions { display: flex; gap: 6px; }
.cat-actions button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.cat-pop { position: absolute; z-index: 20; inset: calc(100% + 4px) 0 auto; max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: 0 8px 20px #0002; padding: 6px; }
.cat-pop ul { list-style: none; margin: 0; padding: 0; }
.cat-pop li { display: flex; align-items: stretch; gap: 4px; }
.cat-opt { flex: 1; text-align: left; border: 0; background: none; white-space: normal; padding: 7px 8px; }
.cat-opt small { display: block; }
.cat-more { border: 0; font-size: 12px; min-height: 0; color: var(--primary); }
.cat-crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 4px 4px 8px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
.cat-crumb button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.cat-note { margin: 6px 8px; font-size: 12px; }
</style>
