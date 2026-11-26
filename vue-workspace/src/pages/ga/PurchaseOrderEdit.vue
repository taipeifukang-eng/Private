<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../../api";
import GaShell from "../../components/ga/GaShell.vue";
import PoPicker from "../../components/ga/PoPicker.vue";
import { openGaPage, useGaGuard } from "../../lib/ga";
import { FULFIL_TEXT, dateText, money, newKey, num, type PoDetail } from "../../lib/ga-purchase";
import { ADJ_KIND_LABELS, ADJ_KINDS, MAX_ADJUSTMENTS, PRICE_MODE_LABELS, computeTotalsV2, needsApproval, validateHeader, validateItems, type AdjKind, type PriceMode } from "../../../../lib/workspace/general-affairs/purchase-order-rules";
import { selectableCompanies, type BuyerCompany } from "../../../../lib/workspace/general-affairs/buyer-company-rules";
import { useSession, useWorkspace, type WorkTab } from "../../stores";

// G25 新增與編輯採購單草稿。供應商只能選已建好且合作中的（不可臨時輸入名稱）；品項可選料件或填自由品名；每個品項選「入總部庫存」或「到貨直接建設備送門市」；
// 選了料件會顯示同料件最近幾筆「已下訂以上」的歷史價；連到需求單的品項超過需求量要填原因。已下訂的採購單只能改備註與預計到貨日。
const props = defineProps<{ tab: WorkTab }>();
const allowed = useGaGuard(props.tab);
const session = useSession();
const work = useWorkspace();
type Item = {
  key: string; mode: "part" | "free"; part: any | null; part_id: string; item_name: string; spec: string; unit: string; quantity: string; unit_price: string;
  fulfil_mode: "STOCK" | "DIRECT_ASSET" | "NO_STOCK"; target_store_id: string; store: any | null; equipment_template_id: string; template: any | null;
  over_request_reason: string; notes: string; request_id: string; request_no: string; history: any[] | null;
};
// ga-improve-b1 G3：調整列。折扣、折價券、點數折抵在畫面輸入正數，送出前轉成負數；其他調整可輸入負數。
type Adj = { key: string; kind: AdjKind; label: string; amount: string; original_price: string; campaign_name: string; note: string; receipt_no: string };
const blankAdj = (kind: AdjKind = "FREIGHT"): Adj => ({ key: newKey(), kind, label: "", amount: "", original_price: "", campaign_name: "", note: "", receipt_no: "" });
const NEGATIVE_KINDS: readonly AdjKind[] = ["DISCOUNT", "COUPON", "POINTS"];
const blank = (): Item => ({
  key: newKey(), mode: "part", part: null, part_id: "", item_name: "", spec: "", unit: "", quantity: "1", unit_price: "", fulfil_mode: "STOCK", target_store_id: "", store: null,
  equipment_template_id: "", template: null, over_request_reason: "", notes: "", request_id: "", request_no: "", history: null,
});
const poId = computed(() => props.tab.recordId || "");
const detail = ref<PoDetail | null>(null);
const form = reactive({ vendor_id: "", vendor: null as any, receiving_location_id: "", location: null as any, expected_delivery_date: "", notes: "" });
const items = ref<Item[]>([blank()]);
const priceMode = ref<PriceMode>("EXCL");
const buyerCompanyId = ref("");
const companies = ref<BuyerCompany[]>([]);
const adjustments = ref<Adj[]>([]);
const companyOptions = computed(() => selectableCompanies(companies.value, buyerCompanyId.value || null));
const defaultCompany = computed(() => companies.value.find((c) => c.is_default && c.is_active) || null);
const priceLabel = computed(() => (priceMode.value === "INCL" ? "單價（含稅）" : "單價（未稅）"));
const settings = reactive({ tax_rate: 0.05, approval_threshold: 5000, approval_enabled: true });
// 一開始就是載入中：資料（設定與既有採購單）載完才顯示表單，避免使用者在載入前填的內容被載入結果蓋掉。
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref<PoDetail | null>(null);
const createKey = ref(newKey());
const readOnlyBody = computed(() => !!detail.value && !detail.value.abilities.edit);
const notesOnly = computed(() => !!detail.value && !detail.value.abilities.edit && detail.value.abilities.editNotesOnly);
const cannotEdit = computed(() => !!detail.value && !detail.value.abilities.edit && !detail.value.abilities.editNotesOnly);
// 只有廠商管理權限者看得到「到廠商資料新增」；其他人（例如只有採購權限者）顯示「請洽總務新增」。
const canManageVendor = computed(() => !!session.data?.capabilities?.gaVendorManage);

