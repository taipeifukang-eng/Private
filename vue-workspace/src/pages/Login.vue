<script setup lang="ts">
// 公開頁 /login（D14：原網址 /login 轉到這裡）。登入後回原頁只允許站內路徑（QR 掃描情境需要）。
import { useRoute, useRouter } from "vue-router";
import { useSession } from "../stores";
import { safeRedirectPath } from "../../../lib/workspace/auth-public";
import LoginForm from "../components/LoginForm.vue";
defineProps<{ params: Record<string, unknown> }>();
const route = useRoute(),
  router = useRouter(),
  session = useSession();
async function done() {
  await session.refresh();
  const target = safeRedirectPath(route.query.redirect);
  // 回原頁是 Next 路徑（可能再被轉到新版）；沒有或只是首頁時進工作台。
  if (target && target !== "/") window.location.assign(target);
  else await router.replace("/");
}
</script>
<template>
  <LoginForm @success="done" />
</template>
