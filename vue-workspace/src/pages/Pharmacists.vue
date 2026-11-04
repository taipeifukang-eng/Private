<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api, taiwanMonth } from "../api";
import type { WorkTab } from "../stores";
import Modal from "../components/Modal.vue";
import {
  compressImageForMobile,
  isLicenseOverdue,
  isProofTooLarge,
  PROOF_FIELD_HINT,
  PROOF_TOO_LARGE_MESSAGE,
  zoneTotals,
} from "../pharmacist-proof";
const props = defineProps<{ tab: WorkTab }>();
const section = ref("overview"),
  month = ref(props.tab.month || taiwanMonth()),
  year = ref(Number(taiwanMonth().slice(0, 4))),
  zone = ref("all"),
  overview = ref<any>(null),
  master = ref<any>(null),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  search = ref(""),
  status = ref("active"),
  modal = ref(""),
  target = ref<any>(null),
  form = ref<any>({}),
  baseline = ref(""),
  dialogError = ref(""),
  discard = ref(false),
  listTitle = ref(""),
  detailRows = ref<any[]>([]),
  fees = ref<any[]>([]),
  feeEditing = ref(false),
  feeId = ref(""),
  proofFile = ref<File | null>(null),
  proofPath = ref(""),
  proofUrl = ref(""),
  proofPdf = ref(false),
  confirmation = ref(""),
  pendingFee = ref<any>(null),
  candidates = ref<any[]>([]),
  candidateSearch = ref(""),
  searching = ref(false);
const caps = computed(() => overview.value?.capabilities || {});
const monthLock = computed(() =>
  (overview.value?.lockedMonths || []).find(
    (l: any) => l.year_month === overview.value?.yearMonth,
  ),
);
const schools = [
  "國立臺灣大學",
  "臺北醫學大學",
  "國防醫學院",
  "中國醫藥大學",
  "國立成功大學",
  "高雄醫學大學",
  "嘉南藥理大學",
  "大仁科技大學",
  "國立陽明交通大學",
  "慈濟大學",
];
const cities = [
  "台北市",
  "新北市",
  "基隆市",
  "桃園市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "台中市",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "台南市",
  "高雄市",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
];
const states: Record<string, string> = {
  active: "在職",
  resigned: "離職",
  suspended: "留停",
};
const masterRows = computed(() =>
  (master.value?.data || [])
    .filter(
      (r: any) =>
        (!status.value || r.status === status.value) &&
        [r.employee_code, r.employee_name].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(search.value.toLowerCase()),
        ),
    )
    .sort(
      (a: any, b: any) =>
        Number(b.source === "manual") - Number(a.source === "manual") ||
        a.employee_code.localeCompare(b.employee_code),
    ),
);
// 規格 F2：主檔不分頁（照舊版一次列出全部符合的藥師）。
const visible = masterRows;
// 規格 F2：狀態篩選順序與字樣照舊版「在職／留停／已離職／全部」。
const statusFilterLabels: Record<string, string> = {
  active: "在職",
  suspended: "留停",
  resigned: "已離職",
};
// 規格 F1：?debug=1 時顯示 Debug 面板（伺服器只對管理員回傳內部資料）。
const debugMode = (() => {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
})();
const dirty = computed(
  () =>
    !!modal.value &&
    (["profile", "annual-add", "monthly-add"].includes(modal.value) ||
      (modal.value === "fees" && feeEditing.value)) &&
    (JSON.stringify(form.value) !== baseline.value || !!proofFile.value),
);
watch(dirty, (v) => (props.tab.dirty = v), { flush: "sync" });
function seniority(r: any) {
  if (!r.start_date) return "—";
  const a = new Date(r.start_date),
    b = r.resignation_date ? new Date(r.resignation_date) : new Date();
  let months =
    (b.getFullYear() - a.getFullYear()) * 12 +
    b.getMonth() -
    a.getMonth() -
    (b.getDate() < a.getDate() ? 1 : 0);
  months = Math.max(0, months);
  return `${Math.floor(months / 12)} 年 ${months % 12} 月`;
}
const fmt = (s: any) =>
  s
    ? new Date(s).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour12: false,
      })
    : "—";
