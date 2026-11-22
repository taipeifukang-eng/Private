<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { api, ApiError } from "../api";
import type { WorkTab } from "../stores";
import { useSession } from "../stores";
import Modal from "../components/Modal.vue";
import { canDeleteReport, canRespondTo, canSeeAll, isResponseActive, shouldShowReminder, taipeiDate } from "../../../lib/stockout/response";

// 商品部缺貨回報（M6 W29）：店長回報缺貨、商品部依商品編號統一回覆、回覆歷程、近 30 天與歷史月份。
// 狀態一律由伺服端「該商品目前有沒有有效回覆」即時算出（C3）；規則見 lib/stockout/response.ts。
// 舊版畫面沒有「刪除商品部回覆」按鈕（API 有），新版同樣不放（m6-w29 項目 g）。
const props = defineProps<{ tab: WorkTab }>();
type Store = { id: string; store_code: string; store_name: string };
type Report = { id: string; store_id: string; product_code: string; product_name: string; required_qty: number; reported_by: string; status: "pending" | "responded"; created_at: string; store: Store | null };
type Resp = { id: string; product_code: string; product_name: string; response_content: string; responded_at: string; eta_date: string | null; active: boolean; reminder: boolean };
type Suggestion = { product_code: string; product_name: string; unit: string };
type Group = { product_code: string; product_name: string; reports: Report[]; response: Resp | null; latest: Resp | null };

const session = useSession();
const userId = computed(() => session.data?.user.id || "");
const caps = ref({ submit: false, viewAll: false, respond: false });
const stores = ref<Store[]>([]);
const items = ref<Report[]>([]);
const responses = ref<Record<string, Resp>>({});
const monthBuckets = ref<{ month: string; count: number }[]>([]);
const stats = ref({ reports: 0, pendingProducts: 0, respondedProducts: 0 });
const pagination = ref({ page: 1, pageSize: 30, total: 0, totalPages: 1 });
const ready = ref(false), loading = ref(false), error = ref(""), message = ref("");
const activeTab = ref<"all" | "my-store">("all");
const searchInput = ref(""), searchQuery = ref("");
const filterStatus = ref<"all" | "pending" | "responded">("pending");
const storeFilter = ref("all");
const useRecent = ref(true), selectedMonth = ref(""), monthOpen = ref(false);
const page = ref(1);
const expanded = ref(new Set<string>());
const histOpen = ref(new Set<string>()), histLoading = ref(new Set<string>());
const histMap = ref(new Map<string, any[]>());

const seeAll = computed(() => canSeeAll(caps.value));
const storeView = computed(() => !seeAll.value);
const today = computed(() => taipeiDate(new Date()));
const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" });

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: "30" });
    if (ready.value) q.set("tab", activeTab.value);
    if (searchQuery.value) q.set("q", searchQuery.value);
    if (filterStatus.value !== "all") q.set("status", filterStatus.value);
    if (storeFilter.value !== "all") q.set("store_id", storeFilter.value);
    if (useRecent.value) q.set("date_range", "recent_30");
    else if (selectedMonth.value) q.set("month", selectedMonth.value);
    const d = await api<any>("stockout?" + q);
    if (mine !== seq) return;
    caps.value = d.capabilities;
    stores.value = d.stores;
    if (!ready.value) {
      activeTab.value = d.defaultTab;
      ready.value = true;
      // 第一次載入用預設分頁；店長視角（只有提交權限）預設「我的門市」，商品部預設「全部門市」
      if (d.tab !== d.defaultTab) return void load();
    }
    items.value = d.items;
    responses.value = d.responses;
    monthBuckets.value = d.monthBuckets;
    stats.value = d.stats;
    pagination.value = d.pagination;
    if (page.value > d.pagination.totalPages) page.value = d.pagination.totalPages;
    if (storeView.value) for (const g of groups.value) if (g.response) expanded.value.add(g.product_code);
  } catch (e: any) {
    if (mine === seq) {
      items.value = [];
      error.value = e instanceof ApiError ? e.message : "載入失敗，請重試";
    }
  } finally {
    if (mine === seq) loading.value = false;
  }
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>();
  for (const r of items.value) {
    let g = map.get(r.product_code);
    if (!g) {
      const resp = responses.value[r.product_code] || null;
      g = { product_code: r.product_code, product_name: r.product_name, reports: [], response: resp && resp.active ? resp : null, latest: resp };
      map.set(r.product_code, g);
    }
    g.reports.push(r);
  }
  return Array.from(map.values()).sort((a, b) => a.product_code.localeCompare(b.product_code));
});

