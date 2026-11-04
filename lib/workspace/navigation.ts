import { ORGANIZATION_NAV_PERMISSION_CODES } from "@/lib/admin/organization-management";
import {
  USER_MANAGEMENT_NAV_PERMISSION_CODES,
  ROLE_MANAGEMENT_NAV_PERMISSION_CODES,
} from "@/lib/permissions/rbac-management";
import type { WorkspaceNavKind } from "./page-kinds";
import { type Context, CAMPAIGN_PAGE_CODES } from "./server";
import {
  GA_MAINTENANCE_MODULE_CODES,
  GA_WORK_ORDER_MODULE_CODES,
} from "@/lib/general-affairs/maintenance-permissions";

// Mirrors the existing Navbar's functional entries. Links are navigation only;
// every legacy page/API retains its existing authorization and store scope.
export function workspaceNavigation(
  ctx: Context,
  features: {
    transfers?: boolean;
    movementDraft?: boolean;
    movementHistory?: boolean;
    employees?: boolean;
    employeeCreate?: boolean;
    employeeBirthdays?: boolean;
    employeeImport?: boolean;
    improvements?: boolean;
    taskArchive?: boolean;
    taskManagement?: boolean;
    monthlyExport?: boolean;
    /** 活動檢視入口：canEnterCampaignView（view_all，或 view_own 且有 store_managers 任命／盤點組）。 */
    campaignView?: boolean;
  } = {},
) {
  const has = (...codes: string[]) => ctx.has(...codes);
  const storeManager =
    ctx.roleCodes.has("store_manager") ||
    ctx.roleCodes.has("store_manager_role");
  const item = (
    label: string,
    href: string,
    codes: readonly string[] = [],
    kind?: WorkspaceNavKind,
  ) => ({ label, href, kind, allowed: !codes.length || has(...codes) });
  const groups = [
    {
      label: "派發任務",
      items: [
        item("我的任務", "/my-tasks", ["task.view_own"], "my-tasks"),
        item("儀表板", "/dashboard", ["dashboard.view"]),
        ...(features.taskManagement
          ? [item("任務管理", "/admin/templates", [], "task-management")]
          : []),
        ...(features.taskArchive
          ? [item("已封存任務", "/admin/archived", [], "task-archive")]
          : []),
      ],
    },
    {
      label: "組織與門市",
      items: [
        item("年度行事曆", "/organization/calendar"),
        item(
          "公司組織",
          "/admin/organization",
          ORGANIZATION_NAV_PERMISSION_CODES,
          "organization",
        ),
        item("部門管理", "/admin/departments", [...ORGANIZATION_NAV_PERMISSION_CODES, "organization.department_workspace.manage"], "departments"),
        item("店長指派", "/admin/store-managers", ["store.manager.assign", "store.manage"], "store-managers"),
        item("經理/督導管理", "/admin/supervisors", [
          "store.supervisor.assign", "store.manager.assign", "store.manage",
        ], "supervisors"),
        item("門市管理", "/admin/stores", ["store.store.view", "store.store.view_inactive", "store.store.create", "store.store.edit", "store.store.clone", "store.manage"], "stores"),
        item("員工管理", "/admin/employee-management", ["employee.manage"], features.employees ? "employees" : undefined),
        ...(features.transfers || features.movementDraft || features.movementHistory
          ? [item("人員異動管理", "/admin/promotion-management", [], "movement-management")]
          : [item("人員異動管理", "/admin/promotion-management", ["employee.movement.manage"])]),
        item("批次匯入員工", "/admin/import-employees", ["employee.import"], features.employeeImport ? "employee-import" : undefined),
        item(
          "活動管理",
          "/admin/activity-management",
          [
            "activity.manage",
            "activity.campaign.edit",
            "activity.store_detail.edit",
            "activity.equipment_trip.edit",
            "activity.checklist.edit",
            ...CAMPAIGN_PAGE_CODES,
          ],
          has(...CAMPAIGN_PAGE_CODES) ? "campaigns" : undefined,
        ),
        // 舊 Navbar 的「活動檢視」（/activity-management）：條件由 lib/campaign-access.ts 的 canEnterCampaignView 決定。
        { label: "活動檢視", href: "/activity-management", kind: undefined, allowed: !!features.campaignView },
        item(
          "盤點管理",
          "/inventory",
          [
            "inventory.manage",
            "inventory.inventory.access",
            "inventory.inventory.view",
            "inventory.result_analysis.view_own",
          ],
          "inventory",
        ),
        item(
          "業績管理",
          "/admin/performance",
          ["performance.view", "performance.edit"],
          "performance",
        ),
        item("藥師管理", "/admin/pharmacist-management", [
          "pharmacist.management.view",
        ], "pharmacists"),
        item("員工購物管理", "/admin/employee-purchases", [
          "employee_purchase.view",
          "employee_purchase.import",
        ], "employee-purchases"),
        item("診所自費藥毛利計算", "/store/clinic-selfpay-margin", [
          "monthly.status.view_own",
          "monthly.status.view_all",
          "employee.movement.manage",
          "store.manage",
        ]),
        item("關係會員", "/store/relationship-members", [
          "relationship_member.view",
          "relationship_member.edit",
          "relationship_member.delete",
          "relationship_member.approve",
        ], "relationships"),
        item("商品主檔", "/cross-dept/products-master", [
          "store.products_master.manage",
        ]),
      ],
    },
    {
      label: "每月人員狀態",
      items: [
        item(
          "每月人員狀態",
          "/monthly-status",
          ["monthly.status.view_own", "monthly.status.view_all"],
          "monthly",
        ),
        // 規格 A：入口與全部匯出只看 monthly.export.download（由 features.monthlyExport 判斷）。
        {
          ...item("資料匯出", "/admin/export-monthly-status", [], "monthly-export"),
          allowed: !!features.monthlyExport,
        },
        // 規格 E：「每月版更內容」不放在選單，改由工作台首頁卡片進入（同舊版）。
      ],
    },
    {
      label: "督導巡店",
      items: [
        item(
          "巡店列表",
          "/inspection",
          [
            "inspection.view_all",
            "inspection.view_store",
            "inspection.view_own",
          ],
          "inspections",
        ),
        ...(has("inspection.compare") &&
        has("inspection.manager_tab") &&
        has(
          "inspection.view_all",
          "inspection.view_store",
          "inspection.view_own",
        )
          ? [
              item(
                "巡店比較",
                "/inspection/compare",
                ["inspection.compare"],
                "inspection-compare",
              ),
            ]
          : []),
        item(
          "待改善追蹤",
          "/inspection/improvements",
          [
            "inspection.improvement.view_all",
            "inspection.improvement.view_own",
            "inspection.improvement.view_own_store",
            "inspection.improvement.manage",
            "inspection.improvement.submit",
          ],
          "improvements",
        ),
        item(
          "模板管理",
          "/admin/inspection-templates",
          ["inspection.template.manage"],
          "inspection-settings",
        ),
        item("督導管理日誌", "/supervisor-management-log", [
          "supervisor.management_log.view_own",
          "supervisor.management_log.view_team",
          "supervisor.management_log.create",
          "supervisor.management_log.update_own",
          "supervisor.management_log.follow_up",
          "supervisor.management_log.manage",
        ]),
      ],
    },
    {
      label: "總務服務中心",
      items: [
        item("服務中心首頁", "/general-affairs", [
          "general_affairs.service_center.access",
          "general_affairs.inventory_balance.view",
          "general_affairs.inventory_transaction.view",
          "general_affairs.inventory_transaction.manage",
          "general_affairs.inventory_transfer.view",
          "general_affairs.inventory_transfer.manage",
          "general_affairs.equipment.view",
          "general_affairs.equipment.manage",
          "general_affairs.facility.view",
          "general_affairs.facility.manage",
          "general_affairs.part.view",
          "general_affairs.part.manage",
          "general_affairs.vendor.view",
          "general_affairs.vendor.manage",
          "general_affairs.utility_bill.view",
          "general_affairs.utility_bill.manage",
        ]),
        item("庫存管理", "/general-affairs/inventory", [
          "general_affairs.inventory_balance.view",
          "general_affairs.inventory_transaction.view",
          "general_affairs.inventory_transaction.manage",
          "general_affairs.inventory_transfer.view",
          "general_affairs.inventory_transfer.manage",
        ]),
      ],
    },
    {
      label: "跨部門管理",
      items: [
        item("商品部", "/cross-dept/merchandise", [
          "cross_dept.stockout.view_all",
          "cross_dept.stockout.respond",
          "cross_dept.stockout.submit",
        ]),
        item("總務組", "/cross-dept/maintenance", [
          "cross_dept.maintenance.view_all",
          "cross_dept.maintenance.submit",
          "cross_dept.maintenance.update",
        ]),
      ],
    },
    {
      label: "系統管理",
      items: [
        item(
          "使用者管理",
          "/admin/users",
          USER_MANAGEMENT_NAV_PERMISSION_CODES,
          "users",
        ),
        item(
          "角色權限管理",
          "/admin/roles",
          ROLE_MANAGEMENT_NAV_PERMISSION_CODES,
          "roles",
        ),
      ],
    },
  ];
  const ga = groups.find((g) => g.label === "總務服務中心")!;
  ga.items[0].allowed ||=
    storeManager ||
    has(
      ...GA_MAINTENANCE_MODULE_CODES,
      ...GA_WORK_ORDER_MODULE_CODES,
      "general_affairs.service_category.view",
      "general_affairs.service_category.manage",
      "general_affairs.service_region.view",
      "general_affairs.service_region.manage",
      "general_affairs.cooperation_record.view",
    );
  ga.items[1].allowed ||= storeManager;
  const improvements = groups
    .flatMap((g) => g.items)
    .find((i) => i.href === "/inspection/improvements");
  if (improvements && features.improvements !== undefined)
    improvements.allowed = features.improvements;
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items
        .filter((i) => i.allowed)
        .map(({ allowed, ...rest }) => rest),
    }))
    .filter((g) => g.items.length);
}
