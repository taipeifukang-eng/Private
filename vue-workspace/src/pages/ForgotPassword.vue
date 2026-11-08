<script setup lang="ts">
// 公開頁 /forgot-password：不論信箱是否已註冊，一律顯示同一句話。
import { ref } from "vue";
import { api } from "../api";
import { isValidEmail } from "../../../lib/workspace/auth-public";
import PublicShell from "../components/PublicShell.vue";
defineProps<{ params: Record<string, unknown> }>();
const email = ref(""),
  busy = ref(false),
  error = ref(""),
  done = ref("");
async function submit() {
  error.value = "";
  if (!isValidEmail(email.value.trim())) {
    error.value = "請輸入有效的電子郵件";
    return;
  }
  busy.value = true;
  try {
    const r = await api<{ message: string }>("auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: email.value.trim() }),
    });
    done.value = r.message;
    email.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <PublicShell title="忘記密碼" lead="輸入您的電子郵件，我們會寄出重設密碼的連結。">
    <div v-if="done" class="notice" role="status" data-testid="forgot-done">{{ done }}</div>
    <form data-testid="forgot-form" novalidate @submit.prevent="submit">
      <label
        >電子郵件<input v-model="email" type="email" autocomplete="email" placeholder="your@email.com"
      /></label>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <button class="primary" :disabled="busy">{{ busy ? "送出中…" : "寄送重設信" }}</button>
    </form>
    <p class="public-links"><a href="#/login">返回登入</a></p>
  </PublicShell>
</template>
