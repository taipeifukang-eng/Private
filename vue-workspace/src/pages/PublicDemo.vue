<script setup lang="ts">
// D14 公開頁機制的示範頁：不需登入。正式的掃描頁（G10）與登入相關頁面會沿用同一機制，屆時移除此頁。
defineProps<{ params: Record<string, unknown> }>();
</script>
<template>
  <main class="welcome" data-testid="public-demo">
    <p class="eyebrow">公開頁示範</p>
    <h1>公開頁路由機制</h1>
    <p>此頁不需登入。代碼：<code data-testid="public-demo-token">{{ String(params.token ?? "") }}</code></p>
    <p><a href="#/">前往工作台</a></p>
  </main>
</template>
