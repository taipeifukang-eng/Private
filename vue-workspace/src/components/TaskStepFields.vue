<script setup lang="ts">
defineProps<{ step: any; prefix: string }>();
</script>
<template>
  <div class="task-step-fields">
    <label
      >名稱<input
        v-model="step.label"
        :aria-label="prefix + '名稱'"
        maxlength="300"
        required /></label
    ><label
      >說明<textarea
        v-model="step.description"
        :aria-label="prefix + '說明'"
        maxlength="5000"
      ></textarea>
    </label>
    <div class="filter-bar">
      <label class="check-field"
        ><input
          type="checkbox"
          v-model="step.required"
          :aria-label="prefix + '必填'"
        />必填</label
      ><label
        >預計開始<input
          type="date"
          v-model="step.planned_start_date"
          :aria-label="prefix + '預計開始'" /></label
      ><label
        >預計結束<input
          type="date"
          v-model="step.planned_end_date"
          :aria-label="prefix + '預計結束'"
          :min="step.planned_start_date || undefined"
      /></label>
    </div>
  </div>
</template>
<style scoped>
.task-step-fields {
  display: grid;
  gap: 12px;
  max-width: 920px;
}
.task-step-fields > label {
  display: grid;
  gap: 6px;
}
.task-step-fields textarea {
  font:inherit;
  padding:8px;
  border:1px solid var(--border,#d8ddcf);
  border-radius:4px;
  min-height: 64px;
  width: 100%;
}
.check-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check-field input {
  width: 18px;
  height: 18px;
}
</style>
