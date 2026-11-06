<script setup lang="ts">
// M3 W12 首頁：版面順序照舊版（調店確認 → 每月版更 → 我的獎金 → 新人入職 → 任務、壽星、年費、執照），
// 問候只留「歡迎回來，姓名」（C.5），新版快捷入口（巡店、活動、版更）放在提醒卡片下方。
// 資料全部來自 GET /api/workspace/home。
import { computed, onMounted, ref } from "vue";
import { ArrowRight, ArrowRightLeft, BellRing, Cake, ClipboardList, CalendarRange, ExternalLink, FileText, UserPlus } from "lucide-vue-next";
import { api } from "../api";
import { useSession, useWorkspace } from "../stores";

const session = useSession(),
  work = useWorkspace(),
  data = ref<any>(null),
  error = ref(""),
  loading = ref(true);
const caps = computed(() => session.data?.capabilities || ({} as any));
const name = computed(() => data.value?.name || session.data?.user?.name || "");
const labels: Record<string, string> = { pending: "待處理", in_progress: "進行中", completed: "已完成" };
const amount = (n: number) => Number(n || 0).toLocaleString("zh-TW");
const slash = (s: string) => s.replace(/-/g, "/");
const recentBonus = computed(() => (data.value?.bonus?.months || []).slice(0, 3));
const olderBonus = computed(() => (data.value?.bonus?.months || []).slice(3));
const licenseGroups = computed(() => {
  const rows: any[] = data.value?.license?.rows || [];
  const map = new Map<string, any[]>();
  for (const r of rows) map.set(r.supervisor_zone, [...(map.get(r.supervisor_zone) || []), r]);
  return Array.from(map.entries());
});
const legacyQuick = computed(() =>
  (session.data?.navigation || [])
    .flatMap((g) => g.items)
    .filter((i) => ["/monthly-status", "/admin/performance", "/inventory", "/general-affairs"].includes(i.href)),
);
function legacyHref(href: string) {
  return session.data?.integrated ? href : "http://localhost:3002" + href;
}
const hasQuick = computed(() => caps.value.inspections || caps.value.campaigns || caps.value.monthlyRelease);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await api<any>("home");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="home">
    <header>
      <p class="eyebrow">工作總覽</p>
      <h1>歡迎回來，{{ name }}</h1>
    </header>
    <p v-if="error" role="alert" class="notice error">
      {{ error }} <button @click="load">重試</button>
    </p>
    <p v-if="loading && !data" role="status" class="muted">載入首頁…</p>

    <template v-if="data">
      <!-- 1. 調店登記確認 -->
      <button
        v-if="data.transfer.show && caps.transfers"
        class="home-banner"
        data-home-card="transfer-confirm"
        @click="work.open('transfers')"
      >
        <ArrowRightLeft :size="24" />
        <span>
          <strong>調店登記確認 <em data-home="transfer-count">{{ data.transfer.pendingCount }} 待確認</em></strong>
          <small>有 {{ data.transfer.pendingCount }} 筆調店申請待審核</small>
        </span>
        <ArrowRight :size="18" />
      </button>

      <!-- 2. 每月版更 -->
      <button v-if="caps.monthlyRelease" class="home-banner plain" data-home-card="monthly-release" @click="work.open('monthly-release')">
        <FileText :size="24" />
        <span><strong>每月版更內容</strong><small>查看本月系統調整內容與實際使用影響</small></span>
        <ArrowRight :size="18" />
      </button>

      <!-- 3. 我的每月獎金明細 -->
      <section v-if="data.bonus.visible" class="home-card" data-home-card="bonus" aria-label="我的每月獎金明細">
        <div class="home-card-head">
          <h2>我的每月獎金明細<small v-if="data.employeeCode">員編：{{ data.employeeCode }}</small></h2>
          <button v-if="caps.monthly" @click="work.open('monthly')">前往月狀態</button>
        </div>
        <p v-if="!data.bonus.months.length" class="muted" data-home="bonus-empty">目前查無你的每月獎金資料</p>
        <template v-else>
          <details v-for="m in recentBonus" :key="m.yearMonth" class="bonus-month" :data-month="m.yearMonth">
            <summary>
              <span>{{ slash(m.yearMonth) }}</span>
              <span v-if="!m.confirmed" class="pending-tag" data-home="bonus-unconfirmed">尚未確認，金額可能調整</span>
              <b>合計 {{ amount(m.total) }}</b>
            </summary>
            <dl>
              <div v-for="i in m.items" :key="i.key">
                <dt>{{ i.label }}</dt>
                <dd>
                  {{ amount(i.amount) }}<small v-if="i.key === 'other_bonus' && m.otherNote">{{ m.otherNote }}</small>
                </dd>
              </div>
            </dl>
          </details>
          <details v-if="olderBonus.length" class="bonus-older">
            <summary>較早月份 <b>{{ olderBonus.length }} 個月</b></summary>
            <details v-for="m in olderBonus" :key="m.yearMonth" class="bonus-month" :data-month="m.yearMonth">
              <summary>
                <span>{{ slash(m.yearMonth) }}</span>
                <span v-if="!m.confirmed" class="pending-tag" data-home="bonus-unconfirmed">尚未確認，金額可能調整</span>
                <b>合計 {{ amount(m.total) }}</b>
              </summary>
              <dl>
                <div v-for="i in m.items" :key="i.key">
                  <dt>{{ i.label }}</dt>
                  <dd>
                    {{ amount(i.amount) }}<small v-if="i.key === 'other_bonus' && m.otherNote">{{ m.otherNote }}</small>
                  </dd>
                </div>
              </dl>
            </details>
          </details>
        </template>
      </section>

      <!-- 4. 本月新人入職公告 -->
      <section v-if="data.onboarding.rows.length" class="home-card" data-home-card="onboarding">
        <h2><UserPlus :size="18" /> 本月新人入職公告 <small>{{ data.onboarding.rows.length }} 人</small></h2>
        <p class="muted">以下為你目前管理門市於 {{ slash(data.yearMonth) }} 已登記的人員入職紀錄。</p>
        <div class="home-table cols-4">
          <div class="head"><span>到職日</span><span>門市</span><span>姓名</span><span>身分</span></div>
          <div v-for="r in data.onboarding.rows" :key="r.employee_code + r.store_id + r.movement_date" class="row">
            <span>{{ slash(r.movement_date) }}</span>
            <span>{{ r.store_code ? `${r.store_code} - ${r.store_name || "-"}` : r.store_name || "-" }}</span>
            <span>{{ r.employee_name }} <small>{{ r.employee_code }}</small></span>
            <span>{{ r.onboarding_is_pharmacist ? "藥師" : "一般人員" }}</span>
          </div>
        </div>
      </section>

      <!-- 5. 任務、壽星、年費、執照 -->
      <div class="home-cards">
        <section class="home-card" data-home-card="tasks">
          <div class="home-card-head">
            <h2>我的任務</h2>
            <button v-if="caps.tasks" @click="work.open('my-tasks')">查看全部</button>
          </div>
          <p v-if="!data.tasks.rows.length" class="muted" data-home="tasks-empty">目前沒有指派的任務</p>
          <ul v-else class="task-list">
            <li v-for="t in data.tasks.rows" :key="t.id">
              <button :disabled="!caps.tasks" @click="work.open('task-runner', '', t.id)">
                <strong>{{ t.title }}</strong>
                <small>狀態：{{ labels[t.status] }}</small>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="data.birthdays.visible" class="home-card" data-home-card="birthdays">
          <h2><Cake :size="18" /> 本月壽星 <small>({{ data.month }}月)</small></h2>
          <p v-if="!data.birthdays.rows.length" class="muted">本月沒有壽星</p>
          <template v-else>
            <div class="home-table cols-3">
              <div class="head"><span>員編</span><span>姓名</span><span>日期</span></div>
              <div v-for="r in data.birthdays.rows" :key="r.employee_code" class="row">
                <span class="mono">{{ r.employee_code }}</span>
                <span>{{ r.employee_name }}</span>
                <span>{{ parseInt(r.birthday.split("-")[1], 10) }}/{{ parseInt(r.birthday.split("-")[2], 10) }}</span>
              </div>
            </div>
            <p class="muted right">共 {{ data.birthdays.rows.length }} 人</p>
          </template>
        </section>

        <section v-if="data.annualFee.visible && data.annualFee.rows.length" class="home-card" data-home-card="annual-fee">
          <h2><BellRing :size="18" /> 常年會費未繳提醒 <small>({{ data.annualFee.rows.length }} 人)</small></h2>
          <div class="home-table cols-4">
            <div class="head"><span>員編</span><span>姓名</span><span>公會</span><span>門市</span></div>
            <div v-for="r in data.annualFee.rows" :key="r.employee_code" class="row wrap">
              <span class="mono">{{ r.employee_code }}</span>
              <span>{{ r.employee_name }}</span>
              <span>{{ r.association_city }}</span>
              <span>{{ r.store_name || "-" }}</span>
              <p>{{ r.reason }}</p>
            </div>
          </div>
        </section>

        <section v-if="data.license.visible && data.license.rows.length" class="home-card" data-home-card="license">
          <details>
            <summary>
              <h2><BellRing :size="18" /> 執照更新日提醒 <small>({{ data.license.rows.length }} 人)</small></h2>
            </summary>
            <template v-if="data.flags.licenseGroupByZone">
              <div v-for="[zone, rows] in licenseGroups" :key="zone" class="zone">
                <h3>{{ zone }} <small>（{{ rows.length }} 人）</small></h3>
                <div class="home-table cols-4">
                  <div class="head"><span>員編</span><span>姓名</span><span>到期日</span><span>門市</span></div>
                  <div v-for="r in rows" :key="r.employee_code" class="row wrap">
                    <span class="mono">{{ r.employee_code }}</span>
                    <span>{{ r.employee_name }}</span>
                    <span>{{ slash(r.license_renewal_date) }}</span>
                    <span>{{ r.store_name || "-" }}</span>
                    <p>{{ r.reason }}</p>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="home-table cols-4">
              <div class="head"><span>員編</span><span>姓名</span><span>到期日</span><span>門市</span></div>
              <div v-for="r in data.license.rows" :key="r.employee_code" class="row wrap">
                <span class="mono">{{ r.employee_code }}</span>
                <span>{{ r.employee_name }}</span>
                <span>{{ slash(r.license_renewal_date) }}</span>
                <span>{{ r.store_name || "-" }}</span>
                <p>{{ r.reason }}</p>
              </div>
            </div>
          </details>
        </section>
      </div>
    </template>

    <!-- 6. 新版快捷入口（在提醒卡片下方） -->
    <section v-if="hasQuick" class="home-quick" data-home="quick">
      <h2>快捷入口</h2>
      <div class="work-options">
        <button v-if="caps.inspections" @click="work.open('inspections')">
          <ClipboardList :size="24" /><span><strong>查詢巡店紀錄</strong><small>依門市、月份檢視巡店結果</small></span><span aria-hidden="true">→</span>
        </button>
        <button v-if="caps.campaigns" @click="work.open('campaigns')">
          <CalendarRange :size="24" /><span><strong>管理活動檔期</strong><small>新增活動與維護基本資料</small></span><span aria-hidden="true">→</span>
        </button>
        <button v-if="caps.monthlyRelease" data-quick="monthly-release" @click="work.open('monthly-release')">
          <FileText :size="24" /><span><strong>每月版更內容</strong><small>查看本月系統調整內容與實際使用影響</small></span><span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
    <p v-if="!caps.inspections && !caps.campaigns" class="notice">你目前沒有巡店或活動管理權限。</p>
    <div v-if="legacyQuick.length" class="legacy-quick">
      <h2>常用營運功能</h2>
      <button v-for="item in legacyQuick.filter((i) => i.kind)" :key="item.href" @click="work.open(item.kind!)">{{ item.label }}</button>
      <a v-for="item in legacyQuick.filter((i) => !i.kind)" :key="item.href" :href="legacyHref(item.href)" target="_blank" rel="noopener"
        >{{ item.label }}<ExternalLink :size="14" /><small>原測試頁</small></a
      >
    </div>
    <!-- 正式切換時移除（C.5） -->
    <div class="scope-note">
      <h2>新舊功能共用測試環境</h2>
      <p>每月人員狀態、巡店、活動、業績與盤點使用獨立工作頁。其餘入口仍連至既有測試頁；所有功能依帳號權限顯示。</p>
    </div>
  </div>
