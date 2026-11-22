<script setup lang="ts">
// M5 W20 Q6：支援請求（照舊版 SupportRequestModal）。
// 列出「請求我管轄門市出人」的需求（支援門市在我的管轄門市內），讓店長指派支援人員；
// 只有持 activity.support_assign.edit（或管理員角色）的人看得到入口，實際寫入範圍由伺服器（authorizeCampaignStoreWrite）判斷。
import { computed, onMounted, ref } from "vue";
import { campaignApi } from "../campaign-api";
import CampaignStaffSearch from "./CampaignStaffSearch.vue";
import type { WorkTab } from "../stores";

const props = defineProps<{ campaign: any; managedStores: { id: string; store_code: string; store_name: string }[]; schedules: any[]; canAssign: boolean; tab: WorkTab }>();
const emit = defineEmits<{ changed: [] }>();
const loading = ref(true);
const error = ref("");
const message = ref("");
const requests = ref<any[]>([]);
const assigned = ref<Record<string, any[]>>({});
const editing = ref<{ req: any; rows: any[]; version: string; baseline: string; requestId: string } | null>(null);
const dateByStore = computed(() => Object.fromEntries(props.schedules.map((s: any) => [s.store_id, s.activity_date])));
const storeById = computed(() => Object.fromEntries(props.managedStores.map((s) => [s.id, s])));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const results = await Promise.all(
      props.managedStores.map((s) => campaignApi("requests", { campaign_id: props.campaign.id, supporting_store_id: s.id })),
    );
    const all: any[] = [];
    results.forEach((r, i) => all.push(...(r.data || []).map((x: any) => ({ ...x, _supporting: props.managedStores[i] }))));
    all.sort((a, b) => (dateByStore.value[a.requesting_store_id] || "").localeCompare(dateByStore.value[b.requesting_store_id] || ""));
    requests.value = all;
    const staff = await Promise.all(all.map((r) => campaignApi("supportStaff", { campaign_id: props.campaign.id, support_request_id: r.id })));
    assigned.value = Object.fromEntries(all.map((r, i) => [r.id, staff[i].data || []]));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function start(req: any) {
  error.value = "";
  message.value = "";
  try {
    const r = await campaignApi("supportStaff", { campaign_id: props.campaign.id, support_request_id: req.id });
    const rows = (r.data || []).map((x: any) => ({ employee_code: x.employee_code, employee_name: x.employee_name, position: x.position || "" }));
    editing.value = { req, rows, version: r.version, baseline: JSON.stringify(rows), requestId: crypto.randomUUID() };
    props.tab.dirty = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function touch() {
  const e = editing.value;
  if (!e) return;
  e.requestId = crypto.randomUUID();
  props.tab.dirty = JSON.stringify(e.rows) !== e.baseline;
}
function add(p: any) {
  const e = editing.value;
  if (!e || e.rows.some((x) => x.employee_code === p.employee_code)) return;
  e.rows.push({ employee_code: p.employee_code, employee_name: p.employee_name, position: p.position || p.current_position || "" });
  touch();
}
function remove(i: number) {
  const e = editing.value;
  if (!e) return;
  e.rows.splice(i, 1);
  touch();
}
function cancel() {
  editing.value = null;
  props.tab.dirty = false;
}
async function save() {
  const e = editing.value;
  if (!e || props.tab.busy) return;
  props.tab.busy = true;
  error.value = "";
  try {
    await campaignApi("supportStaff", {}, "PUT", { campaign_id: props.campaign.id, scope: e.req.id, rows: e.rows, version: e.version, requestId: e.requestId });
    editing.value = null;
    props.tab.dirty = false;
    message.value = "已儲存支援指派";
    await load();
    emit("changed");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    props.tab.busy = false;
  }
}
</script>

<template>
  <div class="support-assign" data-testid="support-assign">
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <p v-if="loading">讀取支援請求…</p>
    <template v-else>
      <p>共 {{ requests.length }} 項需要您管轄門市支援的請求。</p>
      <div class="module-table">
        <table>
          <thead>
            <tr><th>活動日期</th><th>前往門市</th><th>支援門市（我的管轄）</th><th>需求人數</th><th>已指派人員</th><th>備註</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in requests" :key="r.id" :data-request="r.id">
              <td>{{ dateByStore[r.requesting_store_id] || "—" }}</td>
              <td>{{ r.requesting_store?.store_code }} {{ r.requesting_store?.store_name }}</td>
              <td>{{ (storeById[r.supporting_store_id] || r._supporting)?.store_code }} {{ (storeById[r.supporting_store_id] || r._supporting)?.store_name }}</td>
              <td>{{ r.requested_count }}</td>
              <td>
                <span v-for="s in assigned[r.id] || []" :key="s.id || s.employee_code" class="staff">{{ s.employee_code }} {{ s.employee_name }} {{ s.position }}</span>
                <span v-if="!(assigned[r.id] || []).length">尚未指派</span>
              </td>
              <td>{{ r.notes || "—" }}</td>
              <td><button v-if="canAssign" :disabled="tab.busy" data-testid="assign-start" @click="start(r)">指派人員</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!requests.length">目前沒有需要您管轄門市支援的請求。</p>
    </template>

    <section v-if="editing" class="editor" aria-label="指派支援人員">
      <h4>指派支援人員：{{ editing.req.requesting_store?.store_name }}（需求 {{ editing.req.requested_count }} 人）</h4>
      <CampaignStaffSearch :disabled="tab.busy" @select="add" />
      <ul>
        <li v-for="(p, i) in editing.rows" :key="p.employee_code" data-testid="assigned-row">
          {{ p.employee_code }} {{ p.employee_name }} {{ p.position }}
          <button :disabled="tab.busy" @click="remove(i)">移除</button>
        </li>
      </ul>
      <p v-if="!editing.rows.length">尚未選擇任何人員（儲存後會清空此請求的指派）。</p>
      <div class="dialog-actions">
        <button :disabled="tab.busy" @click="cancel">取消</button>
        <button class="primary" :disabled="tab.busy" data-testid="assign-save" @click="save">儲存指派</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.staff{display:block}
.editor{border-top:1px solid var(--line,#d9ddd2);margin-top:20px;padding-top:12px}
td button{margin:3px}
</style>
