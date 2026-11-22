<script setup lang="ts">
// 登入面板：工作台未登入畫面與公開頁 /login 共用。登入成功後交給呼叫端決定去哪裡。
import { ref } from "vue";
import { api } from "../api";
import PublicShell from "./PublicShell.vue";
const props = defineProps<{ bootError?: string }>();
const emit = defineEmits<{ (e: "success"): void; (e: "retry"): void }>();
const email = ref(""),
  password = ref(""),
  error = ref(""),
  busy = ref(false);
async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await api("login", {
      method: "POST",
      body: JSON.stringify({ email: email.value.trim(), password: password.value }),
    });
    password.value = "";
    emit("success");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <PublicShell title="登入菁英作業台" lead="請輸入您的電子郵件與密碼。">
    <div v-if="props.bootError" class="notice error" role="alert">
      {{ props.bootError }}<button @click="emit('retry')">重新連線</button>
    </div>
    <form data-testid="login-form" @submit.prevent="submit">
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
      <p class="public-links"><a href="#/forgot-password" data-testid="login-forgot">忘記密碼？</a></p>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <button class="primary" :disabled="busy">{{ busy ? "登入中…" : "登入工作台" }}</button>
    </form>
    <p class="public-links">還沒有帳號？<a href="#/register" data-testid="login-register">立即註冊</a></p>
  </PublicShell>
</template>
