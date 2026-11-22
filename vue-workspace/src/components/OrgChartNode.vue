<script setup lang="ts">
// M5 W21 組織圖卡片（唯讀）：遞迴渲染一個單位卡片與其下層。編輯仍只在樹狀模式進行。
import { unitTypes, managerRoles } from "../organization";
import { chartCounts } from "../../../lib/workspace/organization-rules";
defineOptions({ name: "OrgChartNode" });
defineProps<{ node: { unit: any; children: any[] }; selected: string; dim: Set<string> | null }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>
<template>
  <li class="chart-node">
    <button type="button" class="chart-card" data-testid="chart-card" :class="{ selected: selected === node.unit.id, inactive: node.unit.status === 'inactive', dim: dim && !dim.has(node.unit.id) }" :aria-current="selected === node.unit.id" @click="emit('select', node.unit.id)">
      <small>{{ unitTypes[node.unit.type] }} · {{ node.unit.code }}{{ node.unit.status === "inactive" ? " · 停用" : "" }}</small>
      <strong>{{ node.unit.name }}</strong>
      <span>{{ node.unit.members.length }} 位成員</span>
      <span data-testid="chart-counts">{{ chartCounts(node).children }} 個下層 | {{ chartCounts(node).people }} 人</span>
      <span>{{ node.unit.managers.map((m: any) => (m.user?.full_name || "") + (m.is_primary ? "" : "（" + managerRoles[m.manager_role] + "）")).filter(Boolean).join("、") || "未設定主管" }}</span>
    </button>
    <ul v-if="node.children.length" class="chart-children">
      <OrgChartNode v-for="child in node.children" :key="child.unit.id" :node="child" :selected="selected" :dim="dim" @select="emit('select', $event)" />
    </ul>
  </li>
</template>
<style scoped>
.chart-node{list-style:none;position:relative;padding:12px 8px 0}.chart-card{display:grid;gap:4px;text-align:left;min-width:170px;max-width:220px;box-sizing:border-box;padding:10px 12px;background:var(--surface);border:1px solid var(--line)}.chart-card.selected{border:2px solid var(--primary);background:var(--soft)}.chart-card.inactive{opacity:.65;border-style:dashed}.chart-card.dim{opacity:.4}.chart-card small,.chart-card span,.chart-card strong{overflow-wrap:anywhere;min-width:0;white-space:normal}.chart-card small,.chart-card span{color:var(--muted);font-size:13px}.chart-children{display:flex;gap:8px;padding:0;margin:0;border-top:1px solid var(--line);margin-top:12px;align-items:flex-start}
</style>
