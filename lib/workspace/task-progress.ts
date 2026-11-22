// M3 B.2–B.4：任務進度、整體狀態與「我的任務」去重的純規則（無 I/O，供 API、Vue 與測試共用）。
// 進度一律以勾選紀錄（logs 推算的 state）為準，不看 assignments.status 欄位。
import { flattenTaskSteps, type TaskStep } from "./task-state";

export type TaskStatus = "pending" | "in_progress" | "completed";
type TemplateLike = { sections?: any[] | null; steps_schema?: TaskStep[] | null } | null | undefined;

/** 範本全部區段（沒有區段時是 steps_schema）的所有步驟（含子步驟）。 */
export function allTemplateSteps(template: TemplateLike): TaskStep[] {
  const sections = Array.isArray(template?.sections) ? template!.sections! : [];
  return flattenTaskSteps(
    sections.length ? sections.flatMap((s: any) => s.steps || []) : template?.steps_schema || [],
  );
}
/** 指派給某人的區段步驟；區段不存在回 null（區段已變更）。 */
export function sectionSteps(template: TemplateLike, sectionId: string | null | undefined): TaskStep[] | null {
  const sections = Array.isArray(template?.sections) ? template!.sections! : [];
  if (!sectionId) return template?.steps_schema || [];
  const section = sections.find((s: any) => s.id === sectionId);
  return section ? section.steps || [] : null;
}
/** B.3：所有區段所有步驟完成才是 completed；有任何勾選為 in_progress；否則 pending。 */
export function overallStatus(total: number, done: number): TaskStatus {
  if (total > 0 && done >= total) return "completed";
  return done > 0 ? "in_progress" : "pending";
}
export function progressOf(template: TemplateLike, sectionId: string | null | undefined, state: Record<string, unknown>) {
  const all = allTemplateSteps(template);
  const mineSteps = sectionSteps(template, sectionId);
  const mine = mineSteps ? flattenTaskSteps(mineSteps) : [];
  const overallTotal = all.length;
  const overallDone = all.filter((s) => s.id in state).length;
  return {
    sectionChanged: mineSteps === null,
    total: mine.length,
    done: mine.filter((s) => s.id in state).length,
    overallTotal,
    overallDone,
    percent: overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0,
    status: overallStatus(overallTotal, overallDone),
  };
}

export type DedupeRow = {
  id: string;
  template_id?: string | null;
  department?: string | null;
  sectionId?: string | null;
  created_at: string;
  overallDone: number;
};
export const dedupeKey = (r: DedupeRow) => JSON.stringify([r.template_id ?? "", r.department ?? "", r.sectionId ?? ""]);
/**
 * B.2：去重鍵照舊（同範本、同部門、同區段）。有任何進度的一律保留；整組都沒進度時只留最新一筆；
 * 同一組有多筆有進度時全部保留並標 multiple（畫面標派發日期）。輸入需已依建立時間新到舊排序。
 */
export function dedupeKeepProgress<T extends DedupeRow>(rows: T[]): (T & { multiple: boolean })[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = dedupeKey(r);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const keep = new Set<string>();
  const multiple = new Set<string>();
  for (const [k, g] of Array.from(groups.entries())) {
    const progressed = g.filter((r) => r.overallDone > 0);
    if (progressed.length) {
      progressed.forEach((r) => keep.add(r.id));
      if (progressed.length > 1) multiple.add(k);
    } else keep.add(g[0].id);
  }
  return rows.filter((r) => keep.has(r.id)).map((r) => ({ ...r, multiple: multiple.has(dedupeKey(r)) }));
}
/** 儀表板統計卡：以 progressOf 推算的整體狀態計數。 */
export function statusCounts(rows: { status: TaskStatus }[]) {
  return {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    completed: rows.filter((r) => r.status === "completed").length,
  };
}
