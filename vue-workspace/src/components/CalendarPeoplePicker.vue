<script setup lang="ts">
// 分享對象搜尋（舊版 PeoplePicker）：輸入至少 2 個字，用姓名或員編搜尋；M5 Q18 起搜尋結果不含已停用與離職人員。
import { ref, watch, onBeforeUnmount } from "vue";
import { api } from "../api";

export type Person = { id: string; name: string; employee_code: string | null };
const props = defineProps<{ selected: Person[]; label?: string }>();
const emit = defineEmits<{ change: [people: Person[]] }>();
const query = ref("");
const results = ref<Person[]>([]);
const loading = ref(false);
const searched = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

watch(query, (value) => {
  clearTimeout(timer);
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    results.value = [];
    loading.value = false;
    searched.value = false;
    return;
  }
  timer = setTimeout(async () => {
    const mine = ++seq;
    loading.value = true;
    try {
      const data = await api<{ people: Person[] }>(`calendar/people?q=${encodeURIComponent(trimmed)}`);
      if (mine === seq) results.value = data.people || [];
    } catch {
      if (mine === seq) results.value = [];
    } finally {
      if (mine === seq) {
        loading.value = false;
        searched.value = true;
      }
    }
  }, 250);
});
onBeforeUnmount(() => clearTimeout(timer));

const available = () => results.value.filter((p) => !props.selected.some((s) => s.id === p.id));
function pick(person: Person) {
  emit("change", [...props.selected, person]);
  query.value = "";
  results.value = [];
  searched.value = false;
}
</script>

<template>
  <div class="people-picker" data-testid="people-picker">
    <label>
      {{ label || "分享對象" }}
      <input v-model="query" placeholder="搜尋姓名或員編（至少 2 個字）" autocomplete="off" />
    </label>
    <div v-if="selected.length" class="chips">
      <span v-for="p in selected" :key="p.id" class="chip">
        {{ p.name }}{{ p.employee_code ? ` · ${p.employee_code}` : "" }}
        <button type="button" :aria-label="`移除 ${p.name}`" @click="emit('change', selected.filter((s) => s.id !== p.id))">×</button>
      </span>
    </div>
    <ul v-if="available().length" class="results" role="listbox" :aria-label="`${label || '分享對象'}搜尋結果`">
      <li v-for="p in available()" :key="p.id">
        <button type="button" @click="pick(p)">
          <strong>{{ p.name }}</strong><small>{{ p.employee_code || "無員編" }}</small>
        </button>
      </li>
    </ul>
    <p v-if="loading" class="muted" role="status">搜尋中…</p>
    <p v-else-if="searched && !available().length" class="muted">沒有符合的人員（已停用或離職的人不會出現）</p>
  </div>
</template>

<style scoped>
.people-picker { display: grid; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--soft); font-size: 13px; }
.chip button { min-height: 22px; padding: 0 6px; border: 0; background: transparent; }
.results { list-style: none; margin: 0; padding: 0; max-height: 180px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.results button { display: flex; justify-content: space-between; width: 100%; border: 0; border-radius: 0; background: transparent; text-align: left; }
.results small { color: var(--muted); }
p { margin: 0; }
</style>
