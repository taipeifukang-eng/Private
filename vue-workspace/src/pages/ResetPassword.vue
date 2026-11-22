<script setup lang="ts">
// 公開頁 /reset-password：重設信連結 -> /auth/callback（換成登入狀態）-> 原網址 /reset-password -> 這裡。
// Q16：最短 6 字元；強度只提示不強制。連結失效時引導重新申請。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import {
  MIN_PASSWORD_LENGTH,
  RESET_LINK_ERROR_TEXT,
  RESET_LINK_MISSING_TEXT,
  passwordStrength,
  validateNewPassword,
} from "../../../lib/workspace/auth-public";
import PublicShell from "../components/PublicShell.vue";
defineProps<{ params: Record<string, unknown> }>();
const route = useRoute(),
  router = useRouter();
const state = ref<"checking" | "invalid" | "ready" | "done">("checking"),
  invalidText = ref(""),
  password = ref(""),
  confirm = ref(""),
  show = ref(false),
  busy = ref(false),
  error = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
const strength = computed(() => passwordStrength(password.value));
onMounted(async () => {
  // 只認有帶 error，不顯示網址上的任意文字
  if (route.query.error) {
    invalidText.value = RESET_LINK_ERROR_TEXT;
    state.value = "invalid";
    return;
  }
  try {
    const r = await api<{ valid: boolean }>("auth/reset-password");
    if (r.valid) state.value = "ready";
    else {
      invalidText.value = RESET_LINK_MISSING_TEXT;
      state.value = "invalid";
    }
  } catch {
    invalidText.value = "驗證失敗，請重新申請重設連結";
    state.value = "invalid";
  }
});
onBeforeUnmount(() => timer && clearTimeout(timer));
async function submit() {
  error.value = "";
  const invalid = validateNewPassword(password.value, confirm.value);
  if (invalid) {
    error.value = invalid;
    return;
  }
  busy.value = true;
  try {
    await api("auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ password: password.value, confirmPassword: confirm.value }),
    });
    password.value = confirm.value = "";
    state.value = "done";
    // 重設用的登入狀態不保留：請用新密碼重新登入
    await api("logout", { method: "POST", body: "{}" }).catch(() => undefined);
    timer = setTimeout(() => void router.push("/login"), 3000);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <PublicShell title="設定新密碼" lead="請輸入您的新密碼。">
    <p v-if="state === 'checking'" class="muted" role="status">正在驗證重設連結…</p>
    <template v-else-if="state === 'invalid'">
      <div class="notice error" role="alert" data-testid="reset-invalid">
        <strong>連結無效或已過期</strong><br />{{ invalidText }}
      </div>
      <p class="public-links"><a href="#/forgot-password">重新申請重設連結</a>　<a href="#/login">返回登入</a></p>
    </template>
    <div v-else-if="state === 'done'" class="notice" role="status" data-testid="reset-done">
      密碼已成功重設，請用新密碼登入。三秒後自動前往登入頁，也可<a href="#/login">直接前往</a>。
    </div>
    <form v-else data-testid="reset-form" novalidate @submit.prevent="submit">
      <label
        >新密碼<input
          v-model="password"
          :type="show ? 'text' : 'password'"
          autocomplete="new-password"
          :placeholder="`至少 ${MIN_PASSWORD_LENGTH} 個字元`"
      /></label>
      <small v-if="password" class="muted" data-testid="reset-strength">密碼強度：{{ strength.label }}（僅供參考）</small>
      <label
        >確認新密碼<input v-model="confirm" :type="show ? 'text' : 'password'" autocomplete="new-password" placeholder="再次輸入新密碼"
      /></label>
      <label class="check-row"><input v-model="show" type="checkbox" />顯示密碼</label>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <button class="primary" :disabled="busy">{{ busy ? "設定中…" : "設定新密碼" }}</button>
    </form>
  </PublicShell>
</template>
