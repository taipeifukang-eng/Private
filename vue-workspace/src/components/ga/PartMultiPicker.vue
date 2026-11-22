<script setup lang="ts">
import { ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";

// 料件多選：伺服端搜尋與分頁（只列啟用中的料件），已選的料件以標籤顯示。用在型號／架型的「適用料件」與適用料件設定頁。
export type PickedPart = { id: string; name: string; part_code?: string | null; brand?: string | null; model?: string | null; specification?: string | null; base_unit?: string };
const selected = defineModel<PickedPart[]>({ required: true });
defineProps<{ disabled?: boolean }>();
const query = ref("");
const debounced = useDebounced(query, 300);
const results = ref<PickedPart[]>([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const loading = ref(false);
const error = ref("");
const latest = useLatest();

async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ isActive: "true", page: String(page.value), pageSize: "8" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    const res = await api<{ data: PickedPart[]; meta: { total: number; totalPages: number } }>("general-affairs/parts?" + q);
    if (!latest.isLatest(n)) return;
    results.value = res.data;
    total.value = res.meta.total;
    pages.value = res.meta.totalPages;
  } catch (e) {
    if (latest.isLatest(n)) error.value = (e as Error).message;
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
const picked = (id: string) => selected.value.some((p) => p.id === id);
function add(p: PickedPart) {
  if (!picked(p.id)) selected.value = [...selected.value, { id: p.id, name: p.name, part_code: p.part_code, brand: p.brand, model: p.model, specification: p.specification, base_unit: p.base_unit }];
}
function remove(id: string) {
  selected.value = selected.value.filter((p) => p.id !== id);
}
watch(debounced, () => { page.value = 1; load(); });
watch(page, load);
load();
</script>

<template>
  <div class="part-multi">
    <ul v-if="selected.length" class="chips" aria-label="已選料件">
      <li v-for="p in selected" :key="p.id">
        <span>{{ p.name }}<small v-if="p.part_code"> {{ p.part_code }}</small></span>
        <button type="button" class="icon-button" :disabled="disabled" :aria-label="'移除 ' + p.name" @click="remove(p.id)"><X :size="13" /></button>
      </li>
    </ul>
    <p v-else class="muted">尚未選擇料件。</p>
    <label>加入料件<input v-model="query" type="search" :disabled="disabled" placeholder="搜尋名稱、代碼、品牌、型號、規格" /></label>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted" role="status">搜尋中…</p>
    <ul v-else class="results" aria-label="料件搜尋結果">
      <li v-for="p in results" :key="p.id">
        <span><strong>{{ p.name }}</strong><small>{{ [p.part_code, p.brand, p.model, p.specification].filter(Boolean).join(" / ") }}</small></span>
        <button type="button" :disabled="disabled || picked(p.id)" @click="add(p)">{{ picked(p.id) ? "已加入" : "加入" }}</button>
      </li>
      <li v-if="!results.length" class="muted">找不到符合的啟用中料件。</li>
    </ul>
    <div v-if="pages > 1" class="pager">
      <button type="button" :disabled="page <= 1" @click="page--">上一頁</button>
      <span class="muted">{{ page }} / {{ pages }}（共 {{ total }} 筆）</span>
      <button type="button" :disabled="page >= pages" @click="page++">下一頁</button>
    </div>
  </div>
</template>

<style scoped>
.part-multi { display: grid; gap: 10px; }
.part-multi label { display: grid; gap: 4px; }
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chips li { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--soft); border-radius: 14px; padding: 2px 4px 2px 10px; }
.chips small { color: var(--muted); }
.chips .icon-button { min-height: 24px; padding: 2px 5px; border: 0; background: none; }
.results { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 6px; }
.results li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--line); }
.results li:last-child { border-bottom: 0; }
.results small { display: block; color: var(--muted); }
.results button, .pager button { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
</style>