async function loadOverview() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    overview.value = await api(
      "pharmacists/overview?" +
        new URLSearchParams({
          year_month: month.value,
          zone: zone.value,
          ...(debugMode ? { debug: "1" } : {}),
        }),
      { method: "POST" },
    );
    props.tab.month = overview.value.yearMonth;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function loadMaster() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    master.value = await api("pharmacists/master?year=" + year.value, {
      method: "POST",
    });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
function switchSection(s: string) {
  section.value = s;
  if (s === "master" && !master.value) void loadMaster();
}
function showRows(kind: string, store?: any) {
  modal.value = "rows";
  target.value = store || null;
  listTitle.value = store
    ? store.storeCode + " " + store.storeName
    : (
        {
          all: "當月藥師總數",
          newJoin: "新增任職",
          changed: "異動藥師",
          resigned: "離職藥師",
        } as any
      )[kind];
  const rs = store ? store.pharmacists : overview.value?.rows || [];
  detailRows.value = rs.filter((r: any) =>
    kind === "newJoin"
      ? r.change_type === "新增任職"
      : kind === "changed"
        ? !["無變更", "新增任職"].includes(r.change_type)
        : kind === "resigned"
          ? r.change_type === "離職"
          : true,
  );
  dialogError.value = "";
}
function begin(action: string, row?: any) {
  target.value = row || target.value;
  modal.value = action;
  dialogError.value = "";
  candidates.value = [];
  candidateSearch.value = "";
  form.value =
    action === "profile"
      ? {
          employee_code: row.employee_code,
          school: row.school || "",
          education_level: row.education_level || "",
          is_responsible_pharmacist: row.is_responsible_pharmacist,
          license_renewal_date: row.license_renewal_date || "",
        }
      : action === "annual-add"
        ? {
            year: master.value.year,
            employee_code: "",
            employee_name: "",
            join_date: "",
            current_position: "藥師",
            notes: "",
          }
        : action === "monthly-add"
          ? {
              year_month: overview.value.yearMonth,
              store_id: row.storeId,
              employee_code: "",
              employee_name: "",
              position: "藥師",
            }
          : {};
  baseline.value = JSON.stringify(form.value);
}
function close() {
  if (props.tab.busy) return;
  if (dirty.value) {
    discard.value = true;
    return;
  }
  modal.value = "";
}
async function findCandidates() {
  searching.value = true;
  dialogError.value = "";
  try {
    candidates.value =
      (
        await api<any>(
          "pharmacists/search?q=" + encodeURIComponent(candidateSearch.value),
        )
      ).data || [];
  } catch (e: any) {
    dialogError.value = e.message;
  } finally {
    searching.value = false;
  }
}
async function loadFees() {
  fees.value =
    (
      await api<any>(
        "pharmacists/fees?employee_code=" +
          encodeURIComponent(target.value.employee_code),
      )
    ).data || [];
}
async function showFees(row: any) {
  target.value = row;
  modal.value = "fees";
  feeEditing.value = false;
  dialogError.value = "";
  fees.value = [];
  props.tab.busy = true;
  try {
    await loadFees();
  } catch (e: any) {
    dialogError.value = e.message;
  } finally {
    props.tab.busy = false;
  }
}
function newFee(r?: any) {
  feeEditing.value = true;
  feeId.value = r?.id || "";
  proofFile.value = null;
  proofPath.value = r?.payment_proof_path || "";
  form.value = {
    association_city: r?.association_city || "",
    fee_year: r?.fee_year || Number(taiwanMonth().slice(0, 4)),
    fee_period_start: r?.fee_period_start || "",
    fee_period_end: r?.fee_period_end || "",
    notes: r?.notes || "",
  };
  baseline.value = JSON.stringify(form.value);
}
async function preview(path: string) {
  dialogError.value = "";
  try {
    const d = await api<any>(
      "pharmacists/proof?path=" + encodeURIComponent(path),
    );
    proofPdf.value = /\.pdf$/i.test(path);
    proofUrl.value = d.url;
  } catch (e: any) {
    dialogError.value = e.message;
  }
}
async function save() {
  if (props.tab.busy) return false;
  props.tab.busy = true;
  dialogError.value = "";
  try {
    let endpoint = "",
      method = "POST",
      payload: any = form.value;
    if (modal.value === "profile") {
      endpoint = "profiles";
      method = "PATCH";
      payload = {
        ...form.value,
        license_renewal_date: form.value.license_renewal_date || null,
      };
    } else if (modal.value === "annual-add") endpoint = "annual-manual";
    else if (modal.value === "monthly-add") endpoint = "monthly-manual";
    else if (modal.value === "annual-delete") {
      endpoint = "annual-manual";
      method = "DELETE";
      payload = {
        year: master.value.year,
        employee_code: target.value.employee_code,
      };
    } else if (modal.value === "month-lock" || modal.value === "annual-lock") {
      const annual = modal.value === "annual-lock";
      endpoint = annual ? "annual-lock" : "month-lock";
      const data = annual ? master.value : overview.value;
      method = data.isLocked ? "DELETE" : "POST";
      payload = annual ? { year: data.year } : { year_month: data.yearMonth };
    } else if (modal.value === "fees") {
      endpoint = "fees";
      if (proofFile.value && !proofPath.value) {
        const upload = await compressImageForMobile(proofFile.value);
        if (isProofTooLarge(upload.size)) throw Error(PROOF_TOO_LARGE_MESSAGE);
        const fd = new FormData();
        fd.append("file", upload);
        fd.append("employee_code", target.value.employee_code);
        proofPath.value = (
          await api<any>("pharmacists/proof", { method: "POST", body: fd })
        ).path;
      }
      if (feeId.value) {
        method = "PATCH";
        payload = {
          id: feeId.value,
          notes: form.value.notes,
          payment_proof_path: proofPath.value || null,
        };
      } else
        payload = {
          ...form.value,
          employee_code: target.value.employee_code,
          payment_proof_path: proofPath.value || null,
          fee_period_start: form.value.fee_period_start || null,
          fee_period_end: form.value.fee_period_end || null,
        };
    }
    await api("pharmacists/" + endpoint, {
      method,
      body: JSON.stringify(payload),
    });
    message.value = "儲存完成";
    if (modal.value === "fees") {
      feeEditing.value = false;
      proofFile.value = null;
      baseline.value = JSON.stringify(form.value);
      await loadFees();
    } else modal.value = "";
    if (section.value === "master") await loadMaster();
    else await loadOverview();
    return true;
  } catch (e: any) {
    dialogError.value = e.message;
    return false;
  } finally {
    props.tab.busy = false;
  }
}
async function deleteFee() {
  props.tab.busy = true;
  dialogError.value = "";
  try {
    await api("pharmacists/fees?id=" + pendingFee.value.id, {
      method: "DELETE",
    });
    confirmation.value = "";
    await loadFees();
    await loadMaster();
  } catch (e: any) {
    dialogError.value = e.message;
    confirmation.value = "";
  } finally {
    props.tab.busy = false;
  }
}
props.tab.save = async () => (dirty.value ? save() : true);
onBeforeUnmount(() => delete props.tab.save);
onMounted(loadOverview);
</script>
<template>
  <section class="pharmacists-page">
    <header class="heading">
      <div>
        <small>組織與門市 / 藥師資料</small>
        <h1>藥師管理</h1>
      </div>
      <button
        :disabled="loading || tab.busy"
        @click="section === 'overview' ? loadOverview() : loadMaster()"
      >
        重新整理
      </button>
    </header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <nav class="actions tabs">
      <button
        :disabled="loading"
        :aria-pressed="section === 'overview'"
        @click="switchSection('overview')"
      >
        督導區總覽</button
      ><button
        v-if="caps.master"
        :disabled="loading"
        :aria-pressed="section === 'master'"
        @click="switchSection('master')"
      >
        藥師主檔
      </button>
    </nav>
    <p v-if="loading" role="status">載入與同步中…</p>
    <section v-show="section === 'overview'">
      <form class="filters" @submit.prevent="loadOverview">
        <label>月份<input v-model="month" type="month" required /></label
        ><label
          >督導區<select v-model="zone">
            <option value="all">全部督導區</option>
            <option v-for="z in overview?.zoneOptions" :key="z">{{ z }}</option>
          </select></label
        ><button class="primary" :disabled="loading">查詢總覽</button
        ><button
          v-if="caps.edit"
          type="button"
          :disabled="loading || !overview"
          @click="begin('month-lock')"
        >
          {{ overview?.isLocked ? "解除月份關帳" : "月份關帳" }}</button
        ><span>{{
          overview?.isLocked ? "本月已關帳" : "未關帳月份會同步人事異動"
        }}</span
        ><small v-if="overview?.isLocked && monthLock" data-month-lock-info
          >由 {{ monthLock.locked_by }} 關帳於
          {{ String(monthLock.locked_at).slice(0, 10) }}</small
        >
      </form>
      <div
        v-if="debugMode && overview?.debug"
        class="notice error"
        data-debug-panel
      >
        <strong>Debug 資訊（server-side）</strong>
        <pre style="max-height: 20rem; overflow: auto; white-space: pre-wrap; word-break: break-all">{{ JSON.stringify(overview.debug, null, 2) }}</pre>
      </div>
      <p v-if="overview && !caps.edit" class="notice" data-view-only>
        目前為檢視模式（僅可查看，無法編輯）。
      </p>
      <div v-if="overview" class="metrics">
        <button @click="showRows('all')">
          當月藥師總數 <strong>{{ overview.summary.total }}</strong></button
        ><button @click="showRows('newJoin')">
          新增任職 <strong>{{ overview.summary.newJoin }}</strong></button
        ><button @click="showRows('changed')">
          異動藥師 <strong>{{ overview.summary.changed }}</strong></button
        ><button @click="showRows('resigned')">
          離職藥師
          <strong>{{
            overview.rows.filter((r: any) => r.change_type === "離職").length
          }}</strong>
        </button>
      </div>
      <section
        v-for="card in overview?.cards"
        :key="card.supervisorZone"
        class="zone"
      >
        <h2>
          {{ card.supervisorZone }}
          <small data-zone-totals
            >門市數：{{ zoneTotals(card).stores }}　藥師數：{{
              zoneTotals(card).pharmacists
            }}</small
          >
        </h2>
        <div class="stores">
          <button
            v-for="s in card.stores"
            :key="s.storeId"
            @click="showRows('all', s)"
          >
            <span>{{ s.storeCode }} {{ s.storeName }}</span
            ><strong>{{ s.pharmacistCount }} 位藥師</strong>
          </button>
        </div>
      </section>
      <p v-if="overview && !overview.cards.length">
        目前沒有可查看的門市範圍。
      </p>
      <p v-else-if="overview" class="muted">
        點選門市可查看藥師明細。明細中的變化備註會顯示上月職級或上月門市，無變化則留白。
      </p>
    </section>
    <section v-show="section === 'master'">
      <form class="filters" @submit.prevent="loadMaster">
        <label
          >年度<input
            v-model.number="year"
            type="number"
            min="2020"
            max="2100"
            required /></label
        ><button class="primary" :disabled="loading">查詢主檔</button
        ><button
          v-if="caps.masterEdit"
          type="button"
          :disabled="loading || !master"
          @click="begin('annual-lock')"
        >
          {{ master?.isLocked ? "解除年度關帳" : "年度關帳" }}</button
        ><button
          v-if="caps.masterEdit"
          type="button"
          :disabled="loading || !master || master.isLocked"
          @click="begin('annual-add')"
        >
          手動新增藥師
        </button>
      </form>
      <p v-if="master">
        {{ master.year }} 年度 ·
        {{ master.isLocked ? "已關帳，停止自動同步" : "未關帳"
        }}<small v-if="master.isLocked && master.lockInfo" data-annual-lock-info
          >由 {{ master.lockInfo.locked_by }} 關帳於
          {{ String(master.lockInfo.locked_at).slice(0, 10) }}</small
        ><small v-else>同步時間：{{ fmt(master.syncedAt) }}</small>
      </p>
      <div class="filters">
        <label
          >搜尋藥師<input
            v-model="search"
            type="search"
            placeholder="員編或姓名" /></label
        ><label
          >狀態<select v-model="status">
            <option v-for="(v, k) in statusFilterLabels" :value="k" :key="k">
              {{ v }}
            </option>
            <option value="">全部</option>
          </select></label
        ><span>符合 {{ masterRows.length }} 位</span>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>員編／姓名</th>
              <th>門市／職稱</th>
              <th>狀態</th>
              <th>到職日／年資</th>
              <th>畢業學校／學歷</th>
              <th>負責藥師</th>
              <th>執照更新日</th>
              <th>常年會費</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in visible" :key="r.employee_code">
              <td>
                {{ r.employee_name
                }}<small>{{
                  /^MANUAL/i.test(r.employee_code) && r.source === "manual"
                    ? "手動新增"
                    : r.employee_code
                }}</small
                ><small v-if="r.notes">{{ r.notes }}</small>
              </td>
              <td>
                {{ r.store_code }} {{ r.store_name || "—"
                }}<small>{{ r.current_position }}</small>
              </td>
              <td>
                {{ states[r.status] || r.status
                }}<small>{{ r.status_date || "—" }}</small>
              </td>
              <td>
                {{ r.start_date || "—" }}<small>{{ seniority(r) }}</small
                ><small v-if="r.resignation_date"
                  >離職：{{ r.resignation_date }}</small
                >
              </td>
              <td>
                {{ r.school || "—"
                }}<small>{{ r.education_level || "—" }}</small>
              </td>
              <td>{{ r.is_responsible_pharmacist ? "是" : "否" }}</td>
              <td
                data-license-date
                :data-overdue="isLicenseOverdue(r.license_renewal_date)"
                :class="{ overdue: isLicenseOverdue(r.license_renewal_date) }"
              >
                {{ r.license_renewal_date || "—" }}
              </td>
              <td>
                <button
                  :class="{ 'fee-current': r.annual_fee_is_blue }"
                  @click="showFees(r)"
                >
                  {{ r.annual_fee_is_blue ? "有效繳費紀錄" : "查看／登記會費" }}
                </button>
              </td>
              <td>
                <div class="actions">
                  <button v-if="caps.masterEdit" @click="begin('profile', r)">
                    編輯</button
                  ><button
                    v-if="
                      caps.masterEdit &&
                      r.source === 'manual' &&
                      !master.isLocked
                    "
                    class="danger"
                    @click="begin('annual-delete', r)"
                  >
                    刪除
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!visible.length && !loading">
              <td colspan="9">沒有符合條件的藥師</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" data-master-legend>
        執照更新日顯示紅色代表已逾期。畢業學校、學歷、負責藥師、執照更新日可點「編輯」修改後儲存。
        點「查看／登記會費」可查看或新增該藥師的常年會費申請記錄。常年會費按鈕為實色代表目前規則判定為已具備有效紀錄。手動新增的人員會在姓名下方顯示「手動新增」。
      </p>
    </section>
  </section>
  <Modal
    v-if="modal"
    :title="
      modal === 'rows'
        ? listTitle
        : modal === 'fees'
          ? target.employee_name + ' · 常年會費'
          : (
              {
                profile: '編輯藥師資料',
                'annual-add': '手動新增年度藥師',
                'monthly-add': '補入門市藥師',
                'annual-delete': '刪除手動新增藥師',
                'month-lock': '確認月份關帳設定',
                'annual-lock': '確認年度關帳設定',
              } as any
            )[modal]
    "
    :wide="modal === 'rows' || modal === 'fees'"
    :busy="tab.busy"
    @cancel="close"
  >
    <p v-if="dialogError" role="alert" class="notice error">
      {{ dialogError }}
    </p>
    <template v-if="modal === 'rows'"
      ><div class="actions">
        <button
          v-if="target && caps.addMonthly && !overview.isLocked"
          class="primary"
          @click="begin('monthly-add', target)"
        >
          手動補入藥師
        </button>
      </div>
      <div class="module-table">
        <table>
          <thead>
            <tr>
              <th>門市</th>
              <th>員編</th>
              <th>姓名</th>
              <th>職級</th>
              <th>變化</th>
              <th>變化備註</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in detailRows" :key="r.id">
              <td>{{ r.store_code }} {{ r.store_name }}</td>
              <td>{{ r.employee_code }}</td>
              <td>{{ r.employee_name }}</td>
              <td>{{ r.position }}</td>
              <td>{{ r.change_type }}</td>
              <td>{{ r.change_note }}</td>
            </tr>
            <tr v-if="!detailRows.length">
              <td colspan="6">沒有藥師資料</td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="actions">
        <button @click="close">關閉</button>
      </footer></template
    >
    <template v-else-if="modal === 'fees'"
      ><button
        v-if="caps.masterEdit && !feeEditing"
        class="primary"
        @click="newFee()"
      >
        新增會費紀錄
      </button>
      <div v-if="!feeEditing" class="module-table">
        <table>
          <thead>
            <tr>
              <th>年度／公會</th>
              <th>繳費期間</th>
              <th>備註／建立人</th>
              <th>繳費證明</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in fees" :key="f.id">
              <td>
                {{ f.fee_year }} 年<small>{{ f.association_city }}</small>
              </td>
              <td>
                {{ f.fee_period_start || "—" }} ～ {{ f.fee_period_end || "—" }}
              </td>
              <td>
                {{ f.notes || "—"
                }}<small
                  >{{ f.created_by_name || "—" }} ·
                  {{ fmt(f.created_at) }}</small
                >
              </td>
              <td>
                <button
                  v-if="f.payment_proof_path"
                  @click="preview(f.payment_proof_path)"
                >
                  查看證明</button
                ><span v-else>未附證明</span>
              </td>
              <td>
                <div v-if="caps.masterEdit" class="actions">
                  <button @click="newFee(f)">編輯備註／證明</button
                  ><button
                    class="danger"
                    @click="
                      pendingFee = f;
                      confirmation = 'fee-delete';
                    "
                  >
                    刪除
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!fees.length">
              <td colspan="5">尚無會費紀錄</td>
            </tr>
          </tbody>
        </table>
      </div>
      <form v-else @submit.prevent="save">
        <fieldset :disabled="tab.busy">
          <label
            >縣市公會<select
              v-model="form.association_city"
              required
              :disabled="!!feeId"
            >
              <option value="">請選擇</option>
              <option v-for="c in cities" :key="c">{{ c }}</option>
            </select></label
          ><label
            >申請年度<input
              v-model.number="form.fee_year"
              type="number"
              min="2000"
              max="2100"
              required
              :disabled="!!feeId" /></label
          ><template v-if="form.association_city === '基隆市'"
            ><label
              >期間起日<input
                v-model="form.fee_period_start"
                type="date"
                :disabled="!!feeId" /></label
            ><label
              >期間迄日<input
                v-model="form.fee_period_end"
                type="date"
                :disabled="!!feeId" /></label></template
          ><label>備註<textarea v-model="form.notes" rows="3"></textarea></label
          ><label
            >繳費證明（照片／PDF）<input
              type="file"
              accept="image/*,.pdf"
              @change="
                proofFile =
                  ($event.target as HTMLInputElement).files?.[0] || null;
                proofPath = '';
              " /></label
          ><small>{{ PROOF_FIELD_HINT }}</small>
        </fieldset>
        <button class="primary" :disabled="tab.busy">儲存會費紀錄</button
        ><button
          type="button"
          :disabled="tab.busy"
          @click="dirty ? (confirmation = 'cancel-fee') : (feeEditing = false)"
        >
          返回會費列表
        </button>
      </form>
      <footer class="actions">
        <button :disabled="tab.busy" @click="close">關閉</button>
      </footer></template
    >
    <form v-else @submit.prevent="save">
      <fieldset :disabled="tab.busy">
        <template v-if="modal === 'profile'"
          ><p>{{ target.employee_code }} {{ target.employee_name }}</p>
          <label
            >畢業學校<select v-model="form.school">
              <option value="">未填寫</option>
              <option v-for="s in schools" :key="s">{{ s }}</option>
            </select></label
          ><label
            >學歷<select v-model="form.education_level">
              <option value="">未填寫</option>
              <option>博士</option>
              <option>碩士</option>
              <option>學士</option>
            </select></label
          ><label class="check"
            ><input
              v-model="form.is_responsible_pharmacist"
              type="checkbox"
            />負責藥師</label
          ><label
            >執照更新日<input
              v-model="form.license_renewal_date"
              type="date" /></label
        ></template>
        <template v-else-if="modal === 'annual-add' || modal === 'monthly-add'"
          ><p>
            {{
              modal === "annual-add"
                ? form.year + " 年度"
                : form.year_month + " · " + target.storeName
            }}
          </p>
          <div v-if="modal === 'monthly-add'">
            <label
              >搜尋人員<input
                v-model="candidateSearch"
                placeholder="員編或姓名，至少兩字" /></label
            ><button
              type="button"
              :disabled="candidateSearch.trim().length < 2 || searching"
              @click="findCandidates"
            >
              搜尋
            </button>
            <div class="candidate-list">
              <button
                v-for="c in candidates"
                :key="c.employee_code"
                type="button"
                @click="
                  form.employee_code = c.employee_code;
                  form.employee_name = c.employee_name;
                  form.position = c.position || '藥師';
                "
              >
                {{ c.employee_code }} {{ c.employee_name }} ·
                {{ c.from_store_name }}
              </button>
            </div>
          </div>
          <label
            >員工編號<input
              v-model="form.employee_code"
              :required="modal === 'monthly-add'"
              :placeholder="
                modal === 'annual-add' ? '選填；未填由系統產生' : ''
              " /></label
          ><label>姓名<input v-model="form.employee_name" required /></label
          ><template v-if="modal === 'annual-add'"
            ><label
              >到職日<input
                v-model="form.join_date"
                type="date"
                required /></label
            ><label>職稱<input v-model="form.current_position" /></label
            ><label
              >備註<textarea v-model="form.notes"></textarea></label></template
          ><label v-else>職級<input v-model="form.position" required /></label
        ></template>
        <p v-else-if="modal === 'annual-delete'">
          確認刪除 {{ master.year }} 年度手動新增的 {{ target.employee_name }}？
        </p>
        <p v-else>
          {{
            modal === "annual-lock"
              ? master.year + " 年度"
              : overview.yearMonth
          }}：確認{{
            (modal === "annual-lock" ? master.isLocked : overview.isLocked)
              ? "解除關帳，恢復同步人事異動"
              : "關帳，停止自動同步人事異動"
          }}？
        </p>
      </fieldset>
      <footer class="actions">
        <button type="button" :disabled="tab.busy" @click="close">取消</button
        ><button class="primary" :disabled="tab.busy">
          {{
            tab.busy
              ? "處理中…"
              : modal.includes("lock")
                ? "確認變更"
                : modal === "annual-delete"
                  ? "確認刪除"
                  : "儲存"
          }}
        </button>
      </footer>
    </form></Modal
  >
  <Modal v-if="proofUrl" title="繳費證明" wide @cancel="proofUrl = ''"
    ><iframe
      v-if="proofPdf"
      :src="proofUrl"
      title="繳費證明 PDF"
      style="width: 100%; height: 65vh; border: 0"
    ></iframe
    ><img
      v-else
      :src="proofUrl"
      alt="繳費證明"
      style="display: block; max-width: 100%; max-height: 65vh; margin: auto"
    />
    <p>
      <a :href="proofUrl" download target="_blank" rel="noopener"
        >下載原始證明</a
      >
    </p>
    <button @click="proofUrl = ''">關閉</button></Modal
  >
  <Modal
    v-if="discard || confirmation"
    :title="confirmation === 'fee-delete' ? '刪除會費紀錄' : '放棄未儲存內容？'"
    :busy="tab.busy"
    @cancel="
      discard = false;
      confirmation = '';
    "
    ><p>
      {{
        confirmation === "fee-delete"
          ? "確認刪除此會費紀錄與繳費證明？"
          : "尚未儲存的內容將被放棄。"
      }}
    </p>
    <div class="actions">
      <button
        :disabled="tab.busy"
        @click="
          discard = false;
          confirmation = '';
        "
      >
        返回</button
      ><button
        class="danger"
        :disabled="tab.busy"
        @click="
          confirmation === 'fee-delete'
            ? deleteFee()
            : confirmation === 'cancel-fee'
              ? ((feeEditing = false), (proofFile = null), (confirmation = ''))
              : ((discard = false), (modal = ''))
        "
      >
        {{ confirmation === "fee-delete" ? "確認刪除" : "放棄變更" }}
      </button>
    </div></Modal
  >
