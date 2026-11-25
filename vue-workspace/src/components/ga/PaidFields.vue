<script setup lang="ts">
import { computed, watch } from "vue";
import { PAY_METHODS, PAY_METHOD_LABELS, PAYEE_PAY_METHODS } from "../../lib/ga-payments";

// ga-improve-b1 G4：標已付款的付款方式。多了「信用卡」（可填卡號末四碼，不收完整卡號）與「網購平台／第三方支付」（可填平台名稱）；
// 同仁代墊（錢還給同仁）只能選轉帳、現金、支票。
const props = defineProps<{ method: string; card: string; platform: string; employee?: boolean }>();
const emit = defineEmits<{ "update:method": [v: string]; "update:card": [v: string]; "update:platform": [v: string] }>();
const methods = computed(() => (props.employee ? [...PAYEE_PAY_METHODS] : [...PAY_METHODS]) as string[]);
watch(() => props.employee, (e) => { if (e && !methods.value.includes(props.method)) emit("update:method", "TRANSFER"); });
function onMethod(v: string) {
  emit("update:method", v);
  if (v !== "CREDIT_CARD") emit("update:card", "");
  if (v !== "ONLINE_PLATFORM") emit("update:platform", "");
}
</script>

<template>
  <label>付款方式<select :value="method" data-testid="act-method" @change="onMethod(($event.target as HTMLSelectElement).value)"><option v-for="m in methods" :key="m" :value="m">{{ PAY_METHOD_LABELS[m as keyof typeof PAY_METHOD_LABELS] }}</option></select></label>
  <p v-if="employee" class="muted" data-testid="act-employee-hint">同仁代墊的款項是公司還錢給同仁，只能用轉帳、現金或支票；也不能由代墊同仁本人標已付款。</p>
  <label v-if="method === 'CREDIT_CARD'">卡號末四碼（選填，只填 4 位數字，不要填完整卡號）<input :value="card" inputmode="numeric" maxlength="4" data-testid="act-card" @input="emit('update:card', ($event.target as HTMLInputElement).value)" /></label>
  <label v-if="method === 'ONLINE_PLATFORM'">平台名稱（選填，例如蝦皮、PChome；訂單編號請填在付款參考號）<input :value="platform" maxlength="40" data-testid="act-platform" @input="emit('update:platform', ($event.target as HTMLInputElement).value)" /></label>
</template>
