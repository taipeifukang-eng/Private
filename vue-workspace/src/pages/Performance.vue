<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from "vue";
import type { WorkTab } from "../stores";
import PerformanceGroup from "./PerformanceGroup.vue";
import PerformancePrescription from "./PerformancePrescription.vue";
import PerformanceBonus from "./PerformanceBonus.vue";
const props = defineProps<{ tab: WorkTab }>();
type Section = "group" | "prescription" | "bonus";
const section = ref<Section>("group"),
  visited = reactive({ group: true, prescription: false, bonus: false }),
  canViewBonus = ref(false);
function local(kind: WorkTab["kind"]): WorkTab {
  return {
    ...props.tab,
    id: props.tab.id + "-" + kind,
    kind,
    dirty: false,
    busy: false,
    save: undefined,
    discard: undefined,
  };
}
const panes = reactive({
  group: local("performance"),
  prescription: local("performance-prescription"),
  bonus: local("performance-bonus"),
});
function select(next: Section) {
  if (props.tab.busy) return;
  if (!visited[next]) {
    panes[next].store = panes.group.store;
    panes[next].month = panes.group.month;
  }
  visited[next] = true;
  section.value = next;
}
if (props.tab.kind === "performance") {
  props.tab.title = "業績管理";
  watch(
    () => [panes.group.dirty, panes.prescription.dirty, panes.bonus.dirty],
    (v) => {
      props.tab.dirty = v.some(Boolean);
    },
    { flush: "sync" },
  );
  watch(
    () => [panes.group.busy, panes.prescription.busy, panes.bonus.busy],
    (v) => {
      props.tab.busy = v.some(Boolean);
    },
    { flush: "sync" },
  );
  props.tab.save = async () => {
    for (const key of ["group", "prescription", "bonus"] as Section[]) {
      if (panes[key].dirty) {
        if (!panes[key].save || !(await panes[key].save!())) {
          section.value = key;
          return false;
        }
      }
    }
    return true;
  };
}
onBeforeUnmount(() => {
  if (props.tab.kind === "performance") delete props.tab.save;
});
</script>
<template>
  <PerformanceGroup v-if="tab.kind !== 'performance'" :tab="tab" />
  <template v-else>
    <header class="page-heading">
      <div>
        <p class="eyebrow">營運 / 業績管理</p>
        <h1>業績管理</h1>
      </div>
    </header>
    <nav class="performance-sections" aria-label="業績子功能">
      <button
        :aria-pressed="section === 'group'"
        :class="{ primary: section === 'group' }"
        :disabled="tab.busy"
        @click="select('group')"
      >
        團體獎金
      </button>
      <button
        :aria-pressed="section === 'prescription'"
        :class="{ primary: section === 'prescription' }"
        :disabled="tab.busy"
        @click="select('prescription')"
      >
        處方箋
      </button>
      <button
        v-if="canViewBonus"
        :aria-pressed="section === 'bonus'"
        :class="{ primary: section === 'bonus' }"
        :disabled="tab.busy"
        @click="select('bonus')"
      >
        匯入每月獎金
      </button>
    </nav>
    <section v-show="section === 'group'" aria-label="團體獎金">
      <PerformanceGroup
        :tab="panes.group"
        embedded
        @access="canViewBonus = $event"
      />
    </section>
    <section
      v-if="visited.prescription"
      v-show="section === 'prescription'"
      aria-label="處方箋"
    >
      <PerformancePrescription :tab="panes.prescription" embedded />
    </section>
    <section
      v-if="visited.bonus && canViewBonus"
      v-show="section === 'bonus'"
      aria-label="匯入每月獎金"
    >
      <PerformanceBonus :tab="panes.bonus" embedded />
    </section>
  </template>
</template>
<style scoped>
.performance-sections {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
  padding-bottom: 16px;
  margin-bottom: 24px;
}
</style>
