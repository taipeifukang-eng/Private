// M5 W21 組織與部門規則（純函式，無相依；Next 端、Vue 工作台與 Vitest 共用）。
// Q9：部門管理的進入條件照舊版 app/admin/departments/page.tsx（部門相關權限）。
// Q10：停用單位仍可調整成員與主管。
// 人員職掌統計：照舊版 OrganizationManagementClient（只算該部門、只看有效職掌：工作職掌啟用、指派啟用且未結束）。

/** 舊版部門管理頁的進入條件（任一即可）：部門工作檢視、部門檢視、新增部門、工作管理、部門編輯、成員管理、主管管理。 */
export const DEPARTMENT_PAGE_PERMISSION_CODES = [
  "organization.department_workspace.view",
  "organization.department.view",
  "organization.department.create",
  "organization.department_workspace.manage",
  "organization.department.edit",
  "organization.member.manage",
  "organization.manager.manage",
] as const;

export type AssignmentType = "PRIMARY" | "COLLABORATOR" | "BACKUP";
export const ASSIGNMENT_TYPES: readonly AssignmentType[] = ["PRIMARY", "COLLABORATOR", "BACKUP"];

type Assignment = { user_id: string; assignment_type: string; status?: string | null; effective_to?: string | null };
type WorkItem = { id?: string; status?: string | null; title?: string; assignments?: Assignment[] | null };

/** 有效的指派：啟用且沒有結束日。 */
export const isLiveAssignment = (a: Assignment) => a.status === "active" && !a.effective_to;
/** 有效職掌：只看啟用的工作職掌（舊版 API 只回傳 status=active）。 */
export const liveWorkItems = <T extends WorkItem>(items: readonly T[] | null | undefined): T[] =>
  (items || []).filter((item) => item.status === "active");

/** 某人在某職掌類型的有效職掌（舊版 PersonResponsibilityDrawer 的 grouped）。 */
export function personWorkItems<T extends WorkItem>(items: readonly T[] | null | undefined, userId: string, type: AssignmentType): T[] {
  return liveWorkItems(items).filter((item) =>
    (item.assignments || []).some((a) => a.user_id === userId && a.assignment_type === type && isLiveAssignment(a)),
  );
}
export function countPersonAssignments(items: readonly WorkItem[] | null | undefined, userId: string, type: AssignmentType): number {
  return personWorkItems(items, userId, type).length;
}
export function personResponsibilities<T extends WorkItem>(items: readonly T[] | null | undefined, userId: string) {
  const grouped = {
    PRIMARY: personWorkItems(items, userId, "PRIMARY"),
    COLLABORATOR: personWorkItems(items, userId, "COLLABORATOR"),
    BACKUP: personWorkItems(items, userId, "BACKUP"),
  };
  return { ...grouped, total: grouped.PRIMARY.length + grouped.COLLABORATOR.length + grouped.BACKUP.length };
}

/** 組織圖卡片模式：依上層分欄；同層依排序、代碼。只讀，編輯仍在樹狀。 */
export type ChartUnit = { id: string; code: string; parent_id: string | null; sort_order: number; status: string };
export type ChartNode<T extends ChartUnit> = { unit: T; children: ChartNode<T>[] };
export function buildChart<T extends ChartUnit>(units: readonly T[], showInactive: boolean): ChartNode<T>[] {
  const visible = units.filter((u) => showInactive || u.status === "active");
  const ids = new Set(visible.map((u) => u.id));
  const seen = new Set<string>();
  const sorted = (rows: T[]) => rows.slice().sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  const build = (parent: string | null): ChartNode<T>[] =>
    sorted(visible.filter((u) => (parent === null ? u.parent_id === null || !ids.has(u.parent_id) : u.parent_id === parent)))
      .filter((u) => !seen.has(u.id) && (seen.add(u.id), true))
      .map((unit) => ({ unit, children: build(unit.id) }));
  return build(null);
}
