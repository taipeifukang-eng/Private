<script setup lang="ts">
import { ref } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PartForm from "../../components/ga/PartForm.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import { emptyPart, partPayload, validatePartForm } from "../../lib/ga-parts";
import { useWorkspace, type WorkTab } from "../../stores";

// G03 新增料件。Q6：「品牌＋型號＋規格」與既有料件相同時，先顯示既有料件，確認後才建立（舊版直接建立，庫存會被拆成兩筆）。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const work = useWorkspace();
const form = ref(emptyPart());
const errors = ref<Record<string, string>>({});
const error = ref("");
const saving = ref(false);
const created = ref("");
type Dup = { id: string; name: string; part_code: string | null; brand: string | null; model: string | null; specification: string | null; base_unit: string; is_active: boolean };
const duplicates = ref<Dup[]>([]);

async function submit(confirmDuplicate = false) {
  if (saving.value || !allowed.value) return;
  errors.value = validatePartForm(form.value);
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  error.value = "";
  try {
    const body = { ...partPayload(form.value, { canSeeNotes: true }), confirm_duplicate: confirmDuplicate };
    await api("general-affairs/parts", { method: "POST", body: JSON.stringify(body) });
    created.value = form.value.name;
    duplicates.value = [];
    props.tab.dirty = false;
    form.value = emptyPart();
  } catch (e) {
    if (e instanceof ApiError && e.data?.code === "DUPLICATE") duplicates.value = e.data.duplicates || [];
    else error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function markDirty() {
  props.tab.dirty = true;
  created.value = "";
}
function backToList() {
  openGaPage("ga-parts");
  work.remove([props.tab.id]);
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 料件管理</p>
      <h1>新增料件</h1>
      <p class="muted">建立料件主檔。基本庫存單位建立後，有庫存或交易就不能再改，請先確認。</p>
    </div>
    <button @click="backToList">回料件列表</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '料件管理', '新增料件']">
    <p v-if="created" class="notice success" role="status">已新增料件「{{ created }}」。可以繼續新增下一個，或回料件列表。</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <section v-if="duplicates.length" class="notice" role="alertdialog" aria-label="可能重複的料件">
      <p><strong>已有品牌、型號與規格相同的料件。</strong>重複建立會讓庫存與適用對照分散成兩筆。</p>
      <ul>
        <li v-for="d in duplicates" :key="d.id">{{ d.name }}（{{ [d.brand, d.model, d.specification].filter(Boolean).join(" / ") }}，單位 {{ d.base_unit }}，{{ d.is_active ? "啟用中" : "已停用" }}）</li>
      </ul>
      <button type="button" :disabled="saving" @click="duplicates = []">回去修改</button>
      <button type="button" class="primary" :disabled="saving" @click="submit(true)">仍要新增</button>
    </section>
    <form class="ga-create" @submit.prevent="submit(false)" @input="markDirty">
      <fieldset :disabled="saving">
        <legend>料件資料</legend>
        <PartForm v-model="form" can-see-notes :errors="errors" />
      </fieldset>
      <div class="form-footer"><span>{{ saving ? "儲存中…" : "" }}</span><button type="submit" class="primary" :disabled="saving">新增料件</button></div>
    </form>
  </GaShell>
</template>

<style scoped>
.ga-create { max-width: 850px; }
.ga-create > fieldset { padding: 22px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); margin: 0; }
.ga-create legend { font-size: 13px; font-weight: 700; padding: 0 8px; }
</style>
