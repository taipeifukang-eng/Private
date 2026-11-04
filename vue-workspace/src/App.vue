<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Menu,
  Users,
  TrendingUp,
  PackageSearch,
  ClipboardList,
  CalendarRange,
  Plus,
  X,
  LogOut,
  PanelLeftClose,
  Sun,
  Moon,
  ExternalLink,
  FileText,
} from "lucide-vue-next";
import { api, ApiError } from "./api";
import { useSession, useWorkspace, type WorkTab } from "./stores";
import Modal from "./components/Modal.vue";
import {
  WORKSPACE_PAGES,
  WORKSPACE_PUBLIC_PAGES,
  isPageAllowed,
  pageUsesDefaultStore,
} from "./workspace-pages";
const session = useSession(),
  work = useWorkspace(),
  router = useRouter(),
  route = useRoute();
const booting = ref(true),
  bootError = ref(""),
  loginError = ref(""),
  loggingIn = ref(false),
  email = ref(""),
  password = ref("");
const menuOpen = ref(false),
  dark = ref(false),
  closing = ref<string[] | null>(null),
  closingBusy = ref(false),
  closeError = ref(""),
  logoutPending = ref(false),
  sessionError = ref("");
const closeTabs = computed(() =>
  work.tabs.filter((t) => closing.value?.includes(t.id)),
);
const closeDirty = computed(() => closeTabs.value.filter((t) => t.dirty));
const current = computed(() => work.tabs.find((t) => t.id === work.active));
const navigationSearch = ref("");
// 公開頁（D14）：不需登入，不啟動工作階段與頁籤機制。
const publicPage = computed(() =>
  route.meta.public
    ? WORKSPACE_PUBLIC_PAGES.find((p) => p.name === route.name)
    : undefined,
);
const menuButton = ref<HTMLButtonElement>();
const menuPanel = ref<HTMLElement>();
async function toggleNavigation() {
  if (menuOpen.value) { closeNavigation(); return; }
  navigationSearch.value = '';
  menuOpen.value = true;
  await nextTick();
  menuPanel.value?.querySelector<HTMLInputElement>('input')?.focus();
}
function closeNavigation(restore = true) {
  menuOpen.value = false;
  if (restore) menuButton.value?.focus();
}
function navigationBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (next && !menuPanel.value?.contains(next) && next !== menuButton.value) closeNavigation(false);
}
const navigation = computed(() =>
  (session.data?.navigation || [])
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !navigationSearch.value.trim() ||
          (group.label + item.label).includes(navigationSearch.value.trim()),
      ),
    }))
    .filter((group) => group.items.length),
);
const legacyQuick = computed(() =>
  (session.data?.navigation || [])
    .flatMap((g) => g.items)
    .filter((i) =>
      [
        "/monthly-status",
        "/admin/performance",
        "/inventory",
        "/general-affairs",
      ].includes(i.href),
    ),
);
function legacyHref(href: string) {
  return session.data?.integrated ? href : "http://localhost:3002" + href;
}
let timer: ReturnType<typeof setInterval>;
async function boot() {
  booting.value = true;
  bootError.value = "";
  try {
    await session.refresh();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401))
      bootError.value = (e as Error).message;
  } finally {
    booting.value = false;
  }
}
async function login() {
  loggingIn.value = true;
  loginError.value = "";
  try {
    await api("login", {
      method: "POST",
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
      }),
    });
    password.value = "";
    await session.refresh();
    work.clear();
    await router.replace("/");
  } catch (e) {
    loginError.value = (e as Error).message;
  } finally {
    loggingIn.value = false;
  }
}
async function refreshSession() {
  if (!session.data) return;
  try {
    await session.refresh();
    sessionError.value = "";
  } catch (e) {
    sessionError.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) session.expired = true;
  }
}
function expire() {
  if (session.data) {
    session.expired = true;
    sessionError.value = "登入已過期，請先保留需要的內容，再重新登入。";
  }
}
function open(kind: WorkTab["kind"]) {
  work.open(kind, pageUsesDefaultStore(kind) ? session.defaultStore : "");
  closeNavigation();
}
function allowed(tab: WorkTab) {
  return isPageAllowed(tab.kind, session.data?.capabilities, session.expired);
}
function requestClose(ids: string[], logout = false) {
  if (closingBusy.value || work.tabs.some((t) => ids.includes(t.id) && t.busy))
    return;
  closeError.value = "";
  logoutPending.value = logout;
  if (work.tabs.some((t) => ids.includes(t.id) && t.dirty)) {
    closing.value = ids;
    return;
  }
  if (logout) {
    closing.value = ids;
    void finishClose(false);
  } else work.remove(ids);
}
async function finishClose(save: boolean) {
  closingBusy.value = true;
  closeError.value = "";
  try {
    if (save) {
      for (const tab of closeDirty.value) {
        if (!tab.save || !(await tab.save())) {
          work.active = tab.id;
          closeError.value = `「${tab.title}」尚未儲存成功，所有頁籤仍保留。`;
          return;
        }
      }
    }
    if (logoutPending.value) {
      await api("logout", { method: "POST", body: "{}" });
      work.clear();
      session.data = null;
      session.expired = false;
      sessionError.value = "";
      await router.replace("/");
    } else work.remove(closing.value || []);
    closing.value = null;
    logoutPending.value = false;
  } catch (e) {
    closeError.value = (e as Error).message;
  } finally {
    closingBusy.value = false;
  }
}
function cancelClose() {
  if (!closingBusy.value) {
    closing.value = null;
    logoutPending.value = false;
    closeError.value = "";
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (work.dirty.length || work.tabs.some((t) => t.busy)) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function toggleTheme() {
  dark.value = !dark.value;
  document.documentElement.dataset.theme = dark.value ? "dark" : "light";
  try {
    localStorage.setItem("fk-workspace-theme", dark.value ? "dark" : "light");
  } catch {}
}
watch(
  () => work.active,
  async (id) => {
    const target = id ? `/work/${id}` : "/";
    if (route.path !== target) await router.push(target);
    await nextTick();
    document
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  },
);
watch(
  () => route.path,
  (path) => {
    if (route.meta.public) return;
    const id = path.split("/")[2];
    if (id && work.tabs.some((t) => t.id === id)) work.active = id;
    else if (path === "/") work.active = "";
    else void router.replace("/");
  },
);
function tabKeys(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % work.tabs.length;
  else if (event.key === "ArrowLeft")
    next = (index + work.tabs.length - 1) % work.tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = work.tabs.length - 1;
  else return;
  event.preventDefault();
  work.active = work.tabs[next].id;
  void nextTick(() =>
    (
      document.querySelector(
        '[role="tab"][aria-selected="true"]',
      ) as HTMLElement
    )?.focus(),
  );
}
let initialized = false;
async function init() {
  if (initialized) return;
  initialized = true;
  try {
    dark.value = localStorage.getItem("fk-workspace-theme") === "dark";
    document.documentElement.dataset.theme = dark.value ? "dark" : "light";
  } catch {}
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("workspace-session-expired", expire);
  window.addEventListener("focus", refreshSession);
  timer = setInterval(refreshSession, 60000);
  await boot();
  if (route.path !== "/") await router.replace("/");
}
onMounted(async () => {
  await router.isReady();
  if (route.meta.public) {
    booting.value = false;
    return;
  }
  await init();
});
// 首次載入為公開頁時略過初始化；之後切到工作台路由要補跑一次（session、監聽、主題）。
watch(
  () => route.meta.public,
  (isPublic) => {
    if (!isPublic && !initialized) {
      booting.value = true;
      void init();
    }
  },
);
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("workspace-session-expired", expire);
  window.removeEventListener("focus", refreshSession);
});
</script>
<template>
  <component
    :is="publicPage.component"
    v-if="publicPage"
    :params="route.params"
  />
  <div v-else-if="booting" class="boot" role="status">正在開啟菁英作業台…</div>
  <main v-else-if="!session.data" class="login-layout">
    <section class="login-intro">
      <div class="brand-mark">FK</div>
      <p class="eyebrow">富康菁英業務網</p>
      <h1>把工作留在<br />你正在處理的地方。</h1>
      <p>巡店查詢、活動編輯，各自保留進度。<br />為總部日常作業而設計。</p>
      <span class="environment">測試環境 · 與正式資料分離</span>
    </section>
    <section class="login-panel">
      <p class="eyebrow">菁英作業台</p>
      <h2>登入測試工作區</h2>
      <p class="muted">使用原總務測試站帳號，或本次測試帳號登入。</p>
      <div v-if="bootError" class="notice error" role="alert">
        {{ bootError }}<button @click="boot">重新連線</button>
      </div>
      <form @submit.prevent="login">
        <label
          >帳號或電子郵件<input
            v-model="email"
            type="text"
            autocomplete="username"
            required
            autofocus /></label
        ><label
          >密碼<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
        /></label>
        <div v-if="loginError" class="notice error" role="alert">
          {{ loginError }}
        </div>
        <button class="primary" :disabled="loggingIn">
          {{ loggingIn ? "登入中…" : "登入工作台" }}
        </button>
      </form>
      <small class="muted">測試區的變更不會寫入正式營運資料。</small>
    </section>
  </main>
  <div v-else class="app-shell catalog-shell" @keydown.esc="menuOpen && closeNavigation()">
    <header class="topbar">
      <button ref="menuButton" class="menu-toggle" aria-controls="workspace-menu" :aria-expanded="menuOpen" @click="toggleNavigation">
        <Menu :size="18" /><span>選單</span></button
      ><a
        class="brand"
        href="#/"
        @click.prevent="
          work.active = '';
          router.push('/');
        "
        ><b>FK</b><span>菁英作業台</span></a
      ><span class="environment">測試區</span>
      <div class="topbar-spacer" />
      <label class="context-picker"
        ><span>新頁預設門市</span
        ><select aria-label="新頁預設門市" v-model="session.defaultStore">
          <option value="">全部可查看門市</option>
          <option v-for="s in session.data.stores" :key="s.id" :value="s.id">
            {{ s.store_code }} {{ s.short_name || s.store_name }}
          </option>
        </select></label
      ><button
        class="icon-button"
        :aria-label="dark ? '切換淺色模式' : '切換深色模式'"
        @click="toggleTheme"
      >
        <Sun v-if="dark" :size="18" /><Moon v-else :size="18" /></button
      ><span class="user-name">{{ session.data.user.name }}</span
      ><button
        class="icon-button"
        aria-label="登出"
        @click="
          requestClose(
            work.tabs.map((t) => t.id),
            true,
          )
        "
      >
        <LogOut :size="18" />
      </button>
    </header>
    <div v-if="menuOpen" class="catalog-backdrop" aria-hidden="true" @click="closeNavigation()" />
    <nav v-if="menuOpen" id="workspace-menu" ref="menuPanel" class="workspace-menu" aria-label="全站功能選單" @focusout="navigationBlur">
      <div class="catalog-toolbar"><label>搜尋功能<input v-model="navigationSearch" type="search" placeholder="輸入模組或功能名稱" /></label><span class="muted">選擇功能後，選單會自動收回</span><button class="catalog-close" aria-label="關閉選單" @click="closeNavigation()"><X :size="18" /></button></div>
      <div class="catalog-grid">
        <section v-for="group in navigation" :key="group.label" class="catalog-group">
          <h2>{{ group.label }}</h2>
          <ul><li v-for="item in group.items" :key="item.href">
            <button v-if="item.kind" class="catalog-item" :class="{selected: current?.kind === item.kind || (item.kind === 'campaigns' && current?.kind === 'campaign-edit')}" :aria-current="current?.kind === item.kind ? 'page' : undefined" :disabled="session.expired" :title="item.label" @click="open(item.kind)"><span>{{item.label}}</span></button>
            <a v-else class="catalog-item" :href="legacyHref(item.href)" target="_blank" rel="noopener" :title="item.label + '（原測試頁，另開分頁）'" @click="closeNavigation()"><span>{{item.label}}</span><ExternalLink :size="13" /><span class="sr-only">（原測試頁，另開分頁）</span></a>
          </li></ul>
        </section>
      </div>
      <p v-if="!navigation.length" class="catalog-empty" role="status">沒有符合搜尋條件的功能。</p>
      <footer class="catalog-footer"><a :href="legacyHref('/')" target="_blank" rel="noopener" @click="closeNavigation()">返回原測試站 <ExternalLink :size="13" /></a><small>↗ 原測試頁另開分頁</small></footer>
    </nav>
    <section class="workspace">
      <div class="tab-strip">
        <div class="tab-scroll" role="tablist" aria-label="開啟中的工作">
          <div
            v-for="(tab, index) in work.tabs"
            :key="tab.id"
            class="tab"
            :class="{ active: work.active === tab.id }"
          >
            <button
              role="tab"
              :id="'tab-' + tab.id"
              :aria-controls="'panel-' + tab.id"
              :aria-selected="work.active === tab.id"
              :tabindex="work.active === tab.id ? 0 : -1"
              @click="work.active = tab.id"
              @keydown="tabKeys($event, index)"
              :title="tab.title"
            >
              <span>{{ tab.title }}</span
              ><span v-if="tab.dirty" class="dirty-marker" aria-label="尚未儲存"
                >＊</span
              ></button
            ><button
              class="tab-close"
              :aria-label="'關閉 ' + tab.title"
              :disabled="tab.busy"
              @click="requestClose([tab.id])"
            >
              <X :size="14" />
            </button>
          </div>
          <span v-if="!work.tabs.length" class="tabs-empty"
            >尚未開啟工作頁</span
          >
        </div>
        <details v-if="work.tabs.length" class="tab-tools">
          <summary aria-label="頁籤管理"><PanelLeftClose :size="18" /></summary>
          <div>
            <button
              @click="
                requestClose(
                  work.tabs
                    .filter((t) => t.id !== work.active)
                    .map((t) => t.id),
                )
              "
            >
              關閉其他頁籤</button
            ><button @click="requestClose(work.tabs.map((t) => t.id))">
              關閉全部頁籤
            </button>
          </div>
        </details>
      </div>
      <div v-if="sessionError" class="session-notice" role="alert">
        {{ sessionError
        }}<button v-if="!session.expired" @click="refreshSession">重試</button
        ><button
          v-else
          @click="
            requestClose(
              work.tabs.map((t) => t.id),
              true,
            )
          "
        >
          離開並重新登入
        </button>
      </div>
      <main v-if="!current" class="welcome">
        <p class="eyebrow">工作總覽</p>
        <h1>開始今天的營運作業</h1>
        <p>沿用原測試站的全站功能選單。五個優先模組直接在工作頁籤內操作。</p>
        <div class="work-options">
          <button
            v-if="session.data.capabilities.inspections"
            @click="open('inspections')"
          >
            <ClipboardList :size="24" /><span
              ><strong>查詢巡店紀錄</strong
              ><small>依門市、月份檢視巡店結果</small></span
            ><span aria-hidden="true">→</span></button
          ><button
            v-if="session.data.capabilities.campaigns"
            @click="open('campaigns')"
          >
            <CalendarRange :size="24" /><span
              ><strong>管理活動檔期</strong
              ><small>新增活動與維護基本資料</small></span
            ><span aria-hidden="true">→</span>
          </button>
          <button
            v-if="session.data.capabilities.monthlyRelease"
            data-home-card="monthly-release"
            @click="open('monthly-release')"
          >
            <FileText :size="24" /><span
              ><strong>每月版更內容</strong
              ><small>查看本月系統調整內容與實際使用影響</small></span
            ><span aria-hidden="true">→</span>
          </button>
        </div>
        <p
          v-if="
            !session.data.capabilities.inspections &&
            !session.data.capabilities.campaigns
          "
          class="notice"
        >
          你目前沒有巡店或活動管理權限。
        </p>
        <div class="legacy-quick" v-if="legacyQuick.length">
          <h2>常用營運功能</h2>
          <button
            v-for="item in legacyQuick.filter((i) => i.kind)"
            :key="item.href"
            @click="open(item.kind!)"
          >
            {{ item.label }}
          </button>
          <a
            v-for="item in legacyQuick.filter((i) => !i.kind)"
            :key="item.href"
            :href="legacyHref(item.href)"
            target="_blank"
            rel="noopener"
            >{{ item.label }}<ExternalLink :size="14" /><small
              >原測試頁</small
            ></a
          >
        </div>
        <div class="scope-note">
          <h2>新舊功能共用測試環境</h2>
          <p>
            每月人員狀態、巡店、活動、業績與盤點使用獨立工作頁。其餘入口仍連至既有測試頁；所有功能依帳號權限顯示。
          </p>
        </div>
      </main>
      <section
        v-for="tab in work.tabs"
        :key="tab.id"
        v-show="work.active === tab.id"
        :id="'panel-' + tab.id"
        role="tabpanel"
        :aria-labelledby="'tab-' + tab.id"
        class="work-page"
      >
        <div v-if="!allowed(tab)" class="notice error" role="alert">
          {{
            session.expired
              ? "登入已過期，暫停顯示資料與儲存。"
              : "此功能權限已變更，無法繼續查看或編輯。"
          }}
        </div>
        <div v-show="allowed(tab)">
          <component :is="WORKSPACE_PAGES[tab.kind].component" :tab="tab" />
        </div>
      </section>
    </section>
    <Modal
      v-if="closing"
      :title="logoutPending ? '離開工作台前確認' : '關閉工作頁前確認'"
      :busy="closingBusy"
      @cancel="cancelClose"
      ><p>
        {{
          closeDirty.length
            ? "以下工作尚未儲存。請選擇如何處理。"
            : "確認離開目前工作台。"
        }}
      </p>
      <p v-if="closeDirty.every(t=>t.kind==='movement-draft')">目前是驗證草稿，尚未開放提交；關閉頁籤後內容會捨棄。</p>
      <p v-else-if="closeDirty.some((t) => t.submitOnly)">
        {{closeDirty.every(t=>t.kind==='improvement-detail') ? '改善回報' : '此操作'}}需回到工作頁確認提交；目前填寫內容會保留至關閉頁籤。
      </p>
      <ul class="dirty-list">
        <li v-for="tab in closeDirty" :key="tab.id">{{ tab.title }}</li>
      </ul>
      <div v-if="closeError" class="notice error" role="alert">
        {{ closeError }}
      </div>
      <div class="dialog-actions">
        <button :disabled="closingBusy" @click="cancelClose">繼續編輯</button
        ><button
          class="danger"
          :disabled="closingBusy"
          @click="finishClose(false)"
        >
          {{ closeDirty.length ? "放棄修改並" : ""
          }}{{ logoutPending ? "登出" : "關閉" }}</button
        ><button
          v-if="
            closeDirty.length &&
            !session.expired &&
            !closeDirty.some((t) => t.submitOnly)
          "
          class="primary"
          :disabled="closingBusy"
          @click="finishClose(true)"
        >
          {{
            closingBusy
              ? "處理中…"
              : "全部儲存後" + (logoutPending ? "登出" : "關閉")
          }}
        </button>
      </div></Modal
    >
  </div>
</template>
