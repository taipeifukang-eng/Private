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
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">總務服務中心</p>
      <h1>總務服務中心</h1>
      <p class="muted">資產與料件主檔的新版頁面已開放；其他功能（需求單、工單、庫存、廠商、費用）仍在舊版，從左側選單另開分頁。</p>
    </div>
  </header>
  <GaShell :tab="tab" :crumbs="['總務服務中心']">
    <section class="ga-home">
      <h2>新版已可使用</h2>
      <ul v-if="ported.length" class="ga-cards">
        <li v-for="item in ported" :key="item.id">
          <button type="button" @click="openGaPage(item.kind!)"><strong>{{ item.label }}</strong></button>
        </li>
      </ul>
      <p v-else class="muted">你目前沒有可用的新版總務功能。如需使用，請聯絡管理員開通權限。</p>
      <p>
        <a :href="legacyUrl('/general-affairs', session.data?.integrated)" target="_blank" rel="noopener">開啟舊版服務中心首頁 <ExternalLink :size="13" /></a>
      </p>
    </section>
  </GaShell>
</template>

<style scoped>
.ga-home h2 { font-size: 14px; }
.ga-cards { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.ga-cards button { width: 100%; text-align: left; padding: 14px; }
</style>
