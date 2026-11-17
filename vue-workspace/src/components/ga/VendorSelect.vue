<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../../api";
import { useDebounced, useLatest } from "../../lib/ga";
import { errorText, vendorDisplayName } from "../../lib/ga-vendors";

// 工單進度表單的廠商下拉（僅總務端）：只列合作中的廠商（顯示聯絡人與電話），不能新選暫停或停用的廠商；
// 工單目前已綁定的廠商另外顯示（已停用／暫停也照實標示），留白代表不修改（進度存檔只在有選時才更新廠商，不會清掉原本的）。
const props = defineProps<{ modelValue: string; currentId?: string | null; disabled?: boolean; testid?: string }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();
type Opt = { id: string; name: string; alias: string | null; status: string; contact_name: string | null; contact_phone: string | null };
const items = ref<Opt[]>([]);
const current = ref<Opt | null>(null);
const q = ref("");
const debounced = useDebounced(q, 300);
const error = ref("");
const loading = ref(false);
const latest = useLatest();

async function loadCurrent() {
  current.value = null;
  if (!props.currentId) return;
  try {
    const res = await api<{ data: Opt[] }>(`general-affairs/vendor-options?onlyIds=1&includeIds=${props.currentId}`);
    current.value = res.data.find((v) => v.id === props.currentId) || null;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function load() {
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ page: "1", pageSize: "100" });
    if (debounced.value.trim()) qs.set("q", debounced.value.trim());
    const res = await api<{ data: Opt[] }>("general-affairs/vendor-options?" + qs);
    if (latest.isLatest(n)) items.value = res.data.filter((v) => v.status === "active");
  } catch (e) {
    if (latest.isLatest(n)) { items.value = []; error.value = errorText(e); }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
onMounted(() => { void load(); void loadCurrent(); });
watch(debounced, () => void load());
const label = (v: Opt) => v.name + (v.contact_name || v.contact_phone ? `（${[v.contact_name, v.contact_phone].filter(Boolean).join(" ")}）` : "");
</script>

<template>
  <div class="vs" data-testid="vendor-select">
    <p class="muted vs-current" data-testid="vs-current">目前廠商：<strong v-if="current">{{ vendorDisplayName(current.name, current.status) }}</strong><template v-else-if="currentId">（讀取中或無權限查看名稱）</template><template v-else>尚未指定</template>；留白＝不修改</p>
    <label>改選廠商（只列合作中；選填）
      <input v-model="q" type="search" placeholder="搜尋廠商名稱" :disabled="disabled" data-testid="vs-search" />
      <select :value="modelValue" :disabled="disabled" :data-testid="testid || 'f-vendor'" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option value="">（不修改）</option>
        <option v-for="v in items" :key="v.id" :value="v.id">{{ label(v) }}</option>
      </select>
    </label>
    <p v-if="loading" class="muted" role="status">載入廠商…</p>
    <p v-if="error" class="field-error" role="alert" data-testid="vs-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.vs { display: grid; gap: 4px; min-width: 0; }
.vs label { display: grid; gap: 4px; }
.vs-current { margin: 0; overflow-wrap: anywhere; }
</style>