let timer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    searchQuery.value = searchInput.value.trim();
    page.value = 1;
    void load();
  }, 300);
});
onBeforeUnmount(() => clearTimeout(timer));
function refilter() {
  page.value = 1;
  void load();
}
function setTab(t: "all" | "my-store") {
  activeTab.value = t;
  storeFilter.value = "all";
  refilter();
}
function setStatus(s: typeof filterStatus.value) {
  filterStatus.value = s;
  refilter();
}
function pickRecent() {
  useRecent.value = true;
  selectedMonth.value = "";
  refilter();
}
function pickMonth(m: string) {
  useRecent.value = false;
  selectedMonth.value = m;
  refilter();
}
function go(n: number) {
  page.value = n;
  void load();
}
function toggle(code: string) {
  const n = new Set(expanded.value);
  n.has(code) ? n.delete(code) : n.add(code);
  expanded.value = n;
}
async function toggleHistory(code: string) {
  const open = new Set(histOpen.value);
  if (open.has(code)) open.delete(code);
  else open.add(code);
  histOpen.value = open;
  if (histMap.value.has(code) || !open.has(code)) return;
  histLoading.value = new Set(histLoading.value).add(code);
  try {
    const d = await api<any>(`stockout/history?product_code=${encodeURIComponent(code)}&page=1&pageSize=10`);
    histMap.value = new Map(histMap.value).set(code, d.data);
  } catch {
    /* 歷程載入失敗時保持空白，可再按一次重試 */
  } finally {
    const n = new Set(histLoading.value);
    n.delete(code);
    histLoading.value = n;
  }
}
const olderHistory = (g: Group) => (histMap.value.get(g.product_code) || []).filter((h) => !(g.response && h.responded_at === g.response.responded_at && h.response_content === g.response.response_content)).slice(0, 10);

/* ── 新增回報 ── */
const adding = ref(false);
const form = ref({ product_code: "", product_name: "", required_qty: 1 });
const addStoreId = ref("");
const unit = ref(""), nameFromMaster = ref(false);
const suggestions = ref<Suggestion[]>([]), showSuggestions = ref(false);
const existing = ref<Resp | null>(null), alertOpen = ref(false);
const addError = ref("");
const dupWarn = ref("");
const qtyInput = ref<HTMLInputElement>();
let suggestSeq = 0, suggestTimer: ReturnType<typeof setTimeout> | undefined;
const formDirty = computed(() => adding.value && (!!form.value.product_code || !!form.value.product_name));
watch(formDirty, (v) => (props.tab.dirty = v), { flush: "sync" });