</template>

<style scoped>
.home { width: 100%; max-width: 1560px; min-width: 0; }
.home h1 { margin: 0 0 18px; }
.home-banner {
  display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; margin: 0 0 12px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface); white-space: normal;
}
.home-banner > span { flex: 1; }
.home-banner small { display: block; color: var(--muted); font-weight: 400; margin-top: 4px; }
.home-banner em { font-style: normal; font-size: 12px; margin-left: 8px; padding: 2px 8px; border-radius: 99px; background: var(--primary); color: #fff; }
.home-card { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 14px 16px; margin: 0 0 12px; min-width: 0; }
.home-card h2 { font-size: 16px; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.home-card h2 small, .home-card-head small { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 6px; }
.home-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; align-items: start; margin-bottom: 12px; }
.home-cards .home-card { margin: 0; }
.home-card details > summary { cursor: pointer; list-style: none; }
.home-card details > summary h2 { display: inline-flex; margin: 0; }
.bonus-month { border: 1px solid var(--line); border-radius: 8px; margin: 0 0 8px; }
.bonus-month > summary { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }
.bonus-month > summary > b { margin-left: auto; }
.pending-tag { font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); }
.bonus-month dl { margin: 0; padding: 8px 12px; border-top: 1px solid var(--line); display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 14px; }
.bonus-month dl > div { display: flex; justify-content: space-between; gap: 8px; }
.bonus-month dt { color: var(--muted); }
.bonus-month dd { margin: 0; text-align: right; font-weight: 600; }
.bonus-month dd small { display: block; font-weight: 400; color: var(--muted); }
.bonus-older { margin-top: 8px; }
.bonus-older > summary { padding: 6px 2px; }
.home-table { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; max-height: 320px; overflow-y: auto; }
.home-table .head, .home-table .row { display: grid; gap: 8px; padding: 8px 10px; }
.home-table.cols-3 .head, .home-table.cols-3 .row { grid-template-columns: 1fr 1fr 0.7fr; }
.home-table.cols-4 .head, .home-table.cols-4 .row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.home-table .head { font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
.home-table .row + .row { border-top: 1px solid var(--line); }
.home-table .row > span { overflow-wrap: anywhere; }
.home-table .row p { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--muted); }
.home-table small, .mono { font-family: ui-monospace, monospace; color: var(--muted); }
.zone h3 { font-size: 13px; margin: 12px 0 6px; }
.task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.task-list button { width: 100%; text-align: left; display: block; white-space: normal; }
.task-list small { display: block; color: var(--muted); font-weight: 400; margin-top: 4px; }
.right { text-align: right; }
.home-quick { margin-top: 18px; }
.home-quick h2 { font-size: 13px; }
.home-quick .work-options { max-width: none; width: 100%; margin: 8px 0 24px; }
@media (max-width: 640px) {
  .home-table.cols-4 .head, .home-table.cols-4 .row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bonus-month > summary { flex-wrap: wrap; }
}
</style>
