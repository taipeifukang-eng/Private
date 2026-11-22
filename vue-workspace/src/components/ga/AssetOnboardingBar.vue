<script setup lang="ts">
import { computed } from "vue";
import { Check } from "lucide-vue-next";
import { ONBOARDING_LABEL, ONBOARDING_PERCENT, ONBOARDING_STATUSES, type OnboardingStatus } from "../../lib/ga-assets";

// 建檔貼標進度條：設備與設施共用（四階段：照片 → 貼標照 → 總務複核 → 完成）。
const props = withDefaults(defineProps<{ status: string; type?: "equipment" | "facility"; compact?: boolean }>(), { type: "equipment", compact: false });
const current = computed<OnboardingStatus>(() => ((ONBOARDING_STATUSES as readonly string[]).includes(props.status) ? props.status : "NEEDS_EQUIPMENT_PHOTO") as OnboardingStatus);
const index = computed(() => ONBOARDING_STATUSES.indexOf(current.value));
const steps = computed(() => [props.type === "facility" ? "設施照片" : "設備照片", "貼標照片", "總務複核", "完成"]);
</script>

<template>
  <div class="onb" :aria-label="`貼標進度：${ONBOARDING_LABEL[current][type]}`">
    <div class="head"><strong>{{ ONBOARDING_LABEL[current][type] }}</strong><span class="muted">{{ ONBOARDING_PERCENT[current] }}%</span></div>
    <div class="track" role="progressbar" :aria-valuenow="ONBOARDING_PERCENT[current]" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ width: ONBOARDING_PERCENT[current] + '%' }" /></div>
    <ol v-if="!compact" class="steps">
      <li v-for="(label, i) in steps" :key="label" :class="{ done: i < index || current === 'COMPLETED', now: i === index && current !== 'COMPLETED' }">
        <span class="dot"><Check v-if="i < index || current === 'COMPLETED'" :size="12" /><template v-else>{{ i + 1 }}</template></span>{{ label }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.onb { display: grid; gap: 6px; min-width: 0; }
.head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.track { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
.fill { height: 100%; background: var(--primary); transition: width 0.2s; }
.steps { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; font-size: 12px; text-align: center; color: var(--muted); }
.steps li { display: grid; justify-items: center; gap: 2px; }
.dot { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); font-size: 11px; font-weight: 700; }
.done { color: var(--primary); }
.done .dot { background: var(--soft); border-color: var(--primary); }
.now { color: var(--ink); font-weight: 700; }
.now .dot { border-color: var(--primary); }
</style>
