<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import { bankChangeLines, errorText, timeText, type VendorBankChange } from "../../lib/ga-vendors";

// 驗收追加 F6：廠商銀行帳號「修改歷程」（誰、何時、舊 → 新）。只在使用者看得到銀行欄位（廠商檢視／管理）時由廠商詳情放進來；
// 伺服端 ga_ws_vendor_bank_log 也會再判斷一次權限，沒有權限回 403，這裡不顯示任何內容。
const props = defineProps<{ vendorId: string; refreshKey?: number }>();
const rows = ref<VendorBankChange[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref("");
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ data: VendorBankChange[]; total: number }>(`general-affairs/vendors/${props.vendorId}/bank-log?page=${page.value}&pageSize=${pageSize}`);
    rows.value = res.data;
    total.value = res.total;
  } catch (e) {
    rows.value = [];
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const pages = () => Math.max(1, Math.ceil(total.value / pageSize));
function go(n: number) { page.value = n; void load(); }
</script>

<template>
  <section class="vd-box" data-testid="vd-bank-log">
    <h3>修改歷程（銀行帳號）</h3>
    <p v-if="loading" role="status" class="muted">載入中…</p>
    <p v-if="error" class="notice error" role="alert" data-testid="vd-bank-log-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
    <p v-else-if="!loading && !rows.length" class="muted" data-testid="vd-bank-log-empty">還沒有銀行帳號的修改紀錄。</p>
    <ol v-if="rows.length" class="log">
      <li v-for="r in rows" :key="r.id" data-testid="vd-bank-log-row">
        <p class="meta"><strong>{{ r.changed_by_name || "（系統或未知）" }}</strong>　{{ timeText(r.changed_at) }}　<span class="muted">{{ r.op === "INSERT" ? "新增廠商時填寫" : "修改" }}</span></p>
        <ul><li v-for="(t, i) in bankChangeLines(r)" :key="i">{{ t }}</li></ul>
      </li>
    </ol>
    <div v-if="total > pageSize" class="pager">
      <span>第 {{ page }} / {{ pages() }} 頁</span>
      <button type="button" :disabled="page <= 1 || loading" @click="go(page - 1)">上一頁</button>
      <button type="button" :disabled="page >= pages() || loading" @click="go(page + 1)">下一頁</button>
    </div>
  </section>
</template>

<style scoped>
.log { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.log > li { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: grid; gap: 4px; }
.meta { margin: 0; font-size: 13px; }
.log ul { margin: 0; padding-left: 18px; font-size: 13px; overflow-wrap: anywhere; }
.pager { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
</style>
