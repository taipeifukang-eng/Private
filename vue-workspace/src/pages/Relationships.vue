<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import {
  filterRelationshipMembers,
  lastFkrsNumber,
  matchesRelationshipFilter,
  relationshipFilters,
  relationshipPageCount,
} from "../relationship-members";
const props = defineProps<{ tab: WorkTab }>();
const section = ref("members"),
  members = ref<any[]>([]),
  sales = ref<any[]>([]),
  caps = ref<Record<string, boolean>>({}),
  loading = ref(false),
  salesLoading = ref(false),
  error = ref(""),
  message = ref(""),
  search = ref(""),
  filter = ref("all"),
  page = ref(1),
  salesPage = ref(1),
  saleName = ref(""),
  saleNumber = ref(""),
  loadedQuery = ref(""),
  salesLoaded = ref(false);
const modal = ref(""),
  target = ref<any>(null),
  form = ref<any>({}),
  baseline = ref(""),
  dialogError = ref(""),
  discard = ref(false),
  file = ref<File | null>(null);
const filters = relationshipFilters;
const matches = matchesRelationshipFilter;
const visible = computed(() =>
  filterRelationshipMembers(members.value, filter.value, search.value),
);
const pageCount = computed(() => relationshipPageCount(visible.value.length));
const rows = computed(() =>
  visible.value.slice(
    (Math.min(page.value, pageCount.value) - 1) * 50,
    Math.min(page.value, pageCount.value) * 50,
  ),
);
const salePages = computed(() =>
  Math.max(1, Math.ceil(sales.value.length / 50)),
);
const saleRows = computed(() =>
  sales.value.slice((salesPage.value - 1) * 50, salesPage.value * 50),
);
const lastNumber = computed(() => lastFkrsNumber(members.value));
const dirty = computed(
  () =>
    !!modal.value &&
    (["create", "edit", "reject"].includes(modal.value)
      ? JSON.stringify(form.value) !== baseline.value
      : modal.value === "import" && !!file.value),
);
watch(dirty, (v) => (props.tab.dirty = v), { flush: "sync" });
watch([search, filter], () => (page.value = 1));
const title = computed(
  () =>
    (
      ({
        create: "填寫關係會員申請",
        edit: "編輯關係會員",
        approve: "核可關係會員",
        reject: "駁回關係會員",
        delete: "刪除關係會員",
        import: "匯入銷售明細",
      }) as Record<string, string>
    )[modal.value],
);
const fmt = (v: any) =>
  v
    ? new Date(v).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour12: false,
      })
    : "—";
