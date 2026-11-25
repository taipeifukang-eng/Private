<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { errorText, money, monthText, type Bill } from "../../lib/ga-utility-bills";

// G46 補填繳費單位：列出還沒有指定繳費單位的帳單，依供應商（帳單上寫的供應商名稱）分組顯示筆數；對每一組選一個繳費單位按「套用到這一組」。
// 只填空白（已有繳費單位的、已刪除的會跳過並說明）；一次最多 200 筆，超過的組會分批送出。需要水電話網費管理權限。
const emit = defineEmits<{ close: []; changed: [] }>();
type Payee = { id: string; name: string };
const payees = ref<Payee[]>([]);
const bills = ref<Bill[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const result = ref("");
const choice = ref<Record<string, string>>({});
const SKIP_TEXT: Record<string, string> = { DELETED: "已刪除", HAS_PAYEE: "已經有繳費單位", NOT_FOUND: "找不到" };

const groups = computed(() => {
  const map = new Map<string, Bill[]>();
  for (const b of bills.value) {
    const k = b.provider_name || "";
    map.set(k, [...(map.get(k) || []), b]);
  }
  return [...map.entries()].map(([name, list]) => ({ key: name, label: name || "（帳單沒有填供應商）", list, total: list.reduce((s, b) => s + Number(b.amount || 0), 0) })).sort((a, b) => b.list.length - a.list.length);
});
async function load() {
  loading.value = true;
  error.value = "";
  try {
    payees.value = (await api<{ data: Payee[] }>("general-affairs/utility-bills/payees")).data;
    const all: Bill[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const res = await api<{ data: Bill[]; total: number }>("general-affairs/utility-bills?" + new URLSearchParams({ payee: "none", page: String(page), pageSize: "100" }));
      all.push(...res.data);
      if (all.length >= res.total || !res.data.length) break;
    }
    bills.value = all;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function apply(g: { key: string; label: string; list: Bill[] }) {
  const vendorId = choice.value[g.key];
  if (!vendorId || busy.value) { if (!vendorId) error.value = `請先為「${g.label}」選擇繳費單位。`; return; }
  busy.value = true;
  error.value = "";
  result.value = "";
  let done = 0;
  const skipped: Record<string, number> = {};
  try {
    const ids = g.list.map((b) => b.id);
    for (let i = 0; i < ids.length; i += 200) {
      const res = await api<{ data: { updated: number; skipped: Array<{ id: string; reason: string }> } }>("general-affairs/utility-bills/set-payee", { method: "POST", body: JSON.stringify({ ids: ids.slice(i, i + 200), vendor_id: vendorId }) });
      done += res.data.updated;
      for (const s of res.data.skipped) skipped[s.reason] = (skipped[s.reason] || 0) + 1;
    }
    const skipText = Object.entries(skipped).map(([k, n]) => `${SKIP_TEXT[k] || k} ${n} 筆`).join("、");
    result.value = `已為「${g.label}」補填 ${done} 筆帳單的繳費單位${skipText ? `；略過：${skipText}` : ""}。`;
    emit("changed");
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="補填繳費單位" wide :busy="busy" @cancel="emit('close')">
    <div class="pb" data-testid="payee-backfill">
      <p class="muted">下面是還沒有指定繳費單位的帳單，依帳單上的供應商分組。請款時帳單必須有繳費單位（台電、台水、電信公司等公用事業單位）。只會填空白，已經有繳費單位的帳單不會被改。</p>
      <p v-if="error" class="notice error" role="alert" data-testid="pb-error">{{ error }}</p>
      <p v-if="result" class="notice success" role="status" data-testid="pb-result">{{ result }}</p>
      <p v-if="loading" role="status">載入中…</p>
      <p v-if="!loading && !payees.length" class="notice" role="status" data-testid="pb-no-payees">還沒有「公用事業」分類的廠商可選。請先到廠商資料新增台電、台水、電信公司等廠商，並勾選「公用事業」分類。</p>
      <p v-if="!loading && !groups.length" class="muted" data-testid="pb-empty">所有帳單都已經指定繳費單位。</p>
      <ul class="pb-groups">
        <li v-for="g in groups" :key="g.key" class="pb-group" data-testid="pb-group">
          <div class="pb-head"><strong data-testid="pb-group-name">{{ g.label }}</strong><span class="muted" data-testid="pb-group-count">{{ g.list.length }} 筆，合計 {{ money(g.total) }}</span></div>
          <p class="muted pb-sample">{{ g.list.slice(0, 3).map((b) => `${b.location_name} ${monthText(b.billing_month)}`).join("、") }}<template v-if="g.list.length > 3"> 等</template></p>
          <div class="pb-row">
            <select v-model="choice[g.key]" :aria-label="'為 ' + g.label + ' 選擇繳費單位'" data-testid="pb-select"><option value="">選擇繳費單位</option><option v-for="p in payees" :key="p.id" :value="p.id">{{ p.name }}</option></select>
            <button type="button" class="primary" :disabled="busy || !choice[g.key]" data-testid="pb-apply" @click="apply(g)">套用到這一組</button>
          </div>
        </li>
      </ul>
      <div class="dialog-actions"><button type="button" data-testid="pb-close" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.pb { display: grid; gap: 12px; min-width: 0; }
.pb-groups { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pb-group { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; display: grid; gap: 6px; background: var(--surface); min-width: 0; }
.pb-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; }
.pb-sample { margin: 0; overflow-wrap: anywhere; }
.pb-row { display: flex; flex-wrap: wrap; gap: 8px; }
.pb-row select { flex: 1 1 220px; min-width: 0; }
@media (max-width: 700px) { .pb-row button, .dialog-actions button { min-height: 44px; } }
</style>
