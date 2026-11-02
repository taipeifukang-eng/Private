// Vue 工作台頁面種類（kind）的唯一來源（T03）。
// 此檔必須保持無相依（不得 import 任何模組），因為 Next 端（navigation.ts）、
// Vue 工作台（vue-workspace/src）與 Vitest 都會直接引用。
// 新增頁面時：先在此加 kind，再到 vue-workspace/src/workspace-pages.ts 登錄；
// 漏登錄會在 vue-tsc 型別檢查時失敗（registry 是 Record<WorkTabKind, ...>）。

/** 可由全站導覽選單直接開啟的 kind（lib/workspace/navigation.ts 的 item.kind）。 */
export const WORKSPACE_NAV_KINDS = [
  "transfers",
  "movement-management",
  "movement-draft",
  "movement-history",
  "employees",
  "employee-create",
  "employee-birthdays",
  "employee-import",
  "departments",
  "organization",
  "stores",
  "supervisors",
  "store-managers",
  "task-management",
  "task-archive",
  "my-tasks",
  "inspection-settings",
  "improvements",
  "inspection-compare",
  "inspections",
  "campaigns",
  "monthly",
  "performance",
  "inventory",
  "employee-purchases",
  "pharmacists",
  "relationships",
  "roles",
  "users",
] as const;

/** 只能由其他頁面（列表、明細連結）開啟，不在導覽選單出現的 kind。 */
export const WORKSPACE_DETAIL_KINDS = [
  "employee-history",
  "department-detail",
  "department-work-editor",
  "organization-editor",
  "store-map",
  "store-promotions",
  "store-personnel",
  "store-personnel-history",
  "store-employees",
  "store-editor",
  "store-relocation",
  "store-history-editor",
  "supervisor-edit",
  "store-manager-edit",
  "task-copy",
  "task-assign",
  "task-template-editor",
  "task-management-detail",
  "task-archive-detail",
  "task-runner",
  "inspection-print",
  "inspection-setting-edit",
  "improvement-detail",
  "inspection-editor",
  "inspection-detail",
  "campaign-schedule",
  "campaign-edit",
  "monthly-edit",
  "performance-edit",
  "performance-thresholds",
  "performance-prescription",
  "performance-bonus",
] as const;

export type WorkspaceNavKind = (typeof WORKSPACE_NAV_KINDS)[number];
export type WorkspaceDetailKind = (typeof WORKSPACE_DETAIL_KINDS)[number];
export type WorkTabKind = WorkspaceNavKind | WorkspaceDetailKind;

export const WORKSPACE_TAB_KINDS: readonly WorkTabKind[] = [
  ...WORKSPACE_NAV_KINDS,
  ...WORKSPACE_DETAIL_KINDS,
];
