<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import Modal from "../Modal.vue";
import { VENDOR_TYPE_LABELS, dateText, describeWarning, errorText, statusLabel, timeText, type VendorDetailData, type VendorWarning } from "../../lib/ga-vendors";

// G21 廠商詳情：基本、服務、聯絡、合作與帳務（帳務欄位伺服端只對廠商檢視／管理權限者回傳）；停用、暫停、啟用要確認，並提醒還有未結的採購單與工單（只提醒不擋）。
const props = defineProps<{ id: string; canManage: boolean }>();
const emit = defineEmits<{ close: []; edit: [VendorDetailData]; changed: [] }>();
const data = ref<VendorDetailData | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const warnings = ref<VendorWarning[]>([]);
const busy = ref(false);
const confirming = ref<"active" | "paused" | "inactive" | "">("");
const billing = computed(() => !!data.value && "tax_id" in data.value);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = (await api<{ data: VendorDetailData }>(`general-affairs/vendors/${props.id}`)).data;
  } catch (e) {
    data.value = null;
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const ACTION_TEXT = { active: "改為合作中", paused: "改為暫停", inactive: "停用" } as const;
async function setStatus() {
  if (!data.value || !confirming.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const res = await api<{ data: VendorDetailData; warnings: VendorWarning[] }>(`general-affairs/vendors/${props.id}/status`, { method: "POST", body: JSON.stringify({ status: confirming.value, expected_updated_at: data.value.updated_at }) });
    warnings.value = res.warnings || [];
    notice.value = `已${ACTION_TEXT[confirming.value]}。`;
    confirming.value = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = errorText(e);
    confirming.value = "";
  } finally {
    busy.value = false;
  }
}
const money = (n: number | undefined) => (n == null ? "—" : "NT$ " + Number(n).toLocaleString("zh-TW"));
const names = (xs: Array<{ name: string; status: string }>) => xs.map((x) => x.name + (x.status !== "active" ? "（停用）" : "")).join("、") || "—";
const addr = (...p: Array<string | null | undefined>) => p.filter(Boolean).join("") || "—";
</script>

<template>
  <Modal :title="data ? data.name : '廠商詳情'" wide :busy="busy" @cancel="emit('close')">
    <div class="vd" data-testid="vendor-detail">
      <p v-if="loading" role="status">載入中…</p>
      <p v-if="error" class="notice error" role="alert" data-testid="vd-error">{{ error }}<button type="button" @click="load">重新載入</button></p>
      <p v-if="notice" class="notice success" role="status" data-testid="vd-notice">{{ notice }}</p>
      <p v-for="(w, i) in warnings" :key="i" class="notice" role="status" data-testid="vd-warning">{{ describeWarning(w) }}</p>
      <template v-if="data">
        <p class="vd-head">
          <span class="st" :data-status="data.status" data-testid="vd-status">{{ statusLabel(data.status) }}</span>
          <span v-if="data.contract_due" class="st due" data-testid="vd-contract-due">合約即將到期或已過期</span>
          <span class="muted">最後修改：{{ data.updated_by_name || "—" }} {{ timeText(data.updated_at) }}</span>
        </p>
        <div class="vd-actions">
          <button v-if="canManage" type="button" class="primary" data-testid="vd-edit" @click="emit('edit', data)">編輯</button>
          <template v-if="canManage">
            <button v-if="data.status !== 'active'" type="button" data-testid="vd-to-active" @click="confirming = 'active'">改為合作中</button>
            <button v-if="data.status !== 'paused'" type="button" data-testid="vd-to-paused" @click="confirming = 'paused'">暫停合作</button>
            <button v-if="data.status !== 'inactive'" type="button" class="danger" data-testid="vd-to-inactive" @click="confirming = 'inactive'">停用</button>
          </template>
        </div>
        <p v-if="confirming" class="notice" role="alertdialog" data-testid="vd-confirm">
          確定要{{ ACTION_TEXT[confirming] }}嗎？{{ confirming === "active" ? "" : "新的採購單與工單不能再選這個廠商；已下訂的採購單仍可收貨結案。" }}
          <button type="button" class="primary" :disabled="busy" data-testid="vd-confirm-yes" @click="setStatus">確定</button>
          <button type="button" :disabled="busy" data-testid="vd-confirm-no" @click="confirming = ''">取消</button>
        </p>

        <section class="vd-box"><h3>基本資料</h3>
          <dl>
            <div><dt>類型</dt><dd>{{ (VENDOR_TYPE_LABELS as any)[data.vendor_type] || data.vendor_type }}</dd></div>
            <div><dt>別名</dt><dd>{{ data.alias || "—" }}</dd></div>
            <div v-if="billing"><dt>統一編號</dt><dd data-testid="vd-tax">{{ data.tax_id || "—" }}</dd></div>
            <div><dt>成立日期</dt><dd>{{ dateText(data.founded_date) || "—" }}</dd></div>
            <div><dt>電話／傳真</dt><dd>{{ data.phone || "—" }}　{{ data.fax || "" }}</dd></div>
            <div><dt>網站</dt><dd>{{ data.website || "—" }}</dd></div>
            <div><dt>公司地址</dt><dd>{{ addr(data.city, data.district, data.address) }}</dd></div>
            <div><dt>服務地址</dt><dd>{{ data.same_service_address ? "同公司地址" : addr(data.service_city, data.service_district, data.service_address) }}</dd></div>
            <div class="wide"><dt>簡介</dt><dd>{{ data.description || "—" }}</dd></div>
          </dl>
        </section>
        <section class="vd-box"><h3>服務範圍</h3>
          <dl>
            <div class="wide"><dt>服務分類</dt><dd data-testid="vd-categories">{{ names(data.service_categories) }}</dd></div>
            <div class="wide"><dt>服務區域</dt><dd data-testid="vd-regions">{{ names(data.service_regions) }}</dd></div>
            <div><dt>熟悉品牌</dt><dd>{{ data.brands.join("、") || "—" }}</dd></div>
            <div><dt>設備類型</dt><dd>{{ data.equipment_types.join("、") || "—" }}</dd></div>
            <div><dt>標籤</dt><dd>{{ data.tags.join("、") || "—" }}</dd></div>
            <div class="wide"><dt>服務能力說明</dt><dd>{{ data.service_capability_note || "—" }}</dd></div>
          </dl>
        </section>
        <section class="vd-box"><h3>聯絡人</h3>
          <dl>
            <div><dt>姓名</dt><dd data-testid="vd-contact">{{ data.contact_name || "—" }}</dd></div>
            <div><dt>電話</dt><dd>{{ data.contact_phone || "—" }}</dd></div>
            <div><dt>LINE</dt><dd>{{ data.line_id || "—" }}</dd></div>
            <div><dt>Email</dt><dd>{{ data.email || "—" }}</dd></div>
          </dl>
        </section>
        <section class="vd-box"><h3>合作與帳務</h3>
          <dl>
            <div><dt>合作開始日</dt><dd>{{ dateText(data.cooperation_start_date) || "—" }}</dd></div>
            <div><dt>合約到期日</dt><dd data-testid="vd-contract-end">{{ dateText(data.contract_end_date) || "—" }}{{ data.contract_required ? "（需簽合約）" : "（不需簽合約）" }}</dd></div>
            <div><dt>優先廠商</dt><dd>{{ data.preferred_vendor ? "是" : "否" }}</dd></div>
            <div class="wide"><dt>合作備註</dt><dd>{{ data.cooperation_notes || "—" }}</dd></div>
            <template v-if="billing">
              <div><dt>發票抬頭</dt><dd>{{ data.billing_title || "—" }}</dd></div>
              <div><dt>發票類型</dt><dd>{{ data.invoice_type || "—" }}</dd></div>
              <div class="wide"><dt>發票地址</dt><dd>{{ data.billing_address || "—" }}</dd></div>
              <div><dt>付款條件</dt><dd data-testid="vd-terms">{{ data.payment_terms || "—" }}</dd></div>
              <div><dt>付款方式</dt><dd>{{ (data.payment_methods || []).join("、") || "—" }}</dd></div>
              <div><dt>累計金額</dt><dd>{{ money(data.total_amount) }}</dd></div>
              <div class="wide"><dt>帳務備註</dt><dd>{{ data.accounting_notes || "—" }}</dd></div>
            </template>
            <div v-if="data.attachment_names?.length" class="wide"><dt>既有檔名（未存檔）</dt><dd data-testid="vd-legacy-files">{{ data.attachment_names.join("、") }}</dd></div>
          </dl>
        </section>
      </template>
      <div class="dialog-actions"><button type="button" data-testid="vd-close" @click="emit('close')">關閉</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.vd { display: grid; gap: 12px; min-width: 0; }
.vd-head { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.vd-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.vd-box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; min-width: 0; }
.vd-box h3 { margin: 0 0 8px; font-size: 14px; }
.vd-box dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; }
.vd-box dl > div { min-width: 0; }
.vd-box dl .wide { grid-column: 1 / -1; }
.vd-box dt { font-size: 12px; color: var(--muted); }
.vd-box dd { margin: 0; overflow-wrap: anywhere; }
.st { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: var(--soft); }
.st.due { border-color: #d9a3a0; color: #b3261e; }
@media (max-width: 700px) { .vd-box dl { grid-template-columns: minmax(0, 1fr); } .vd-actions button, .dialog-actions button { min-height: 44px; } }
</style>
