<script setup lang="ts">
// 公開頁 /register（Q15 保留公開註冊；Q16 密碼最短 6 字元）。新帳號沒有任何角色，登入後看到「帳號待管理員開通」。
import { ref } from "vue";
import { api } from "../api";
import { MIN_PASSWORD_LENGTH, validateRegister } from "../../../lib/workspace/auth-public";
import PublicShell from "../components/PublicShell.vue";
defineProps<{ params: Record<string, unknown> }>();
const form = ref({ fullName: "", email: "", password: "", confirmPassword: "" }),
  busy = ref(false),
  error = ref(""),
  done = ref("");
async function submit() {
  error.value = "";
  const invalid = validateRegister(form.value);
  if (invalid) {
    error.value = invalid;
    return;
  }
  busy.value = true;
  try {
    const r = await api<{ message: string }>("auth/register", {
      method: "POST",
      body: JSON.stringify({ ...form.value, email: form.value.email.trim() }),
    });
    done.value = r.message;
    form.value.password = form.value.confirmPassword = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <PublicShell title="建立帳號" lead="註冊以開始使用富康菁英業務網。">
    <div v-if="done" class="notice" role="status" data-testid="register-done">
      {{ done }}
    </div>
    <p v-if="done" class="public-links"><a href="#/login" data-testid="register-to-login">前往登入</a></p>
    <form v-else data-testid="register-form" novalidate @submit.prevent="submit">
      <label
        >姓名<input v-model="form.fullName" type="text" autocomplete="name" maxlength="100" placeholder="輸入您的姓名"
      /></label>
      <label
        >電子郵件<input v-model="form.email" type="email" autocomplete="email" placeholder="your@email.com"
      /></label>
      <label
        >密碼<input
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          :placeholder="`至少 ${MIN_PASSWORD_LENGTH} 個字元`"
      /></label>
      <label
        >確認密碼<input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="再次輸入密碼"
      /></label>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <button class="primary" :disabled="busy">{{ busy ? "註冊中…" : "註冊" }}</button>
    </form>
    <p v-if="!done" class="public-links">已經有帳號？<a href="#/login">返回登入</a></p>
  </PublicShell>
</template>
