<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PartMultiPicker, { type PickedPart } from "../../components/ga/PartMultiPicker.vue";
import { useDebounced, useGaGuard, useLatest } from "../../lib/ga";
import type { WorkTab } from "../../stores";

// G05 適用料件對照：選一個設備型號或設施架型，設定它適用哪些料件。
// 沿用舊版「整批取代」語意，但改為失敗全部回復；載入後若被他人改過，儲存時提示重新載入（不會蓋掉別人的修改）。
// 舊版「廠商系列／品牌型號」相容性畫面完全沒人用，不復刻。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
type Kind = "equipment" | "facility";
const kind = ref<Kind>("equipment");
const targetType = computed(() => (kind.value === "equipment" ? "EQUIPMENT_TEMPLATE" : "FACILITY_TEMPLATE"));
const noun = computed(() => (kind.value === "equipment" ? "設備型號" : "設施架型"));

type Tpl = { id: string; name: string; code?: string; brand?: string | null; model?: string | null; is_active: boolean };
const search = ref("");
const debounced = useDebounced(search, 300);
const rows = ref<Tpl[]>([]);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const latest = useLatest();
const pages = computed(() => Math.max(1, Math.ceil(total.value / 10)));
async function loadTargets() {
  if (!allowed.value) return;
  const n = latest.next();
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: "10", active: "true" });
    if (debounced.value.trim()) q.set("search", debounced.value.trim());
    const res = await api<{ data: Tpl[]; meta: { total: number } }>(`general-affairs/templates/${kind.value}?` + q);
    if (!latest.isLatest(n)) return;
    rows.value = res.data;
    total.value = res.meta.total;
  } catch (e) {
    if (latest.isLatest(n)) {
      rows.value = [];
      error.value = (e as Error).message;
    }
  } finally {
    if (latest.isLatest(n)) loading.value = false;
  }
}
watch([debounced, kind], () => { page.value = 1; selected.value = null; loadTargets(); });
watch(page, loadTargets);
onMounted(loadTargets);

const selected = ref<Tpl | null>(null);
const parts = ref<PickedPart[]>([]);
const version = ref("");
const original = ref<string[]>([]);
const loadingCompat = ref(false);
const saving = ref(false);
const notice = ref("");
const saveError = ref("");
const stale = ref(false);
const dirty = computed(() => JSON.stringify(parts.value.map((p) => p.id).sort()) !== JSON.stringify([...original.value].sort()));
watch(dirty, (v) => (props.tab.dirty = v));

async function pick(t: Tpl) {
  selected.value = t;
  notice.value = "";
  saveError.value = "";
  stale.value = false;
  loadingCompat.value = true;
  try {
    const res = await api<{ data: { parts: any[]; version: string } }>(`general-affairs/compat?targetType=${targetType.value}&targetId=${t.id}`);
    parts.value = res.data.parts.map((r) => r.part).filter(Boolean);
    original.value = parts.value.map((p) => p.id);
    version.value = res.data.version;
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    loadingCompat.value = false;
  }
}
async function save() {
  if (!selected.value || saving.value) return;
  saving.value = true;
  saveError.value = "";
  stale.value = false;
  try {
    await api("general-affairs/compat", { method: "PUT", body: JSON.stringify({ targetType: targetType.value, targetId: selected.value.id, partIds: parts.value.map((p) => p.id), expectedVersion: version.value }) });
    notice.value = `已儲存「${selected.value.name}」的適用料件（${parts.value.length} 項）`;
    await pick(selected.value);
    notice.value = `已儲存適用料件（${parts.value.length} 項）`;
  } catch (e) {
    saveError.value = (e as Error).message;
    stale.value = e instanceof ApiError && e.status === 409 && e.data?.code === "STALE";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 料件管理</p>
      <h1>適用料件設定</h1>
      <p class="muted">先選設備型號或設施架型，再設定它適用哪些料件。儲存是整批取代：畫面上的清單就是儲存後的結果。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '料件管理', '適用料件設定']">
    <div class="compat-grid">
      <section aria-label="選擇對象">
        <div class="kind-tabs" role="group" aria-label="對象種類">
          <button type="button" :class="{ primary: kind === 'equipment' }" :aria-pressed="kind === 'equipment'" @click="kind = 'equipment'">設備型號</button>
          <button type="button" :class="{ primary: kind === 'facility' }" :aria-pressed="kind === 'facility'" @click="kind = 'facility'">設施架型</button>
        </div>
        <label class="s">搜尋{{ noun }}<input v-model="search" type="search" placeholder="名稱、品牌、型號" /></label>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <p v-if="loading" class="muted" role="status">載入中…</p>
        <ul class="targets" aria-label="可選對象">
          <li v-for="t in rows" :key="t.id">
            <button type="button" :class="{ current: selected?.id === t.id }" :aria-pressed="selected?.id === t.id" @click="pick(t)"><strong>{{ t.name }}</strong><small>{{ [t.code, t.brand, t.model].filter(Boolean).join(" / ") }}</small></button>
          </li>
          <li v-if="!rows.length && !loading" class="muted">找不到符合的{{ noun }}。</li>
        </ul>
        <footer class="pagination"><span>共 {{ total }} 筆</span><button :disabled="page <= 1" @click="page--">上一頁</button><button :disabled="page >= pages" @click="page++">下一頁</button></footer>
      </section>
      <section aria-label="適用料件">
        <p v-if="!selected" class="muted">請先從左側選擇一個{{ noun }}。</p>
        <template v-else>
          <h2>{{ selected.name }} 的適用料件</h2>
          <p v-if="notice" class="notice success" role="status">{{ notice }}</p>
          <p v-if="saveError" class="notice error" role="alert">{{ saveError }}<button v-if="stale" type="button" @click="pick(selected)">重新載入</button></p>
          <p v-if="loadingCompat" class="muted" role="status">載入中…</p>
          <template v-else>
            <PartMultiPicker v-model="parts" :disabled="saving" />
            <div class="form-footer"><span>{{ dirty ? "有尚未儲存的變更" : "" }}</span><button type="button" class="primary" :disabled="saving || !dirty" @click="save">{{ saving ? "儲存中…" : "儲存適用料件" }}</button></div>
          </template>
        </template>
      </section>
    </div>
  </GaShell>
</template>

<style scoped>
.compat-grid { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 24px; align-items: start; }
.kind-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.s { display: grid; gap: 4px; margin-bottom: 10px; }
.targets { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 6px; }
.targets li { border-bottom: 1px solid var(--line); }
.targets li:last-child { border-bottom: 0; }
.targets li.muted { padding: 10px; }
.targets button { width: 100%; text-align: left; border: 0; border-radius: 0; white-space: normal; }
.targets button.current { background: var(--soft); }
.targets small { display: block; color: var(--muted); font-weight: 400; }
h2 { font-size: 15px; margin-top: 0; }
@media (max-width: 900px) { .compat-grid { grid-template-columns: 1fr; } }
</style>