const person = (p: any) => p?.full_name || p?.email || "—";
const number = (n: number) =>
  n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const d = await api<any>("relationships");
    members.value = d.members;
    caps.value = d.capabilities;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function loadSales() {
  if (salesLoading.value) return;
  salesLoading.value = true;
  error.value = "";
  const q = new URLSearchParams({
    member_name: saleName.value.trim(),
    member_number: saleNumber.value.trim(),
  });
  try {
    sales.value = (await api<any>("relationships/sales?" + q)).sales;
    salesPage.value = 1;
    salesLoaded.value = true;
    loadedQuery.value =
      [q.get("member_name"), q.get("member_number")]
        .filter(Boolean)
        .join("／") || "全部會員";
  } catch (e: any) {
    error.value = e.message;
  } finally {
    salesLoading.value = false;
  }
}
function changeSection(s: string) {
  section.value = s;
  if (s === "sales" && !salesLoaded.value) void loadSales();
}
function open(action: string, m?: any) {
  modal.value = action;
  target.value = m || null;
  form.value =
    action === "reject"
      ? { rejection_reason: "" }
      : {
          member_name: m?.member_name || "",
          phone: m?.phone || "",
          relationship: m?.relationship || "",
          member_number: m?.member_number || "",
        };
  baseline.value = JSON.stringify(form.value);
  file.value = null;
  dialogError.value = "";
}
function close() {
  if (props.tab.busy) return;
  if (dirty.value) {
    discard.value = true;
    return;
  }
  modal.value = "";
}
function chooseFile(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0];
  if (f && !f.name.toLowerCase().endsWith(".xlsx")) {
    dialogError.value = "僅支援 .xlsx 格式";
    file.value = null;
    return;
  }
  file.value = f || null;
  dialogError.value = "";
}
async function save() {
  if (props.tab.busy) return false;
  const action = modal.value;
  dialogError.value = "";
  if (
    ["create", "edit"].includes(action) &&
    ["member_name", "phone", "relationship"].some((k) => !form.value[k].trim())
  ) {
    dialogError.value = "姓名、電話與關係皆為必填";
    return false;
  }
  if (action === "reject" && !form.value.rejection_reason.trim()) {
    dialogError.value = "請填寫駁回原因";
    return false;
  }
  if (action === "import" && !file.value) {
    dialogError.value = "請選擇 .xlsx 檔案";
    return false;
  }
  props.tab.busy = true;
  try {
    let path = "relationships",
      method = "POST",
      body: any = JSON.stringify(form.value);
    if (action === "import") {
      path += "/sales/import";
      body = new FormData();
      body.append("file", file.value!);
    } else if (action !== "create") {
      path += "/" + target.value.id;
      if (action === "edit") method = "PATCH";
      else if (action === "delete") {
        method = "DELETE";
        body = undefined;
      } else path += "/" + action;
    }
    const d = await api<any>(path, { method, body });
    message.value =
      action === "import"
        ? `匯入完成，共新增 ${d.imported} 筆銷售明細`
        : (
            {
              create: "關係會員申請已建立",
              edit: "關係會員資料已更新",
              approve: "關係會員已核可",
              reject: "關係會員已駁回",
              delete: "關係會員已刪除，銷售歷史仍保留",
            } as any
          )[action];
    modal.value = "";
    file.value = null;
    await load();
    if (action === "import") {
      saleName.value = "";
      saleNumber.value = "";
      section.value = "sales";
      await loadSales();
    } else if (salesLoaded.value) await loadSales();
    return true;
  } catch (e: any) {
    dialogError.value = e.message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function downloadTemplate() {
  try {
    const X = await import("xlsx");
    const sheet = X.utils.json_to_sheet([
      {
        門市代號: "FK001",
        銷售日期: "2026/06/12 14:30",
        會員編號: "M00001",
        品號: "P001",
        品名: "範例商品",
        數量: 1,
        金額: 100,
      },
    ]);
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, sheet, "關係會員銷售明細");
    X.writeFile(book, "關係會員銷售明細匯入範本.xlsx");
  } catch (e: any) {
    error.value = "範本下載失敗，請重試";
  }
}
props.tab.save = async () => {
  if (!dirty.value) return true;
  if (modal.value === "import") {
    dialogError.value = "請核對檔案後按「確認匯入」";
    return false;
  }
  return save();
};
onBeforeUnmount(() => delete props.tab.save);
onMounted(load);
</script>
<template>
  <section class="relationship-page">
    <header class="page-heading">
      <div>
        <small>組織與門市 / 會員管理</small>
        <h1>關係會員</h1>
        <p>管理關係會員申請資料與銷售明細</p>
      </div>
      <button
        :disabled="loading || salesLoading || tab.busy"
        @click="
          load();
          section === 'sales' && loadSales();
        "
      >
        重新整理
      </button>
    </header>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <nav class="actions section-tabs" aria-label="關係會員分頁">
      <button
        :aria-pressed="section === 'members'"
        @click="changeSection('members')"
      >
        會員申請與檢視</button
      ><button
        v-if="caps.sales"
        :aria-pressed="section === 'sales'"
        @click="changeSection('sales')"
      >
        銷售明細報表
      </button>
    </nav>
    <section v-show="section === 'members'">
      <div class="toolbar">
        <div class="actions">
          <button
            v-for="f in filters"
            :key="f.key"
            :aria-pressed="filter === f.key"
            @click="filter = f.key"
          >
            {{ f.label }}
            <strong>{{
              members.filter((m) => matches(m, f.key)).length
            }}</strong>
          </button>
        </div>
        <button v-if="caps.submit" class="primary" @click="open('create')">
          新增關係會員申請
        </button>
      </div>
      <div class="toolbar">
        <label
          >搜尋會員<input
            v-model="search"
            type="search"
            placeholder="姓名、電話、會員編號或申請人"
        /></label>
        <p v-if="filter === 'approved_missing_number'">
          目前 FKRS 會員編號最後一號：<strong>{{ lastNumber }}</strong>
        </p>
        <span>{{ loading ? "載入中…" : `符合 ${visible.length} 筆` }}</span>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>會員姓名／電話</th>
              <th>關係</th>
              <th>會員編號</th>
              <th>申請人／日期</th>
              <th>審核狀態</th>
              <th v-if="caps.edit || caps.delete || caps.approve">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="m.id">
              <td>
                <strong>{{ m.member_name }}</strong
                ><small>{{ m.phone }}</small>
              </td>
              <td>{{ m.relationship }}</td>
              <td>{{ m.member_number || "尚未填寫" }}</td>
              <td>
                {{ person(m.creator) }}<small>{{ fmt(m.created_at) }}</small>
              </td>
              <td>
                <template v-if="m.is_approved"
                  ><strong>已核可</strong
                  ><small
                    >{{ person(m.approver) }} · {{ fmt(m.approved_at) }}</small
                  ></template
                ><template v-else-if="m.rejected_at"
                  ><strong class="error">已駁回</strong
                  ><small
                    >{{ person(m.rejecter) }} · {{ fmt(m.rejected_at) }}</small
                  >
                  <p>{{ m.rejection_reason }}</p></template
                ><span v-else>待核可</span>
              </td>
              <td v-if="caps.edit || caps.delete || caps.approve">
                <div class="actions">
                  <template v-if="caps.approve && !m.is_approved"
                    ><button @click="open('approve', m)">核可</button
                    ><button @click="open('reject', m)">駁回</button></template
                  ><button v-if="caps.edit" @click="open('edit', m)">
                    編輯</button
                  ><button
                    v-if="caps.delete"
                    class="danger"
                    @click="open('delete', m)"
                  >
                    刪除
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && !rows.length">
              <td :colspan="caps.edit || caps.delete || caps.approve ? 6 : 5">
                沒有符合條件的會員
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="pager">
        <span>第 {{ Math.min(page, pageCount) }} / {{ pageCount }} 頁</span
        ><button :disabled="page <= 1" @click="page--">上一頁</button
        ><button :disabled="page >= pageCount" @click="page++">下一頁</button>
      </footer>
    </section>
    <section v-show="section === 'sales'">
      <div class="toolbar">
        <form class="actions" @submit.prevent="loadSales">
          <label>會員姓名<input v-model="saleName" type="search" /></label
          ><label>會員編號<input v-model="saleNumber" type="search" /></label
          ><button class="primary" :disabled="salesLoading">查詢銷售明細</button
          ><button
            type="button"
            :disabled="salesLoading"
            @click="
              saleName = '';
              saleNumber = '';
              loadSales();
            "
          >
            清除查詢
          </button>
        </form>
        <div v-if="caps.edit" class="actions">
          <button @click="downloadTemplate">下載範本</button
          ><button @click="open('import')">匯入銷售明細 Excel</button>
        </div>
      </div>
      <p v-if="salesLoading" role="status">載入銷售明細中…</p>
      <p v-if="salesLoaded" class="sales-total">
        {{ loadedQuery }} · {{ sales.length }} 筆 · 數量合計
        {{ number(sales.reduce((n, s) => n + Number(s.quantity || 0), 0)) }} ·
        金額合計
        {{ number(sales.reduce((n, s) => n + Number(s.amount || 0), 0)) }}
      </p>
      <p class="muted">
        每次查詢最多顯示最新 5,000 筆，合計以本次查詢結果計算。
      </p>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>門市代號</th>
              <th>銷售日期</th>
              <th>會員編號／姓名</th>
              <th>品號／品名</th>
              <th>數量</th>
              <th>金額</th>
              <th>匯入來源／時間</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in saleRows" :key="s.id">
              <td>{{ s.store_code || "—" }}</td>
              <td>{{ fmt(s.sale_datetime) }}</td>
              <td>
                {{ s.member_number }}<small>{{ s.member_name || "—" }}</small>
              </td>
              <td>
                {{ s.product_code }}<small>{{ s.product_name }}</small>
              </td>
              <td>{{ number(Number(s.quantity)) }}</td>
              <td>{{ number(Number(s.amount)) }}</td>
              <td>
                {{ s.import?.file_name || "—"
                }}<small>{{ fmt(s.imported_at) }}</small>
              </td>
            </tr>
            <tr v-if="!salesLoading && !saleRows.length">
              <td colspan="7">沒有符合條件的銷售明細</td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="pager">
        <span>第 {{ salesPage }} / {{ salePages }} 頁</span
        ><button :disabled="salesPage <= 1" @click="salesPage--">上一頁</button
        ><button :disabled="salesPage >= salePages" @click="salesPage++">
          下一頁
        </button>
      </footer>
    </section>
  </section>
  <Modal v-if="modal" :title="title" :busy="tab.busy" @cancel="close"
    ><form @submit.prevent="save">
      <p v-if="dialogError" role="alert" class="notice error">
        {{ dialogError }}
      </p>
      <fieldset :disabled="tab.busy">
        <template v-if="modal === 'create' || modal === 'edit'"
          ><label
            >關係會員姓名<input v-model="form.member_name" required /></label
          ><label>電話<input v-model="form.phone" type="tel" required /></label
          ><label
            >關係<input
              v-model="form.relationship"
              required
              placeholder="例如：配偶、父母、朋友" /></label
          ><label
            >會員編號<input
              v-model="form.member_number"
              :disabled="modal === 'create' || !!target?.member_number?.trim()"
              :placeholder="
                modal === 'create' ? '建立後再編輯填寫' : '可填寫會員編號'
              " /></label
          ><small v-if="target?.member_number"
            >會員編號已建立，不可清空或再次修改。</small
          ></template
        >
        <template v-else-if="modal === 'import'"
          ><p>
            前七欄依序為：門市代號、銷售日期、會員編號、品號、品名、數量、金額。
          </p>
          <p>
            日期格式：YYYY/MM/DD
            HH:MM。範本內的示例資料請先替換。匯入會新增明細，重複匯入會增加重複資料。
          </p>
          <label
            >銷售明細 Excel<input
              type="file"
              accept=".xlsx"
              @change="chooseFile"
          /></label>
          <p v-if="file">待匯入：{{ file.name }}</p></template
        >
        <template v-else
          ><p>
            會員：{{ target.member_name }} ·
            {{ target.member_number || "尚未填寫編號" }}
          </p>
          <label v-if="modal === 'reject'"
            >駁回原因<textarea
              v-model="form.rejection_reason"
              required
              rows="3"
            ></textarea>
          </label>
          <p v-else-if="modal === 'approve'">確認核可此會員申請？</p>
          <p v-else>確認刪除此會員？銷售歷史明細將保留。</p></template
        >
      </fieldset>
      <footer class="actions">
        <button type="button" :disabled="tab.busy" @click="close">取消</button
        ><button
          :class="modal === 'delete' ? 'danger' : 'primary'"
          :disabled="tab.busy || (modal === 'import' && !file)"
        >
          {{
            tab.busy
              ? "處理中…"
              : (
                  {
                    create: "送出申請",
                    edit: "儲存修改",
                    approve: "確認核可",
                    reject: "確認駁回",
                    delete: "確認刪除",
                    import: "確認匯入",
                  } as any
                )[modal]
          }}
        </button>
      </footer>
    </form></Modal
  >
  <Modal v-if="discard" title="放棄未儲存內容？" @cancel="discard = false"
    ><p>尚未儲存的內容將被放棄。</p>
    <div class="actions">
      <button @click="discard = false">繼續編輯</button
      ><button
        class="danger"
        @click="
          discard = false;
          modal = '';
          file = null;
        "
      >
        放棄變更
      </button>
    </div></Modal
  >
</template>
<style scoped>
.page-heading,
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 22px;
}
.page-heading p,
small {
  color: var(--muted);
}
h1 {
  margin: 10px 0;
}
.actions {
  display: flex;
  align-items: end;
  gap: 9px;
  flex-wrap: wrap;
}
.section-tabs {
  border-bottom: 1px solid var(--line);
  padding-bottom: 14px;
  margin-bottom: 24px;
}
button[aria-pressed="true"] {
  background: var(--primary);
  color: white;
}
.toolbar label {
  min-width: 220px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
input,
textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
  background: var(--surface);
}
input:disabled {
  background: var(--soft);
}
small {
  display: block;
  margin-top: 6px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 14px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th {
  background: var(--soft);
}
td p {
  margin: 6px 0;
  white-space: pre-wrap;
  max-width: 300px;
}
.danger,
.error {
  color: #a32a23;
}
.notice {
  padding: 12px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--soft);
  white-space: pre-line;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
}
.pager span {
  margin-right: auto;
}
fieldset {
  border: 0;
  padding: 12px 0;
  display: grid;
  gap: 16px;
}
form footer {
  justify-content: flex-end;
  margin-top: 18px;
}
.sales-total {
  font-weight: 600;
}
@media (max-width: 760px) {
  .toolbar form,
  .toolbar label {
    width: 100%;
  }
  .page-heading h1 {
    font-size: 24px;
  }
}
</style>
