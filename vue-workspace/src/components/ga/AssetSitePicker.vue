<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { MapPin } from "lucide-vue-next";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";

// G01 門市／地點選擇器。舊版把全部據點一次載入、在瀏覽器內過濾；新版改為伺服端搜尋與分頁（代碼、名稱、簡稱），不受筆數限制。
// type=store：門市（scope=mine 只列自己被指派的門市）；type=location：庫存位置。modelValue 是 id。
type Site = { id: string; store_code?: string; store_name?: string; short_name?: string | null; code?: string; name?: string };
const props = withDefaults(
  defineProps<{ modelValue: string; type?: "store" | "location"; scope?: "all" | "mine"; label?: string; required?: boolean; disabled?: boolean; error?: string }>(),
  { type: "store", scope: "all", label: "所在據點", required: false, disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [id: string]; select: [site: Site | null] }>();
const query = ref("");
const debounced = useDebounced(query, 250);
const rows = ref<Site[]>([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const loading = ref(false);
const error = ref("");
const open = ref(false);
const selected = ref<Site | null>(null);
const latest = useLatest();
const inputId = `site-${crypto.randomUUID()}`;
const siteText = (s: Site) => (props.type === "store" ? `${s.store_code} ${s.short_name || s.store_name}` : `${s.code} ${s.name}`);

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ type: props.type, scope: props.scope, page: String(page.value), pageSize: "20" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    const res = await api<{ data: Site[]; meta: { total: number; totalPages: number } }>("general-affairs/sites?" + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.meta.total;
    pages.value = res.meta.totalPages;
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
  // 已選的據點可能不在目前這一頁，用 id 找不到時至少顯示 id 的一部分，不影響送出。
  const found = rows.value.find((r) => r.id === props.modelValue);
  selected.value = found || { id: props.modelValue, store_code: props.modelValue.slice(0, 8), store_name: "", code: props.modelValue.slice(0, 8), name: "" };
}
function clear() {
  selected.value = null;
  emit("update:modelValue", "");
  emit("select", null);
}
function choose(s: Site) {
  selected.value = s;
  emit("update:modelValue", s.id);
  emit("select", s);
  open.value = false;
  query.value = "";
}
watch(debounced, () => {
  page.value = 1;
  open.value && load();
});
watch(page, () => open.value && load());
watch(open, (v) => v && load());
watch(() => props.modelValue, resolveSelected);
onMounted(resolveSelected);
</script>

<template>
  <div class="site-picker" @focusout="(e: FocusEvent) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && (open = false)">
    <label :for="inputId">{{ label }}<span v-if="required" class="required"> 必填</span></label>
    <input
      :id="inputId"
      v-model="query"
      type="search"
      role="combobox"
      :aria-expanded="open"
      :disabled="disabled"
      :placeholder="type === 'store' ? '搜尋據點代碼、名稱或簡稱' : '搜尋位置代碼或名稱'"
      @focus="open = true"
    />
    <p v-if="selected" class="site-chosen"><MapPin :size="13" /> {{ siteText(selected) }}<button v-if="!required" type="button" class="site-clear" :disabled="disabled" aria-label="清除據點" @click="clear">清除</button></p>
    <div v-if="open" class="site-pop" role="listbox" :aria-label="label + '選項'">
      <p v-if="loading" class="muted site-note" role="status">載入中…</p>
      <p v-else-if="error" class="field-error site-note" role="alert">{{ error }}</p>
      <p v-else-if="!rows.length" class="muted site-note">找不到符合的{{ type === "store" ? "據點" : "位置" }}，請確認資料是否已建立。</p>
      <ul v-else>
        <li v-for="s in rows" :key="s.id" role="option" :aria-selected="s.id === modelValue"><button type="button" @click="choose(s)">{{ siteText(s) }}</button></li>
      </ul>
      <div v-if="pages > 1" class="site-pager">
        <button type="button" :disabled="page <= 1" @click="page--">上一頁</button>
        <span class="muted">{{ page }} / {{ pages }}（共 {{ total }} 筆）</span>
        <button type="button" :disabled="page >= pages" @click="page++">下一頁</button>
      </div>
    </div>
    <span v-if="props.error" class="field-error" role="alert">{{ props.error }}</span>
  </div>
</template>

<style scoped>
.site-picker { position: relative; }
.site-chosen { display: flex; align-items: center; gap: 6px; margin: 6px 0 0; padding: 5px 10px; border-radius: 5px; background: var(--soft); font-size: 12px; font-weight: 600; }
.site-clear { margin-left: auto; min-height: 24px; padding: 0 8px; font-size: 11px; }
.site-pop { position: absolute; z-index: 20; inset: calc(100% + 4px) 0 auto; max-height: 300px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: 0 8px 20px #0002; padding: 6px; }
.site-pop ul { list-style: none; margin: 0; padding: 0; }
.site-pop li button { width: 100%; text-align: left; border: 0; background: none; white-space: normal; }
.site-note { margin: 6px 8px; font-size: 12px; }
.site-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 4px 2px; border-top: 1px solid var(--line); margin-top: 4px; }
.site-pager button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
</style>