function openAdd() {
  form.value = { product_code: "", product_name: "", required_qty: 1 };
  addStoreId.value = stores.value[0]?.id || "";
  unit.value = "";
  nameFromMaster.value = false;
  suggestions.value = [];
  showSuggestions.value = false;
  existing.value = null;
  alertOpen.value = false;
  addError.value = "";
  dupWarn.value = "";
  adding.value = true;
}
function closeAdd() {
  if (props.tab.busy) return;
  adding.value = false;
}
async function fetchResponse(code: string) {
  const d = await api<any>(`stockout/responses?product_codes=${encodeURIComponent(code)}`);
  const r: Resp | undefined = (d.data || [])[0];
  return r && shouldShowReminder(r, today.value) ? r : null;
}
// 80ms debounce；較舊的請求結果不會覆蓋較新的輸入
watch(
  () => form.value.product_code,
  (value) => {
    clearTimeout(suggestTimer);
    const code = value.trim();
    const mine = ++suggestSeq;
    if (!code) {
      suggestions.value = [];
      showSuggestions.value = false;
      existing.value = null;
      alertOpen.value = false;
      return;
    }
    suggestTimer = setTimeout(async () => {
      try {
        const [m, r] = await Promise.all([api<any>(`products-master/search?q=${encodeURIComponent(code)}`), api<any>(`stockout/responses?product_codes=${encodeURIComponent(code)}`)]);
        if (mine !== suggestSeq) return;
        suggestions.value = m.data || [];
        showSuggestions.value = suggestions.value.length > 0;
        const found: Resp | undefined = (r.data || [])[0];
        existing.value = found && shouldShowReminder(found, today.value) ? found : null;
      } catch {
        if (mine !== suggestSeq) return;
        suggestions.value = [];
        existing.value = null;
      }
    }, 80);
  },
);
onBeforeUnmount(() => clearTimeout(suggestTimer));
function focusQty() {
  void nextTick(() => {
    qtyInput.value?.focus();
    qtyInput.value?.select();
  });
}
function codeTyped() {
  unit.value = "";
  nameFromMaster.value = false;
  alertOpen.value = false;
  dupWarn.value = "";
}
async function selectSuggestion(s: Suggestion) {
  suggestSeq++; // 之後才到的舊搜尋結果不再蓋掉這次選擇
  clearTimeout(suggestTimer);
  form.value.product_code = s.product_code;
  form.value.product_name = s.product_name;
  unit.value = s.unit;
  nameFromMaster.value = true;
  suggestions.value = [];
  showSuggestions.value = false;
  try {
    existing.value = await fetchResponse(s.product_code);
    alertOpen.value = isResponseActive(existing.value, today.value);
    if (!alertOpen.value) focusQty();
  } catch {
    alertOpen.value = false;
    focusQty();
  }
}
async function codeEnter() {
  const code = form.value.product_code.trim();
  if (!code) return;
  try {
    let hit = suggestions.value.find((s) => s.product_code === code);
    if (!hit) {
      const d = await api<any>(`products-master/search?q=${encodeURIComponent(code)}`);
      suggestions.value = d.data || [];
      hit = suggestions.value.find((s) => s.product_code === code);
    }
    if (hit) await selectSuggestion(hit);
  } catch {
    alertOpen.value = false;
  }
}
async function nameInteract() {
  const code = form.value.product_code.trim();
  if (!code) return;
  let r = existing.value;
  if (!r) {
    try {
      r = existing.value = await fetchResponse(code);
    } catch {
      return;
    }
  }
  if (isResponseActive(r, today.value)) alertOpen.value = true;
}
function closeAlert() {
  alertOpen.value = false;
  focusQty();
}
async function submitReport(confirmDuplicate = false) {
  if (props.tab.busy) return;
  const f = form.value;
  if (!f.product_code.trim() || !f.product_name.trim()) {
    addError.value = "商品編號與商品名稱為必填";
    return;
  }
  if (!addStoreId.value) {
    addError.value = "請選擇門市";
    return;
  }
  props.tab.busy = true;
  addError.value = "";
  try {
    await api("stockout", { method: "POST", body: JSON.stringify({ store_id: addStoreId.value, ...f, ...(confirmDuplicate ? { confirm_duplicate: true } : {}) }) });
    dupWarn.value = "";
    adding.value = false;
    props.tab.dirty = false;
    message.value = `已送出缺貨回報「${f.product_code.trim()}」`;
    if (stores.value.length) activeTab.value = "my-store"; // 與舊版相同：送出後切到「我的門市」，確保看得到剛送出的回報
    filterStatus.value = "all";
    storeFilter.value = "all";
    page.value = 1;
    await load();
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 409 && e.data?.code === "DUPLICATE_RECENT") dupWarn.value = e.message;
    else addError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}

