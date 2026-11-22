<script setup lang="ts">
// Q15：登入後沒有任何角色時顯示的說明頁（取代空白工作台）。
import { PENDING_ACTIVATION_TEXT, PENDING_ACTIVATION_TITLE } from "../../../lib/workspace/auth-public";
defineProps<{ name: string; busy?: boolean; error?: string }>();
defineEmits<{ (e: "recheck"): void; (e: "logout"): void }>();
</script>
<template>
  <main class="pending-page" data-testid="pending-activation">
    <section class="pending-card">
      <p class="eyebrow">富康菁英業務網</p>
      <h1>{{ PENDING_ACTIVATION_TITLE }}</h1>
      <p v-if="name">{{ name }}，您好。</p>
      <p data-testid="pending-text">{{ PENDING_ACTIVATION_TEXT }}</p>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <div class="pending-actions">
        <button class="primary" :disabled="busy" @click="$emit('recheck')">重新檢查</button>
        <button :disabled="busy" @click="$emit('logout')">登出</button>
      </div>
    </section>
  </main>
</template>
