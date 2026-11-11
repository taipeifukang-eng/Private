<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { ChevronDown, ChevronsLeft, ChevronsRight, ExternalLink, Menu, X } from "lucide-vue-next";
import { useSession, type WorkTab } from "../../stores";
import type { GaNavItem } from "../../../../lib/workspace/general-affairs/nav-types";
import { legacyUrl, openGaPage } from "../../lib/ga";

// G01 總務外殼：照舊版側欄分組與權限顯示（資料由伺服端用舊版同一份規則算好，放在 session.gaNavigation）。
// 已移植的頁面在新版頁籤開啟；尚未移植的項目以舊頁另開分頁。窄螢幕（手機）改成抽屜。
const props = defineProps<{ tab: WorkTab; crumbs?: string[] }>();
const session = useSession();
const STORAGE_KEY = "ga-shell-collapsed";
const collapsed = ref(false);
const drawer = ref(false);
const openGroups = ref<Record<string, boolean>>({});
const groups = computed(() => session.data?.gaNavigation || []);

onMounted(() => {
  try {
    collapsed.value = window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    collapsed.value = false;
  }
  // 預設展開含目前頁面的那一組。
  for (const g of groups.value) for (const i of g.items) if (containsCurrent(i)) openGroups.value[i.id] = true;
});

// 同一個 kind 有多個檢視（庫存總覽／庫存流水）時，再比對 payload.view。
const isCurrent = (item: GaNavItem): boolean => item.kind === props.tab.kind && (!item.payload?.view || item.payload.view === ((props.tab.payload as any)?.view || "balances"));
const containsCurrent = (item: GaNavItem): boolean => isCurrent(item) || !!item.children?.some(containsCurrent);
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed.value));
  } catch {
    /* 偏好設定存不下來不影響使用 */
  }
}
function go(item: GaNavItem) {
  drawer.value = false;
  if (item.kind) openGaPage(item.kind, undefined, item.payload ? { ...item.payload } : undefined);
}
const href = (item: GaNavItem) => legacyUrl(item.href || "/", session.data?.integrated);
</script>

<template>
  <div class="ga-shell" :class="{ collapsed }" data-testid="ga-shell">
    <div class="ga-mobile-bar">
      <button type="button" aria-haspopup="dialog" :aria-expanded="drawer" @click="drawer = true"><Menu :size="16" /> 總務選單</button>
      <span class="muted">{{ crumbs?.join(" › ") }}</span>
    </div>
    <div v-if="drawer" class="ga-backdrop" aria-hidden="true" @click="drawer = false" />
    <aside class="ga-side" :class="{ open: drawer }" aria-label="總務服務中心導覽">
      <div class="ga-side-head">
        <strong v-if="!collapsed || drawer">總務服務中心</strong>
        <button type="button" class="icon-button ga-collapse" :aria-label="collapsed ? '展開總務選單' : '收合總務選單'" @click="toggleCollapsed">
          <ChevronsRight v-if="collapsed" :size="16" /><ChevronsLeft v-else :size="16" />
        </button>
        <button type="button" class="icon-button ga-close" aria-label="關閉總務選單" @click="drawer = false"><X :size="16" /></button>
      </div>
      <nav v-if="!collapsed || drawer" class="ga-nav">
        <section v-for="g in groups" :key="g.id">
          <h2 v-if="g.label">{{ g.label }}</h2>
          <ul>
            <li v-for="item in g.items" :key="item.id">
              <template v-if="item.children?.length">
                <button type="button" class="ga-group" :aria-expanded="!!openGroups[item.id]" @click="openGroups[item.id] = !openGroups[item.id]">
                  <span>{{ item.label }}</span><ChevronDown :size="14" :class="{ flip: openGroups[item.id] }" />
                </button>
                <ul v-show="openGroups[item.id]" class="ga-sub">
                  <li v-for="child in item.children" :key="child.id">
                    <button v-if="child.kind" type="button" class="ga-link" :class="{ current: isCurrent(child) }" :aria-current="isCurrent(child) ? 'page' : undefined" @click="go(child)">{{ child.label }}</button>
                    <a v-else-if="child.href" class="ga-link" :href="href(child)" target="_blank" rel="noopener" :title="child.label + '（原測試頁，另開分頁）'">{{ child.label }} <ExternalLink :size="12" /></a>
                    <span v-else class="ga-link disabled" :title="child.disabled">{{ child.label }}<small>規劃中</small></span>
                  </li>
                </ul>
              </template>
              <template v-else>
                <button v-if="item.kind" type="button" class="ga-link" :class="{ current: isCurrent(item) }" :aria-current="isCurrent(item) ? 'page' : undefined" @click="go(item)">{{ item.label }}</button>
                <a v-else-if="item.href" class="ga-link" :href="href(item)" target="_blank" rel="noopener" :title="item.label + '（原測試頁，另開分頁）'">{{ item.label }} <ExternalLink :size="12" /></a>
                <span v-else class="ga-link disabled" :title="item.disabled">{{ item.label }}<small>規劃中</small></span>
              </template>
            </li>
          </ul>
        </section>
        <p v-if="!groups.length" class="muted">目前沒有可用的總務功能。</p>
      </nav>
    </aside>
    <div class="ga-main">
      <p v-if="crumbs?.length" class="ga-crumbs muted" aria-label="目前位置">{{ crumbs.join(" › ") }}</p>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ga-shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 24px; align-items: start; }