/* ── 商品部回覆 ── */
const target = ref<Group | null>(null);
const content = ref(""), etaDate = ref(""), respError = ref("");
function openRespond(g: Group) {
  target.value = g;
  content.value = g.response?.response_content ?? "";
  etaDate.value = g.response?.eta_date ?? "";
  respError.value = "";
}
async function saveResponse() {
  if (props.tab.busy || !target.value) return;
  if (!content.value.trim()) return void (respError.value = "回覆內容不得為空");
  if (!etaDate.value) return void (respError.value = "請填寫預計到貨日");
  props.tab.busy = true;
  respError.value = "";
  try {
    const g = target.value;
    await api("stockout/respond", { method: "POST", body: JSON.stringify({ product_code: g.product_code, product_name: g.product_name, response_content: content.value, eta_date: etaDate.value }) });
    histMap.value = new Map([...histMap.value].filter(([k]) => k !== g.product_code));
    histOpen.value = new Set([...histOpen.value].filter((k) => k !== g.product_code));
    message.value = `已儲存「${g.product_code}」的回覆`;
    target.value = null;
    filterStatus.value = "responded";
    page.value = 1;
    await load();
  } catch (e: any) {
    respError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}

/* ── 刪除回報 ── */
const delTarget = ref<Report | null>(null), delError = ref("");
async function confirmDelete() {
  if (props.tab.busy || !delTarget.value) return;
  props.tab.busy = true;
  delError.value = "";
  try {
    await api("stockout/" + delTarget.value.id, { method: "DELETE" });
    message.value = "已刪除這筆回報";
    delTarget.value = null;
    await load();
  } catch (e: any) {
    delError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}
const mayDelete = (r: Report) => canDeleteReport(caps.value, r.reported_by, userId.value);
const mayRespond = computed(() => canRespondTo(caps.value));
const earliest = (g: Group) => fmtDay(g.reports.reduce((a, r) => (r.created_at < a ? r.created_at : a), g.reports[0].created_at));
const totalQty = (g: Group) => g.reports.reduce((s, r) => s + r.required_qty, 0);

onMounted(load);
</script>

<template>
  <section class="merchandise-page">
    <header class="page-heading">
      <div>
        <small>跨部門 / 商品部</small>
        <h1>商品部管理</h1>
        <p>缺貨商品管理：店長回報缺貨，商品部依商品編號統一回覆</p>
      </div>
      <div class="actions">
        <button class="primary" :disabled="tab.busy || !ready" @click="openAdd">新增缺貨回報</button>
        <button :disabled="loading || tab.busy" @click="load">重新整理</button>
      </div>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>

    <div class="filters">
      <label>搜尋商品<input v-model="searchInput" type="search" placeholder="搜尋商品編號 / 品名" /></label>
      <label v-if="stores.length">門市
        <select v-model="storeFilter" @change="refilter">
          <option value="all">全部門市</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.store_code }} {{ s.store_name }}</option>
        </select>
      </label>
    </div>
    <div class="segments" role="group" aria-label="時間範圍">
      <button :class="{ on: useRecent }" @click="pickRecent">近 30 天（預設）</button>
      <button :aria-expanded="monthOpen" @click="monthOpen = !monthOpen">歷史月份 {{ monthOpen ? "收合" : "展開" }}</button>
    </div>
    <div v-if="monthOpen" class="months">
      <p v-if="!monthBuckets.length"><small>目前沒有可用的歷史月份資料</small></p>
      <button v-for="b in monthBuckets" :key="b.month" :class="{ on: !useRecent && selectedMonth === b.month }" @click="pickMonth(b.month)">{{ b.month }}（{{ b.count }}）</button>
    </div>

    <ul class="stats" aria-label="統計">
      <li><small>全部回報筆數</small><strong data-stat="reports">{{ stats.reports }}</strong></li>
      <li class="warn"><small>待回覆（品項數）</small><strong data-stat="pending">{{ stats.pendingProducts }}</strong></li>
      <li class="ok"><small>已回覆品項</small><strong data-stat="responded">{{ stats.respondedProducts }}</strong></li>
    </ul>

    <div class="segments toolbar">
      <template v-if="seeAll">
        <button :class="{ on: activeTab === 'all' }" @click="setTab('all')">全部門市</button>
        <button v-if="stores.length" :class="{ on: activeTab === 'my-store' }" @click="setTab('my-store')">我的門市</button>
      </template>
      <span class="gap"></span>
      <button v-for="s in (['all', 'pending', 'responded'] as const)" :key="s" :class="{ on: filterStatus === s }" @click="setStatus(s)">
        {{ s === "all" ? "全部" : s === "pending" ? "待回覆" : "已回覆" }}
      </button>
    </div>

    <p v-if="loading" role="status">載入中…</p>
    <p v-else-if="!groups.length" class="empty">目前沒有任何缺貨回報</p>
    <div v-else class="groups">
      <article v-for="g in groups" :key="g.product_code" class="group" :class="g.response ? 'done' : 'todo'" :data-product="g.product_code">
        <div class="group-head">
          <button class="head-main" :aria-expanded="expanded.has(g.product_code)" @click="toggle(g.product_code)">
            <span class="code">[{{ g.product_code }}]</span>
            <strong>{{ g.product_name }}</strong>
            <span class="badge" :class="g.response ? 'ok' : 'warn'" data-status>{{ g.response ? "已回覆" : "待回覆" }}</span>
            <small>{{ g.reports.length }} 間門市回報 · 合計需求 {{ totalQty(g) }} 件 · 最早 {{ earliest(g) }} 回報</small>
          </button>
          <button v-if="mayRespond" :disabled="tab.busy" @click="openRespond(g)">{{ g.response ? "編輯回覆" : "回覆" }}</button>
        </div>
        <div v-if="expanded.has(g.product_code)" class="group-body">
          <div v-if="!g.response && g.latest" class="expired">
            <strong>最近一次回覆（已過預計到貨日）</strong>
            <p>預計到貨：{{ g.latest.eta_date ?? "未填寫" }} · 回覆時間：{{ fmtTime(g.latest.responded_at) }}</p>
            <p class="pre">{{ g.latest.response_content }}</p>
          </div>
          <div v-if="g.response" class="reply" data-reply>
            <strong>商品部回覆</strong>
            <small> · {{ fmtTime(g.response.responded_at) }}</small>
            <p v-if="g.response.eta_date">預計到貨日：{{ g.response.eta_date }}</p>
            <p class="pre">{{ g.response.response_content }}</p>
            <button class="link" @click="toggleHistory(g.product_code)">{{ histOpen.has(g.product_code) ? "收合回覆歷程" : "展開回覆歷程" }}</button>
            <div v-if="histOpen.has(g.product_code)" class="history">
              <p v-if="histLoading.has(g.product_code)">載入歷程中…</p>
              <template v-else>
                <div v-for="h in olderHistory(g)" :key="h.id" class="hist-item">
                  <small>{{ fmtTime(h.responded_at) }}{{ h.eta_date ? ` · ETA ${h.eta_date}` : "" }}</small>
                  <p class="pre">{{ h.response_content }}</p>
                </div>
                <p v-if="!olderHistory(g).length"><small>目前沒有更早的回覆歷程</small></p>
              </template>
            </div>
          </div>
          <div class="detail">
            <small>門市回報明細</small>
            <ul>
              <li v-for="r in g.reports" :key="r.id">
                <span class="code">{{ r.store?.store_code }}</span>
                <span class="grow">{{ r.store?.store_name }}</span>
                <strong>×{{ r.required_qty }}</strong>
                <small>{{ fmtTime(r.created_at) }}</small>
                <button v-if="mayDelete(r)" class="danger" :disabled="tab.busy" :aria-label="`刪除 ${r.store?.store_name} 的回報`" @click="delTarget = r; delError = ''">刪除</button>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>

    <footer class="pager">
      <span>共 {{ pagination.total }} 筆 · 第 {{ pagination.page }} / {{ pagination.totalPages }} 頁</span>
      <button :disabled="page <= 1 || loading" @click="go(page - 1)">上一頁</button>
      <button :disabled="page >= pagination.totalPages || loading" @click="go(page + 1)">下一頁</button>
    </footer>
  </section>

  <Modal v-if="adding && stores.length" title="新增缺貨回報" :busy="tab.busy" @cancel="closeAdd">
    <form @submit.prevent="submitReport(false)">
      <p v-if="addError" role="alert" class="notice error">{{ addError }}</p>
      <fieldset :disabled="tab.busy">
        <label v-if="stores.length > 1">回報門市
          <select v-model="addStoreId" @change="dupWarn = ''">
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.store_code }} {{ s.store_name }}</option>
          </select>
        </label>
        <label>商品編號
          <input v-model="form.product_code" type="search" autocomplete="off" placeholder="輸入編號可搜尋商品主檔" @input="codeTyped" @keydown.enter.prevent="codeEnter" @focus="showSuggestions = suggestions.length > 0" />
        </label>
        <ul v-if="showSuggestions && suggestions.length" class="suggest" role="listbox" aria-label="商品建議">
          <li v-for="s in suggestions" :key="s.product_code" role="option" tabindex="0" @mousedown.prevent="selectSuggestion(s)" @keydown.enter="selectSuggestion(s)">
            <span><strong>{{ s.product_code }}</strong> {{ s.product_name }}</span>
            <small v-if="s.unit">{{ s.unit }}</small>
          </li>
        </ul>
        <label>商品名稱
          <span class="with-unit">
            <input v-model="form.product_name" :readonly="nameFromMaster" placeholder="例：感冒糖漿" @input="nameFromMaster = false" @click="nameInteract" @focus="nameInteract" />
            <small v-if="unit" class="unit" data-unit>{{ unit }}</small>
          </span>
        </label>
        <small v-if="nameFromMaster">名稱由主檔自動帶入，如需修改請直接編輯</small>
        <label>需求數量
          <input ref="qtyInput" v-model.number="form.required_qty" type="number" min="1" step="1" @change="form.required_qty = Math.max(1, Math.floor(Number(form.required_qty)) || 1)" />
        </label>
      </fieldset>
      <div v-if="existing" class="notice" :class="isResponseActive(existing, today) ? 'info' : 'amber'" data-existing>
        <strong>此商品已有商品部回覆{{ existing.eta_date ? `（預計到貨：${existing.eta_date}）` : "" }}</strong>
        <p v-if="!isResponseActive(existing, today)">此回覆預計到貨日已超過15天緩衝，建議仍送出回報讓商品部更新進度。</p>
        <p class="pre">{{ existing.response_content }}</p>
      </div>
      <div v-if="dupWarn" class="notice amber" role="alert" data-duplicate>
        <p>{{ dupWarn }}</p>
        <button type="button" class="primary" :disabled="tab.busy" @click="submitReport(true)">仍要送出</button>
      </div>
      <footer class="actions end">
        <button type="button" :disabled="tab.busy" @click="closeAdd">取消</button>
        <button class="primary" :disabled="tab.busy">{{ tab.busy ? "送出中…" : "送出回報" }}</button>
      </footer>
    </form>
  </Modal>
  <Modal v-if="adding && !stores.length" title="無法提交缺貨回報" @cancel="adding = false">
    <p>您尚未被指派管理任何門市，無法提交缺貨回報</p>
    <footer class="actions end"><button @click="adding = false">關閉</button></footer>
  </Modal>
  <Modal v-if="alertOpen && existing" title="商品部回覆提醒" @cancel="closeAlert">
    <p>此商品預計到貨日為: {{ existing.eta_date || "未填寫" }}，商品部已於 {{ fmtDay(existing.responded_at) }} 回覆此商品，回覆內容為:</p>
    <p v-if="!isResponseActive(existing, today)" class="notice amber">此回覆預計到貨日已超過15天緩衝，建議仍送出回報讓商品部更新進度。</p>
    <p class="pre box">{{ existing.response_content }}</p>
    <footer class="actions end"><button class="primary" @click="closeAlert">我知道了</button></footer>
  </Modal>

  <Modal v-if="target" :title="target.response ? '編輯回覆' : '回覆缺貨商品'" :busy="tab.busy" @cancel="!tab.busy && (target = null)">
    <p>[{{ target.product_code }}] {{ target.product_name }}</p>
    <p><small>共 {{ target.reports.length }} 間門市回報，合計需求 {{ totalQty(target) }} 件 · 最早 {{ earliest(target) }} 回報</small></p>
    <ul class="mini">
      <li v-for="r in target.reports" :key="r.id"><span>{{ r.store?.store_code }} {{ r.store?.store_name }}</span><strong>需求 {{ r.required_qty }} 件</strong></li>
    </ul>
    <form @submit.prevent="saveResponse">
      <p v-if="respError" role="alert" class="notice error">{{ respError }}</p>
      <fieldset :disabled="tab.busy">
        <label>回覆內容（缺貨原因 / 預計到貨時間 / 處理說明）
          <textarea v-model="content" rows="4" placeholder="例：目前廠商缺貨，預計下週三可到貨，請各門市耐心等候..."></textarea>
        </label>
        <label>預計到貨日<input v-model="etaDate" type="date" /></label>
      </fieldset>
      <footer class="actions end">
        <button type="button" :disabled="tab.busy" @click="target = null">取消</button>
        <button class="primary" :disabled="tab.busy">{{ tab.busy ? "儲存中…" : target.response ? "更新回覆" : "送出回覆" }}</button>
      </footer>
    </form>
  </Modal>

  <Modal v-if="delTarget" title="刪除回報" :busy="tab.busy" @cancel="!tab.busy && (delTarget = null)">
    <p v-if="delError" role="alert" class="notice error">{{ delError }}</p>
    <p>確定刪除這筆回報？</p>
    <p><small>{{ delTarget.store?.store_name }} · {{ delTarget.product_name }} ×{{ delTarget.required_qty }}</small></p>
    <footer class="actions end">
      <button :disabled="tab.busy" @click="delTarget = null">取消</button>
      <button class="danger" :disabled="tab.busy" @click="confirmDelete">{{ tab.busy ? "刪除中…" : "確定刪除" }}</button>
    </footer>
  </Modal>