</template>
<style scoped>
.heading,
.filters,
.actions,
.pager {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.heading {
  justify-content: space-between;
  margin-bottom: 22px;
}
.filters {
  align-items: end;
  margin: 22px 0;
}
.actions {
  margin: 12px 0;
}
.tabs {
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
h1 {
  margin: 10px 0;
}
h2 {
  font-size: 17px;
}
.metrics,
.stores {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
  margin: 18px 0;
}
.metrics button,
.stores button {
  text-align: left;
  min-height: 68px;
  background: var(--surface);
  border: 1px solid var(--line);
}
.metrics strong,
.stores strong {
  display: block;
  margin-top: 8px;
  color: var(--primary);
}
.zone {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}
button[aria-pressed="true"],
.fee-current {
  background: var(--primary);
  color: white;
}
td.overdue {
  color: #c0262d;
  font-weight: 600;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
input,
select,
textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--ink);
}
small {
  display: block;
  color: var(--muted);
  margin-top: 5px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
th {
  background: var(--soft);
}
.error,
.danger {
  color: #a32a23;
}
.notice {
  padding: 12px;
  background: var(--soft);
  border-left: 3px solid var(--primary);
  white-space: pre-line;
}
fieldset {
  border: 0;
  padding: 10px 0;
  display: grid;
  gap: 16px;
}
.check input[type="checkbox"] {
  width: 18px;
  height: 18px;
  min-height: 18px;
  flex: 0 0 18px;
  padding: 0;
  margin: 0;
}
.check {
  flex-direction: row;
  align-items: center;
}
.pager {
  margin-top: 18px;
}
.pager span {
  margin-right: auto;
}
.candidate-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
footer.actions {
  justify-content: flex-end;
}
.module-table {
  margin-top: 16px;
}
@media (max-width: 760px) {
  .filters label {
    width: 100%;
  }
  .stores,
  .metrics {
    grid-template-columns: 1fr 1fr;
  }
  .stores button,
  .metrics button {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
</style>
