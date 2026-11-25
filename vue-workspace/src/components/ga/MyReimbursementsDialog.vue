<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import PayoutAccountDialog from "./PayoutAccountDialog.vue";
import { PR_STATUS_LABELS, dateText, errorText, money } from "../../lib/ga-payments";

// ga-improve-b1 G4「我的代墊款」：任何登入者都能開（從頂端工具列的錢包圖示）。
// 上方是「我的匯款帳戶」（登錄、修改，只露末四碼）；下方是付款對象是我自己的請款單（已送出以後才顯示，不含廠商帳戶與統編）。
const emit = defineEmits<{ close: [] }>();
type Row = { id: string; pr_no: string; status: string; amount_total: number; created_at: string; paid_date: string | null; source: string | null; vendor_name: string | null };
const rows = ref<Row[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(true);
const error = ref("");
const hasAccount = ref<boolean | null>(null);
const last4 = ref<string | null>(null);
const editing = ref(false);
const notice = ref("");
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
async function loadAccount() {
  try {
    const res = await api<{ data: { account: unknown; account_last4?: string | null } }>("general-affairs/payee-accounts/own");
    hasAccount.value = !!res.data.account;
    last4.value = res.data.account_last4 ?? null;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function loadRows() {
  loading.value = true;
  try {
    const res = await api<{ data: Row[]; total: number }>(`general-affairs/my-reimbursements?page=${page.value}&pageSize=${pageSize}`);
    rows.value = res.data;
    total.value = res.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => { void loadAccount(); void loadRows(); });
function saved(l4: string | null) {
  editing.value = false;
  hasAccount.value = true;
  last4.value = l4;
  notice.value = "已儲存匯款帳戶。";
}
function go(d: number) { page.value += d; void loadRows(); }
</script>

<template>
  <Modal title="我的代墊款" @cancel="emit('close')">
    <div class="mr" data-testid="my-reimbursements">
      <p v-if="error" class="notice error" role="alert" data-testid="mr-error">{{ error }}</p>
      <p v-if="notice" class="notice success" role="status" data-testid="mr-notice">{{ notice }}</p>
      <section class="mr-box">
        <h3>我的匯款帳戶</h3>
        <p v-if="hasAccount === null" class="muted" role="status">載入中…</p>
        <p v-else-if="hasAccount" data-testid="mr-account">已登錄，帳號末四碼 <strong>{{ last4 || "—" }}</strong>（其他人只看得到末四碼）。</p>
        <p v-else class="muted" data-testid="mr-no-account">還沒有登錄匯款帳戶。總務要把代墊款還給你之前，請先登錄。</p>
        <div><button type="button" class="primary" data-testid="mr-edit-account" @click="editing = true">{{ hasAccount ? "修改匯款帳戶" : "登錄匯款帳戶" }}</button></div>
      </section>
      <section class="mr-box">
        <h3>我的代墊款</h3>
        <p class="muted">公司同意還你的代墊款（請款單已送出之後才會出現），可看到金額、狀態與付款日。</p>
        <p v-if="loading" role="status">載入中…</p>
        <ul class="mr-list" data-testid="mr-list">
          <li v-for="r in rows" :key="r.id" data-testid="mr-row">
            <strong>{{ r.pr_no }}</strong><span class="st" :class="r.status.toLowerCase()">{{ PR_STATUS_LABELS[r.status as keyof typeof PR_STATUS_LABELS] || r.status }}</span>
            <span>{{ money(r.amount_total) }}</span><span class="muted">{{ r.vendor_name || "—" }}　建立 {{ dateText(r.created_at) }}<template v-if="r.paid_date">　付款日 {{ dateText(r.paid_date) }}</template></span>
          </li>
          <li v-if="!rows.length && !loading" class="muted" data-testid="mr-empty">目前沒有代墊款。</li>
        </ul>
        <div v-if="pages > 1" class="mr-pager"><span>第 {{ page }} / {{ pages }} 頁</span><button type="button" :disabled="page <= 1" @click="go(-1)">上一頁</button><button type="button" :disabled="page >= pages" @click="go(1)">下一頁</button></div>
      </section>
      <div class="dialog-actions"><button type="button" data-testid="mr-close" @click="emit('close')">關閉</button></div>
    </div>
    <PayoutAccountDialog v-if="editing" who="own" @close="editing = false" @saved="saved" />
  </Modal>
</template>

<style scoped>
.mr { display: grid; gap: 12px; min-width: 0; }
.mr-box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; min-width: 0; }
.mr-box h3 { margin: 0; font-size: 15px; }
.mr-box p { margin: 0; overflow-wrap: anywhere; }
.mr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.mr-list li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 6px; overflow-wrap: anywhere; }
.mr-pager { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); white-space: nowrap; }
.st.submitted { color: #8a5a00; border-color: #e0c27a; background: #fff6df; }
.st.paid { color: #1b6e3a; border-color: #9fd2b0; background: #e8f6ec; }
@media (max-width: 700px) { .mr button, .dialog-actions button { min-height: 44px; } }
</style>
