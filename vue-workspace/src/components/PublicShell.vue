<script setup lang="ts">
// 公開頁共用外框（登入、註冊、忘記密碼、重設密碼）：左側品牌區、右側內容。
defineProps<{ title: string; lead?: string }>();
</script>
<template>
  <main class="login-layout" data-testid="public-shell">
    <section class="login-intro">
      <div class="brand-mark">FK</div>
      <p class="eyebrow">富康菁英業務網</p>
      <h1>把工作留在<br />你正在處理的地方。</h1>
      <p>巡店查詢、活動編輯，各自保留進度。<br />為總部日常作業而設計。</p>
      <span class="environment">富康內部業務系統 · 僅限同仁使用</span>
    </section>
    <section class="login-panel">
      <p class="eyebrow">菁英作業台</p>
      <h2>{{ title }}</h2>
      <p v-if="lead" class="muted">{{ lead }}</p>
      <slot />
    </section>
  </main>
</template>
