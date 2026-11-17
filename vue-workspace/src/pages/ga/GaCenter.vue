<script setup lang="ts">
import { computed } from "vue";
import { ExternalLink } from "lucide-vue-next";
import GaShell from "../../components/ga/GaShell.vue";
import { useSession, type WorkTab } from "../../stores";
import { legacyUrl, openGaPage } from "../../lib/ga";
import type { GaNavItem } from "../../../../lib/workspace/general-affairs/nav-types";

// G01 總務服務中心入口：外殼與導覽。完整服務首頁（待辦、統計）屬第 6 批，這裡先列出目前可用的新版功能，其餘連到舊版頁面。
defineProps<{ tab: WorkTab }>();
const session = useSession();
const flat = (items: GaNavItem[]): GaNavItem[] => items.flatMap((i) => [i, ...(i.children ? flat(i.children) : [])]);
const ported = computed(() => flat((session.data?.gaNavigation || []).flatMap((g) => g.items)).filter((i) => i.kind && i.kind !== "ga-center"));
// 廠商入口（第 6 批）：導向使用者可進入的第一個廠商頁（廠商資料、服務分類、服務區域），選單、頁面與 API 共用同一組權限。
const VENDOR_KINDS = ["ga-vendors", "ga-vendor-categories", "ga-vendor-regions"] as const;
const vendorEntry = computed(() => VENDOR_KINDS.map((k) => ported.value.find((i) => i.kind === k)).find(Boolean) || null);
// 只憑門市名單身分進來的人（督導、區經理）側欄不留舊版項目，也不一定進得了舊版首頁，所以沒有舊版項目時不放舊版說明與連結。
const hasLegacy = computed(() => flat((session.data?.gaNavigation || []).flatMap((g) => g.items)).some((i) => !i.kind && !i.children?.length));
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心</p>
      <h1>總務服務中心</h1>
      <p v-if="hasLegacy" class="muted">資產、料件、需求單、採購單、工單、廠商資料與水電網費的新版頁面已開放；其他功能仍在舊版，從左側選單另開分頁。</p>
      <p v-else class="muted">這裡列出您可以查看的新版頁面（唯讀範圍以您負責的門市為限）。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心']">
    <section class="ga-home">
      <h2>新版已可使用</h2>
      <ul v-if="ported.length" class="ga-cards">
        <li v-if="vendorEntry"><button type="button" data-testid="ga-vendor-entry" @click="openGaPage(vendorEntry.kind!)"><strong>合作廠商</strong><small class="muted">{{ vendorEntry.label }}</small></button></li>
        <li v-for="item in ported" :key="item.id">
          <button type="button" @click="openGaPage(item.kind!)"><strong>{{ item.label }}</strong></button>
        </li>
      </ul>
      <p v-else class="muted">你目前沒有可用的新版總務功能。如需使用，請聯絡管理員開通權限。</p>
      <p v-if="hasLegacy">
        <a :href="legacyUrl('/general-affairs', session.data?.integrated)" target="_blank" rel="noopener">開啟舊版服務中心首頁 <ExternalLink :size="13" /></a>
      </p>
    </section>
  </GaShell>
</template>

<style scoped>
.ga-home h2 { font-size: 14px; }
.ga-cards { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.ga-cards button { width: 100%; text-align: left; padding: 14px; display: grid; gap: 2px; }
</style>
