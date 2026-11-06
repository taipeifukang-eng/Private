// Shared, deterministic checklist rules. Persistence and authorization live in tasks.ts.
export type TaskStep = {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  planned_start_date?: string;
  planned_end_date?: string;
  subSteps?: TaskStep[];
};
export type TaskLog = {
  id?: string;
  step_id: string;
  action: string;
  note?: string | null;
  created_at: string;
};
export type TaskChange = { stepId: string; checked: boolean; note?: string };
export function flattenTaskSteps(steps: TaskStep[]) {
  return steps.flatMap((s) => [s, ...(s.subSteps || [])]);
}
export function taskState(logs: TaskLog[]) {
  const state: Record<string, string> = {};
  for (const log of [...logs].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      (a.id || "").localeCompare(b.id || ""),
  )) {
    if (log.action === "complete") state[log.step_id] = log.note || "";
    if (log.action === "uncomplete") delete state[log.step_id];
  }
  return state;
}
export function applyTaskChanges(
  steps: TaskStep[],
  initial: Record<string, string>,
  changes: TaskChange[],
) {
  const state = { ...initial };
  const actions: { step_id: string; action: string; note: string | null }[] =
    [];
  function set(id: string, checked: boolean, note?: string) {
    if (checked) state[id] = note ?? state[id] ?? "";
    else delete state[id];
    actions.push({
      step_id: id,
      action: checked ? "complete" : "uncomplete",
      note: checked ? state[id] || null : null,
    });
  }
  for (const change of changes) {
    const parent = steps.find(
      (s) =>
        s.id === change.stepId ||
        s.subSteps?.some((c) => c.id === change.stepId),
    );
    if (!parent) throw new Error("項目不屬於可操作區段");
    if (
      typeof change.checked !== "boolean" ||
      (change.note !== undefined &&
        (typeof change.note !== "string" || change.note.length > 5000))
    )
      throw new Error("項目或備註格式不符");
    set(change.stepId, change.checked, change.note);
    if (parent.id === change.stepId) {
      for (const sub of parent.subSteps || []) {
        if (sub.id in state !== change.checked) set(sub.id, change.checked);
      }
    } else if (parent.subSteps?.every((s) => s.id in state)) {
      if (!(parent.id in state)) set(parent.id, true);
    } else if (parent.id in state) set(parent.id, false);
  }
  return { state, actions };
}

/** M3 F2：代做標記由伺服器決定。非參與者全部代做；參與者只有「不在自己區段」的項目才算代做。 */
export function markProxyActions<T extends { step_id: string }>(
  actions: T[],
  ownStepIds: string[],
  nonParticipant: boolean,
) {
  const own = new Set(ownStepIds);
  return actions.map((a) => ({ ...a, proxy: nonParticipant || !own.has(a.step_id) }));
}