</template>

<style scoped>
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
.page-heading p, small { color: var(--muted); }
h1 { margin: 10px 0; }
.actions { display: flex; align-items: end; gap: 9px; flex-wrap: wrap; }
.actions.end { justify-content: flex-end; margin-top: 18px; }
label { display: flex; flex-direction: column; gap: 7px; }
input:not([type="checkbox"]), select, textarea { padding: 10px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--surface); font: inherit; max-width: 100%; }
input[readonly] { background: var(--soft); }
.filters { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.filters label { min-width: 220px; flex: 1; }
.segments { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.segments .gap { flex: 1; }
.segments button.on, .months button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.months { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--soft); margin-bottom: 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 0; list-style: none; margin: 14px 0; }
.stats li { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; background: var(--surface); }
.stats strong { font-size: 1.6rem; }
.stats .warn strong { color: #b45309; }
.stats .ok strong { color: #0f7a3d; }
.groups { display: grid; gap: 12px; }
.group { border: 2px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--surface); }
.group.todo { border-color: #f4c48a; }
.group.done { border-color: #a6dcb9; }
.group-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--soft); flex-wrap: wrap; }
.head-main { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; text-align: left; border: 0; background: transparent; padding: 4px; color: inherit; }
.head-main small { flex-basis: 100%; }
.code { font-family: ui-monospace, monospace; color: var(--muted); }
.badge { font-size: .8rem; padding: 2px 9px; border-radius: 999px; }
.badge.ok { background: #cdeed9; color: #0b5a2d; }
.badge.warn { background: #fbdcb4; color: #7a3d03; }
.group-body { padding: 4px 14px 14px; display: grid; gap: 12px; }
.reply, .expired { border: 1px solid #a6dcb9; background: #effaf3; border-radius: 8px; padding: 10px 12px; }
.expired { border-color: #f4c48a; background: #fff6e8; }
.pre { white-space: pre-wrap; margin: 6px 0 0; }
.box { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: var(--soft); }
.link { border: 0; background: transparent; text-decoration: underline; padding: 6px 0 0; color: inherit; }
.history { margin-top: 8px; display: grid; gap: 8px; }
.hist-item { border: 1px solid #a6dcb9; background: var(--surface); border-radius: 6px; padding: 6px 10px; }
.detail ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
.detail li { display: flex; align-items: center; gap: 10px; background: var(--soft); border-radius: 6px; padding: 8px 10px; flex-wrap: wrap; }
.grow { flex: 1; min-width: 80px; }
.danger, .error { color: #a32a23; }
.notice { padding: 12px; border: 1px solid var(--primary); border-radius: 6px; background: var(--soft); white-space: pre-line; }
.notice.amber { border-color: #f4c48a; background: #fff6e8; }
.notice.info { border-color: #a6dcb9; background: #effaf3; }
.empty { text-align: center; padding: 40px 0; color: var(--muted); }
.pager { display: flex; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.pager span { margin-right: auto; }
fieldset { border: 0; padding: 12px 0; display: grid; gap: 14px; }
.suggest { list-style: none; margin: -8px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 6px; max-height: 180px; overflow-y: auto; background: var(--surface); }
.suggest li { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; cursor: pointer; }
.suggest li:hover, .suggest li:focus { background: var(--soft); }
.with-unit { position: relative; display: block; }
.with-unit input { width: 100%; box-sizing: border-box; }
.unit { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); margin: 0; }
.mini { list-style: none; padding: 10px; margin: 0 0 8px; background: var(--soft); border-radius: 6px; display: grid; gap: 4px; max-height: 144px; overflow-y: auto; }
.mini li { display: flex; justify-content: space-between; gap: 8px; }
</style>
