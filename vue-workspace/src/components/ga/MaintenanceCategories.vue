<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import type { WoCategory } from "../../lib/ga-work-orders";

// G19 維修分類管理（維持舊權限 cross_dept.maintenance.category.edit）：新增、改名、停用／啟用、排序。
// 刪除維持舊版語意＝停用（既有工單仍帶著這個分類）；名稱不可重複（含已停用的），重名回白話說明。
const emit = defineEmits<{ close: [] }>();
const items = ref<WoCategory[]>([]);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const newName = ref("");
const editing = ref<{ id: string; name: string; sort: string; updated_at?: string } | null>(null);

async function load() {
  loading.value = true;
  try { items.value = (await api<{ data: WoCategory[] }>("general-affairs/maintenance-categories?include_inactive=1")).data; } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; }
}
onMounted(load);
async function run(fn: () => Promise<unknown>, msg: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try { await fn(); notice.value = msg; await load(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
const add = () => run(async () => { await api("general-affairs/maintenance-categories", { method: "POST", body: JSON.stringify({ name: newName.value.trim() }) }); newName.value = ""; }, "分類已新增。");
const toggle = (c: WoCategory) => run(() => api(`general-affairs/maintenance-categories/${c.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !c.is_active, expected_updated_at: c.updated_at }) }), c.is_active ? "分類已停用。" : "分類已啟用。");
const save = () => run(async () => {
  const e = editing.value!;
  await api(`general-affairs/maintenance-categories/${e.id}`, { method: "PATCH", body: JSON.stringify({ name: e.name.trim(), sort_order: e.sort, expected_updated_at: e.updated_at }) });
  editing.value = null;
}, "分類已儲存。");
</script>

<template>
  <Modal title="維修分類管理" :busy="busy" @cancel="emit('close')">
    <div class="mc" data-testid="cat-dialog">
      <p v-if="notice" class="notice success" role="status" data-testid="cat-notice">{{ notice }}</p>
      <p v-if="error" class="field-error" role="alert" data-testid="cat-error">{{ error }}</p>
      <form class="mc-add" novalidate @submit.prevent="add">
        <label>新增分類<input v-model="newName" maxlength="50" placeholder="分類名稱（最多 50 字）" data-testid="cat-new" /></label>
        <button type="submit" class="primary" :disabled="busy || !newName.trim()" data-testid="cat-add">新增</button>
      </form>
      <p v-if="loading" role="status">載入中…</p>
      <ul class="mc-list" data-testid="cat-list">
        <li v-for="c in items" :key="c.id" :class="{ off: !c.is_active }" data-testid="cat-row">
          <template v-if="editing && editing.id === c.id">
            <label>名稱<input v-model="editing.name" maxlength="50" data-testid="cat-edit-name" /></label>
            <label>排序<input v-model="editing.sort" inputmode="numeric" data-testid="cat-edit-sort" /></label>
            <span class="mc-tools"><button type="button" @click="editing = null">取消</button><button type="button" class="primary" :disabled="busy" data-testid="cat-save" @click="save">儲存</button></span>
          </template>
          <template v-else>
            <span class="mc-name"><strong>{{ c.name }}</strong><span class="muted">　排序 {{ c.sort_order }}{{ c.is_active ? "" : "　已停用" }}</span></span>
            <span class="mc-tools">
              <button type="button" data-testid="cat-edit" @click="editing = { id: c.id, name: c.name, sort: String(c.sort_order), updated_at: c.updated_at }">編輯</button>
              <button type="button" data-testid="cat-toggle" :disabled="busy" @click="toggle(c)">{{ c.is_active ? "停用" : "啟用" }}</button>
            </span>
          </template>
        </li>
        <li v-if="!items.length && !loading" class="muted">還沒有維修分類。</li>
      </ul>
      <div class="dialog-actions"><button type="button" data-testid="cat-close" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.mc { display: grid; gap: 10px; min-width: 0; }
.mc-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
.mc-add label, .mc-list label { display: grid; gap: 4px; }
.mc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.mc-list li { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; justify-content: space-between; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.mc-list li.off { opacity: 0.75; }
.mc-name { min-width: 0; overflow-wrap: anywhere; align-self: center; }
.mc-tools { display: flex; gap: 8px; }
</style>