.ga-shell.collapsed { grid-template-columns: 52px minmax(0, 1fr); }
.ga-side { position: sticky; top: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 12px; max-height: calc(100vh - 160px); overflow: auto; }
.ga-side-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; }
.ga-close { display: none; }
.ga-nav h2 { margin: 14px 0 4px; font-size: 11px; letter-spacing: 1px; color: var(--muted); font-weight: 700; }
.ga-nav ul { list-style: none; margin: 0; padding: 0; }
.ga-link { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; text-align: left; border: 0; background: none; padding: 7px 8px; border-radius: 5px; min-height: 34px; color: var(--ink); text-decoration: none; font-weight: 500; white-space: normal; }
.ga-link:hover:not(.disabled) { background: var(--soft); }
.ga-link.current { background: var(--soft); color: var(--primary); font-weight: 700; }
.ga-link.disabled { color: var(--muted); cursor: default; }
.ga-link small { font-size: 10px; border: 1px solid var(--line); border-radius: 10px; padding: 0 6px; }
.ga-group { display: flex; width: 100%; justify-content: space-between; align-items: center; border: 0; background: none; padding: 7px 8px; font-weight: 700; min-height: 34px; }
.ga-group svg { transition: transform 0.15s; }
.ga-group svg.flip { transform: rotate(180deg); }
.ga-sub { padding-left: 10px !important; border-left: 1px solid var(--line); margin-left: 8px !important; }
.ga-mobile-bar { display: none; }
.ga-crumbs { margin: 0 0 10px; font-size: 12px; }
.ga-main { min-width: 0; }
@media (max-width: 900px) {
  .ga-shell, .ga-shell.collapsed { display: block; }
  .ga-mobile-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .ga-crumbs { display: none; }
  .ga-collapse { display: none; }
  .ga-close { display: inline-grid; }
  .ga-backdrop { position: fixed; inset: 0; background: rgb(15 22 15 / 48%); z-index: 40; }
  .ga-side { position: fixed; z-index: 41; inset: 0 auto 0 0; width: min(86vw, 320px); max-height: none; border-radius: 0; transform: translateX(-102%); transition: transform 0.18s; }
  .ga-side { visibility: hidden; }
  .ga-side.open { transform: none; visibility: visible; }
  .ga-shell.collapsed .ga-side { padding: 12px; }
}
</style>