onMounted(async () => {
  if (!allowed.value) { loading.value = false; return; }
  try {
    const st = await api<{ data: any }>("general-affairs/purchase-orders/settings");
    settings.tax_rate = Number(st.data.tax_rate);
    settings.approval_threshold = Number(st.data.approval_threshold);
    settings.approval_enabled = !!st.data.approval_enabled;
    companies.value = (await api<{ data: BuyerCompany[] }>("general-affairs/buyer-companies").catch(() => ({ data: [] as BuyerCompany[] }))).data;
    if (poId.value) {
      const res = await api<{ data: PoDetail }>(`general-affairs/purchase-orders/${poId.value}`);
      fill(res.data);
    } else {
      const loc = await api<{ data: any[] }>("general-affairs/purchase-orders/options?type=location&pageSize=5").catch(() => ({ data: [] as any[] }));
      const def = loc.data.find((l) => l.is_default && l.location_type === "CENTRAL_WAREHOUSE");
      if (def && loc.data.filter((l) => l.is_default && l.location_type === "CENTRAL_WAREHOUSE").length === 1) { form.receiving_location_id = def.id; form.location = def; }
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
function fill(d: PoDetail) {
  detail.value = d;
  form.vendor_id = d.vendor_id || "";
  form.vendor = d.vendor_id ? { id: d.vendor_id, name: d.vendor_name || d.vendor_current_name || "（供應商）" } : null;
  form.receiving_location_id = d.receiving_location_id || "";
  form.location = d.receiving_location_id ? { id: d.receiving_location_id, name: d.receiving_location_name || "（位置）", code: null } : null;
  form.expected_delivery_date = dateText(d.expected_delivery_date);
  form.notes = d.notes || "";
  priceMode.value = d.price_mode === "INCL" ? "INCL" : "EXCL";
  buyerCompanyId.value = d.buyer_company_id || "";
  adjustments.value = (d.adjustments || []).map((a) => ({
    key: a.id, kind: a.kind, label: a.label || "", amount: String(NEGATIVE_KINDS.includes(a.kind) ? Math.abs(a.amount) : a.amount), original_price: a.original_price == null ? "" : String(a.original_price),
    campaign_name: a.campaign_name || "", note: a.note || "", receipt_no: a.receipt_no || "",
  }));
  items.value = d.items.length
    ? d.items.map((i) => ({
        key: i.id, mode: i.part_id ? "part" : "free", part: i.part_id ? { id: i.part_id, name: i.part_name || i.item_name, part_code: null } : null, part_id: i.part_id || "", item_name: i.item_name, spec: i.spec || "", unit: i.unit || "",
        quantity: String(i.quantity), unit_price: String(d.price_mode === "INCL" && i.unit_price_gross != null ? i.unit_price_gross : i.unit_price), fulfil_mode: i.fulfil_mode, target_store_id: i.target_store_id || "",
        store: i.target_store_id ? { id: i.target_store_id, store_name: i.target_store_name || "（門市）", store_code: "" } : null, equipment_template_id: i.equipment_template_id || "",
        template: i.equipment_template_id ? { id: i.equipment_template_id, name: "（已選型號）" } : null, over_request_reason: i.over_request_reason || "", notes: i.notes || "",
        request_id: i.request_id || "", request_no: i.request_no || "", history: null,
      }))
    : [blank()];
  props.tab.title = `採購單 ${d.po_no}`;
}

async function onPart(it: Item, p: any | null) {
  it.part = p;
  it.history = null;
  if (!p) return;
  if (!it.item_name) it.item_name = p.name;
  it.unit = p.purchase_unit || p.base_unit || it.unit;
  if (it.fulfil_mode === "NO_STOCK") it.fulfil_mode = "STOCK";
  try {
    const res = await api<{ data: any[] }>(`general-affairs/purchase-orders/price-history?partId=${p.id}`);
    it.history = res.data;
  } catch {
    it.history = [];
  }
  props.tab.dirty = true;
}
function setMode(it: Item, mode: "part" | "free") {
  it.mode = mode;
  if (mode === "free") { it.part = null; it.part_id = ""; it.history = null; if (it.fulfil_mode === "STOCK") it.fulfil_mode = "NO_STOCK"; }
  else if (it.fulfil_mode === "NO_STOCK") it.fulfil_mode = "STOCK";
}
function addItem() { items.value.push(blank()); props.tab.dirty = true; }
function removeItem(i: number) { items.value.splice(i, 1); if (!items.value.length) items.value.push(blank()); props.tab.dirty = true; }
const opt = (v: string) => (v.trim() ? v.trim() : undefined);
function itemsPayload() {
  return items.value.map((i) => ({
    part_id: i.mode === "part" ? opt(i.part_id) : undefined, item_name: opt(i.item_name), spec: opt(i.spec), unit: opt(i.unit), quantity: i.quantity, unit_price: i.unit_price === "" ? 0 : i.unit_price,
    request_id: opt(i.request_id), fulfil_mode: i.fulfil_mode, target_store_id: i.fulfil_mode === "DIRECT_ASSET" ? opt(i.target_store_id) : undefined,
    equipment_template_id: i.fulfil_mode === "DIRECT_ASSET" ? opt(i.equipment_template_id) : undefined, over_request_reason: opt(i.over_request_reason), notes: opt(i.notes),
  }));
}
function addAdj(kind: AdjKind) { adjustments.value.push(blankAdj(kind)); props.tab.dirty = true; }
function removeAdj(i: number) { adjustments.value.splice(i, 1); props.tab.dirty = true; }
/** 畫面輸入轉成含正負號的金額：折扣類一律負數（使用者輸入正數或負數都一樣），運費要正數，其他調整照輸入。 */
function signedAmount(a: Adj): number {
  const n = Number(String(a.amount).replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return NEGATIVE_KINDS.includes(a.kind) ? -Math.abs(n) : n;
}
function adjustmentsPayload() {
  return adjustments.value.map((a) => ({
    kind: a.kind, label: a.label.trim() || undefined, amount: String(signedAmount(a)), original_price: a.original_price.trim() || undefined, campaign_name: a.campaign_name.trim() || undefined, note: a.note.trim() || undefined,
  }));
}
const totalsError = ref("");
const totals = computed(() => {
  const rows = items.value.map((i) => ({ quantity: Number(i.quantity), unit_price: Number(i.unit_price || 0) })).filter((r) => Number.isFinite(r.quantity) && Number.isFinite(r.unit_price));
  const adj = adjustments.value.map((a) => ({ amount: signedAmount(a) })).filter((a) => Number.isFinite(a.amount));
  try {
    totalsError.value = "";
    return computeTotalsV2({ items: rows, adjustments: adj, tax_rate: settings.tax_rate, price_mode: priceMode.value });
  } catch (e) {
    totalsError.value = (e as Error).message;
    return computeTotalsV2({ items: rows, tax_rate: settings.tax_rate, price_mode: priceMode.value });
  }
});
const needsApprove = computed(() => needsApproval(totals.value.total_amount, settings.approval_threshold, settings.approval_enabled));
const headerPayload = () => ({
  vendor_id: form.vendor_id || null, receiving_location_id: form.receiving_location_id || null, expected_delivery_date: form.expected_delivery_date || null, notes: form.notes || null,
  price_mode: priceMode.value, buyer_company_id: buyerCompanyId.value || null, adjustments: adjustmentsPayload(),
});

async function save() {
  if (saving.value || !allowed.value) return;
  error.value = "";
  saved.value = null;
  if (poId.value && !detail.value) { error.value = "採購單還沒有載入完成，請按「重新載入」"; return; }
  try {
    if (notesOnly.value) validateHeader({ notes: form.notes, expected_delivery_date: form.expected_delivery_date });
    else { validateHeader(headerPayload()); validateItems(itemsPayload()); }
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  saving.value = true;
  try {
    let res: { data: PoDetail };
    if (!poId.value) {
      res = await api("general-affairs/purchase-orders", { method: "POST", body: JSON.stringify({ header: headerPayload(), items: itemsPayload(), idempotency_key: createKey.value }) });
      props.tab.recordId = res.data.id;
    } else if (notesOnly.value) {
      res = await api(`general-affairs/purchase-orders/${poId.value}`, { method: "PATCH", body: JSON.stringify({ header: { notes: form.notes || null, expected_delivery_date: form.expected_delivery_date || null }, expected_updated_at: detail.value!.updated_at }) });
    } else {
      res = await api(`general-affairs/purchase-orders/${poId.value}`, { method: "PATCH", body: JSON.stringify({ header: headerPayload(), items: itemsPayload(), expected_updated_at: detail.value!.updated_at }) });
    }
    saved.value = res.data;
    fill(res.data);
    props.tab.dirty = false;
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.data?.code === "STALE" && poId.value) error.value += "\n請按「重新載入」取得最新內容後再改。";
  } finally {
    saving.value = false;
  }
}
async function reload() {
  if (!poId.value) return;
  try { fill((await api<{ data: PoDetail }>(`general-affairs/purchase-orders/${poId.value}`)).data); error.value = ""; } catch (e) { error.value = (e as Error).message; }
}
function backToList() { openGaPage("ga-purchase-orders"); work.remove([props.tab.id]); }
const dirty = () => { props.tab.dirty = true; };
// 審查 L1：切換含稅／未稅時，已填的單價數字不會換算（只是意義變了，總額會跳約 5%），切換後明確提醒
const modeSwitched = ref(false);
function onPriceModeChange() {
  if (items.value.some((i) => String(i.unit_price || "").trim() !== "") || adjustments.value.length) modeSwitched.value = true;
  dirty();
}
const overRequired = (i: Item) => !!i.request_id;
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心 / 作業管理</p>
      <h1>{{ poId ? "編輯採購單" : "新增採購單" }}</h1>
      <p class="muted">先存成草稿；含稅總額超過核准門檻的要送核准，其餘可直接下訂。下訂後品項、數量、單價與供應商鎖定。</p>
    </div>
    <button type="button" data-testid="back-list" @click="backToList">回採購單清單</button>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心', '作業管理', poId ? '編輯採購單' : '新增採購單']">
    <p v-if="loading" role="status">載入中…</p>
    <p v-if="error" class="notice error pre" role="alert" data-testid="pe-error">{{ error }}<button v-if="poId" type="button" data-testid="pe-reload" @click="reload">重新載入</button></p>
    <p v-if="saved" class="notice success" role="status" data-testid="pe-saved">已儲存 <strong data-testid="pe-po-no">{{ saved.po_no }}</strong>（{{ saved.status_label }}，含稅 {{ money(saved.total_amount) }}）。可回採購單清單送核准或下訂。</p>
    <p v-if="cannotEdit" class="notice" role="status" data-testid="pe-locked">這張採購單目前的狀態（{{ detail?.status_label }}）不能修改；待核准要先撤回，已核准要先撤回核准。</p>
    <p v-if="notesOnly" class="notice" role="status" data-testid="pe-notes-only">已下訂的採購單，品項、數量、單價與供應商已鎖定，只能修改備註與預計到貨日。</p>

    <form v-if="!loading" class="pe" data-testid="po-form" @submit.prevent="save">
      <section class="pe-box">
        <h2>基本資料</h2>
        <div class="pe-vendor">
          <PoPicker v-model="form.vendor_id" kind="vendor" label="供應商（只能選已建好且合作中的）" required testid="pe-vendor" :disabled="readOnlyBody" :initial="form.vendor" @pick="dirty" />
          <button v-if="canManageVendor" type="button" class="link legacy-link" data-testid="legacy-vendor-link" @click="openGaPage('ga-vendors')">到廠商資料新增供應商</button>
          <span v-else class="muted legacy-link" data-testid="vendor-ask-ga">找不到供應商？請洽總務新增。</span>
        </div>
        <PoPicker v-model="form.receiving_location_id" kind="location" label="收貨位置（入庫存的品項到貨後放這裡）" clearable testid="pe-location" :disabled="readOnlyBody" :initial="form.location" @pick="dirty" />
        <div class="pe-two">
          <label>單價計價方式
            <select v-model="priceMode" :disabled="readOnlyBody" data-testid="pe-price-mode" @change="onPriceModeChange">
              <option v-for="(l, k) in PRICE_MODE_LABELS" :key="k" :value="k">{{ l }}{{ k === "EXCL" ? "（預設）" : "" }}</option>
            </select>
          </label>
          <label>買受人抬頭
            <select v-model="buyerCompanyId" :disabled="readOnlyBody" data-testid="pe-buyer" @change="dirty">
              <option value="">{{ defaultCompany ? `（沿用預設公司：${defaultCompany.name}）` : "（沿用請款設定的抬頭）" }}</option>
              <option v-for="c in companyOptions" :key="c.id" :value="c.id">{{ c.name }}（{{ c.tax_id }}）{{ c.is_active ? "" : "【已停用】" }}</option>
            </select>
          </label>
        </div>
        <p class="muted" data-testid="pe-price-mode-hint">{{ priceMode === "INCL" ? "單價與調整列都輸入「含稅」金額；系統用含稅總額反推未稅與稅額（稅額用總額減未稅），含稅總額永遠等於你輸入的合計。" : "單價與調整列都輸入「未稅」金額；稅額依稅率四捨五入。" }}切換後單價的意義會改變，已填的數字不會自動換算，請確認金額。</p>
        <p v-if="modeSwitched" class="notice" role="status" data-testid="pe-price-mode-switched">你剛切換了計價方式：已填的單價與調整列金額沒有換算，現在會被當成「{{ priceMode === "INCL" ? "含稅" : "未稅" }}」金額，總額目前是 {{ money(totals.total_amount) }}。請逐項確認單價。</p>
        <label>預計到貨日<input v-model="form.expected_delivery_date" type="date" :disabled="cannotEdit" data-testid="pe-expected" @input="dirty" /></label>
        <label>備註<textarea v-model="form.notes" rows="2" maxlength="1000" :disabled="cannotEdit" data-testid="pe-notes" @input="dirty" /></label>
      </section>

      <section class="pe-box">
        <h2>品項</h2>
        <ul class="pe-items" aria-label="採購品項">
          <li v-for="(it, idx) in items" :key="it.key" class="pe-item" data-testid="pe-item">
            <div class="pe-mode" role="group" aria-label="品項類型">
              <label><input type="radio" :name="'mode-' + it.key" :checked="it.mode === 'part'" :disabled="readOnlyBody" :data-testid="'pe-mode-part-' + idx" @change="setMode(it, 'part')" /> 選料件</label>
              <label><input type="radio" :name="'mode-' + it.key" :checked="it.mode === 'free'" :disabled="readOnlyBody" :data-testid="'pe-mode-free-' + idx" @change="setMode(it, 'free')" /> 自由品名</label>
              <button v-if="!readOnlyBody && items.length > 1" type="button" class="link" :data-testid="'pe-remove-' + idx" @click="removeItem(idx)">移除此項</button>
            </div>
            <PoPicker v-if="it.mode === 'part'" v-model="it.part_id" kind="part" label="料件" required :testid="'pe-part-' + idx" :disabled="readOnlyBody" :initial="it.part" @pick="(p: any) => onPart(it, p)" />
            <p v-if="it.part?.equipment_template" class="muted" :data-testid="'pe-part-template-' + idx">這個料件可轉成設備型號：{{ it.part.equipment_template.name }}</p>
            <div class="pe-grid">
              <label>品名<input v-model="it.item_name" maxlength="200" :disabled="readOnlyBody" :data-testid="'pe-name-' + idx" @input="dirty" /></label>
              <label>規格<input v-model="it.spec" maxlength="200" :disabled="readOnlyBody" :data-testid="'pe-spec-' + idx" @input="dirty" /></label>
              <label>數量<input v-model="it.quantity" inputmode="decimal" :disabled="readOnlyBody" :data-testid="'pe-qty-' + idx" @input="dirty" /></label>
              <label>單位<input v-model="it.unit" maxlength="20" :disabled="readOnlyBody" :data-testid="'pe-unit-' + idx" @input="dirty" /></label>
              <label>{{ priceLabel }}<input v-model="it.unit_price" inputmode="decimal" :disabled="readOnlyBody" :data-testid="'pe-price-' + idx" @input="dirty" /></label>
            </div>
            <div v-if="it.history" class="pe-history" :data-testid="'pe-history-' + idx">
              <strong>歷史價（最近已下訂的採購）</strong>
              <ul v-if="it.history.length"><li v-for="h in it.history" :key="h.po_id" data-testid="pe-history-row">{{ h.ordered_date }}　{{ h.vendor_name }}　{{ money(h.unit_price) }} × {{ num(h.quantity) }} {{ h.unit }}（{{ h.po_no }}）</li></ul>
              <p v-else class="muted" data-testid="pe-history-empty">這個料件還沒有已下訂的採購紀錄。</p>
            </div>
            <label>到貨後怎麼處理
              <select v-model="it.fulfil_mode" :disabled="readOnlyBody" :data-testid="'pe-mode-' + idx" @change="dirty">
                <option v-if="it.mode === 'part'" value="STOCK">{{ FULFIL_TEXT.STOCK }}（預設）</option>
                <option value="DIRECT_ASSET">{{ FULFIL_TEXT.DIRECT_ASSET }}</option>
                <option value="NO_STOCK">{{ FULFIL_TEXT.NO_STOCK }}（不入庫、不建設備）</option>
              </select>
            </label>
            <template v-if="it.fulfil_mode === 'DIRECT_ASSET'">
              <PoPicker v-model="it.target_store_id" kind="store" label="送往門市" required :testid="'pe-store-' + idx" :disabled="readOnlyBody" :initial="it.store" @pick="dirty" />
              <PoPicker v-model="it.equipment_template_id" kind="template" :label="it.part?.equipment_template ? '設備型號（不選就沿用料件對應）' : '設備型號'" clearable :testid="'pe-template-' + idx" :disabled="readOnlyBody" :initial="it.template" @pick="dirty" />
            </template>
            <label v-if="overRequired(it)">超過需求量的原因（需求單 {{ it.request_no }}，超過才必填）<input v-model="it.over_request_reason" maxlength="200" :disabled="readOnlyBody" :data-testid="'pe-over-' + idx" @input="dirty" /></label>
            <label>品項備註<input v-model="it.notes" maxlength="500" :disabled="readOnlyBody" :data-testid="'pe-item-notes-' + idx" @input="dirty" /></label>
          </li>
        </ul>
        <button v-if="!readOnlyBody" type="button" data-testid="pe-add-item" @click="addItem">新增品項</button>
      </section>

      <section class="pe-box" data-testid="pe-adjustments">
        <h2>調整列（運費、折扣、折價券、點數折抵）</h2>
        <p class="muted">金額會算進總額：運費是加項，折扣、折價券、點數折抵是減項（輸入正數，系統自動轉成負數）。原價與活動名稱只是備註，不參與計算。{{ priceMode === "INCL" ? "目前是含稅計價，這裡輸入含稅金額。" : "目前是未稅計價，這裡輸入未稅金額。" }}調整列會併入第一張有效進貨單的金額。</p>
        <ul class="pe-items" aria-label="調整列">
          <li v-for="(a, idx) in adjustments" :key="a.key" class="pe-item pe-adj-item" data-testid="pe-adj">
            <div class="pe-grid">
              <label>種類
                <select v-model="a.kind" :disabled="readOnlyBody" :data-testid="'pe-adj-kind-' + idx" @change="dirty">
                  <option v-for="k in ADJ_KINDS" :key="k" :value="k">{{ ADJ_KIND_LABELS[k] }}</option>
                </select>
              </label>
              <label>名稱（選填）<input v-model="a.label" maxlength="60" :disabled="readOnlyBody" :data-testid="'pe-adj-label-' + idx" @input="dirty" /></label>
              <label>金額{{ NEGATIVE_KINDS.includes(a.kind) ? "（輸入正數，視為扣除）" : a.kind === "OTHER" ? "（可輸入負數）" : "" }}<input v-model="a.amount" inputmode="numeric" :disabled="readOnlyBody" :data-testid="'pe-adj-amount-' + idx" @input="dirty" /></label>
              <label>原價（備註）<input v-model="a.original_price" inputmode="numeric" :disabled="readOnlyBody" :data-testid="'pe-adj-orig-' + idx" @input="dirty" /></label>
              <label>活動名稱（備註）<input v-model="a.campaign_name" maxlength="100" :disabled="readOnlyBody" :data-testid="'pe-adj-campaign-' + idx" @input="dirty" /></label>
              <label>備註<input v-model="a.note" maxlength="200" :disabled="readOnlyBody" :data-testid="'pe-adj-note-' + idx" @input="dirty" /></label>
            </div>
            <p v-if="NEGATIVE_KINDS.includes(a.kind) && a.amount" class="muted" :data-testid="'pe-adj-sign-' + idx">實際金額 −{{ money(Math.abs(Number(String(a.amount).replace(/,/g, "")) || 0)) }}</p>
            <p v-if="a.receipt_no" class="muted">已併入進貨單 {{ a.receipt_no }}</p>
            <button v-if="!readOnlyBody" type="button" class="link" :data-testid="'pe-adj-remove-' + idx" @click="removeAdj(idx)">移除此列</button>
          </li>
        </ul>
        <div v-if="!readOnlyBody" class="pe-adj-add">
          <button v-for="k in ADJ_KINDS" :key="k" type="button" :disabled="adjustments.length >= MAX_ADJUSTMENTS" :data-testid="'pe-adj-add-' + k" @click="addAdj(k)">新增{{ ADJ_KIND_LABELS[k] }}</button>
        </div>
      </section>

      <section class="pe-box" data-testid="pe-totals">
        <h2>金額</h2>
        <p v-if="priceMode === 'INCL'">含稅總額（輸入合計） <strong data-testid="pe-total">{{ money(totals.total_amount) }}</strong>　未稅小計 <strong data-testid="pe-subtotal">{{ money(totals.subtotal) }}</strong>　稅額 <span data-testid="pe-tax">{{ money(totals.tax_amount) }}</span>（{{ Math.round(settings.tax_rate * 10000) / 100 }}%）</p>
        <p v-else>未稅 <strong data-testid="pe-subtotal">{{ money(totals.subtotal) }}</strong>　稅額 <span data-testid="pe-tax">{{ money(totals.tax_amount) }}</span>（{{ Math.round(settings.tax_rate * 10000) / 100 }}%）　含稅總額 <strong data-testid="pe-total">{{ money(totals.total_amount) }}</strong></p>
        <p v-if="adjustments.length" class="muted" data-testid="pe-adj-total">含調整列合計 {{ money(totals.adjustment_total) }}</p>
        <p v-if="totalsError" class="field-error" role="alert" data-testid="pe-total-error">{{ totalsError }}</p>
        <p class="muted" data-testid="pe-approval-hint">{{ needsApprove ? `含稅總額超過 ${money(settings.approval_threshold)}，下訂前需要採購核准人核准。` : `含稅總額在 ${money(settings.approval_threshold)} 以內（或未啟用核准），可直接下訂。` }}</p>
      </section>

      <div class="dialog-actions">
        <button type="button" :disabled="saving" @click="backToList">取消</button>
        <button type="submit" class="primary" :disabled="saving || cannotEdit" data-testid="pe-save">{{ saving ? "儲存中…" : "儲存草稿" }}</button>
      </div>
    </form>
  </GaShell>
</template>

<style scoped>
.pe { display: grid; gap: 14px; min-width: 0; }
.pe-box { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; background: var(--surface); min-width: 0; }
.pe-box h2 { margin: 0; font-size: 16px; }
.pe-box label { display: grid; gap: 4px; min-width: 0; }
.pe-vendor { display: grid; gap: 6px; }
.legacy-link { font-size: 13px; }
.pe-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.pe-item { border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 8px; min-width: 0; }
.pe-mode { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.pe-mode label { display: flex; gap: 6px; align-items: center; }
.pe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.pe-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.pe-adj-add { display: flex; flex-wrap: wrap; gap: 8px; }
.pe-box p { margin: 0; overflow-wrap: anywhere; }
.pe-history { border-left: 3px solid var(--line); padding-left: 10px; font-size: 13px; }
.pe-history ul { margin: 4px 0 0; padding-left: 16px; }
.pre { white-space: pre-wrap; }
button.link { border: 0; background: transparent; color: var(--primary); text-decoration: underline; min-height: 30px; padding: 0 6px; }
@media (max-width: 700px) { .dialog-actions button, .pe-box > button, .pe-adj-add button { min-height: 44px; } .pe-adj-item .pe-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .pe-adj-item .pe-grid label:first-child { grid-column: 1 / -1; } }
</style>
