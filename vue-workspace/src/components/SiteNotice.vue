<script setup lang="ts">
// WP6：整頁說明（新版暫時關閉／尚未開放），附舊版首頁連結。
import { SITE_NOTICE_TEXT, legacyHomeHref, type SiteNoticeKind } from "../site-state";
defineProps<{ kind: SiteNoticeKind; integrated?: boolean; name?: string }>();
</script>
<template>
  <main class="pending-page" data-testid="site-notice" :data-kind="kind">
    <section class="pending-card">
      <p class="eyebrow">富康菁英業務網</p>
      <h1>{{ SITE_NOTICE_TEXT[kind].title }}</h1>
      <p v-if="name">{{ name }}，您好。</p>
      <p>{{ SITE_NOTICE_TEXT[kind].body }}</p>
      <div class="pending-actions">
        <a class="primary button-link" :href="legacyHomeHref(integrated)">前往舊版首頁</a>
      </div>
    </section>
  </main>
</template>
