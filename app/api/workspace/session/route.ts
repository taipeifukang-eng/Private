import {ROLE_MANAGEMENT_NAV_PERMISSION_CODES,USER_MANAGEMENT_NAV_PERMISSION_CODES} from "@/lib/permissions/rbac-management";
import {transferAccess} from "@/lib/workspace/transfers";
import {canReadMovementHistory} from "@/lib/workspace/employee-movements";
import { canReadStorePersonnel } from "@/lib/workspace/store-personnel";
import { ORGANIZATION_NAV_PERMISSION_CODES } from "@/lib/admin/organization-management";
import { taskManagementScope } from "@/lib/workspace/task-management";
import { archiveScope } from "@/lib/workspace/task-archive";
import { improvementAccess } from "@/lib/workspace/improvements";
import { moduleCodes, moduleStores } from "@/lib/workspace/modules";
import {
  CAMPAIGN_EDIT_CODES,
  CAMPAIGN_READ_CODES,
  INSPECTION_CODES,
  context,
  failed,
  inspectionStores,
  respond,
  WorkspaceError,
} from "@/lib/workspace/server";
import { workspaceNavigation } from "@/lib/workspace/navigation";
import { loadExportAccess } from "@/lib/workspace/monthly-export-server";
import { canOpenMonthlyExport } from "@/lib/workspace/monthly-export";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const ctx = await context();
    let transfers=false;try{await transferAccess(ctx);transfers=true;}catch(e){if(!(e instanceof WorkspaceError&&e.status===403))throw e;}
    const movementHistory=await canReadMovementHistory(ctx);
    const employees=ctx.has("employee.manage")&&await canReadStorePersonnel(ctx);
    const employeeCreate=ctx.has("employee.manage")&&ctx.has("employee.employee.create")&&await canReadStorePersonnel(ctx);
    const employeeBirthdays=ctx.has("employee.manage")&&ctx.has("employee.employee.edit")&&await canReadStorePersonnel(ctx);
    let taskManagement = false;
    try {
      await taskManagementScope(ctx);
      taskManagement = true;
    } catch (e) {
      if (!(e instanceof WorkspaceError && e.status === 403)) throw e;
    }
    let taskArchive = false;
    try {
      await archiveScope(ctx);
      taskArchive = true;
    } catch (e) {
      if (!(e instanceof WorkspaceError && e.status === 403)) throw e;
    }
    let improvements = false;
    try {
      await improvementAccess(ctx);
      improvements = true;
    } catch (e) {
      if (!(e instanceof WorkspaceError && e.status === 403)) throw e;
    }
    const stores = new Map<string, any>();
    if (ctx.has(...INSPECTION_CODES))
      for (const s of await inspectionStores(ctx)) stores.set(s.id, s);
    if (process.env.WORKSPACE_USE_EXISTING_SESSION === "true")
      for (const module of ["monthly", "performance"] as const)
        if (ctx.has(...moduleCodes[module]))
          for (const s of await moduleStores(ctx, module)) stores.set(s.id, s);
    const monthlyExport = canOpenMonthlyExport(await loadExportAccess(ctx));
    return respond({
      user: { id: ctx.user.id, name: ctx.profile?.full_name || "使用者" },
      permissions: Array.from(ctx.permissions),
      capabilities: {
        employeePurchases:ctx.has("employee_purchase.view") || ctx.has("employee_purchase.import"),
        pharmacists:ctx.has("pharmacist.management.view"),
        relationships:ctx.has("relationship_member.view","relationship_member.edit","relationship_member.delete","relationship_member.approve"),
        roles:ctx.has(...ROLE_MANAGEMENT_NAV_PERMISSION_CODES),
        users:ctx.has(...USER_MANAGEMENT_NAV_PERMISSION_CODES),
        transfers,
        movementDraft:ctx.has("employee.promotion.batch"),
        movementHistory,
        employees,
        employeeCreate,
        employeeBirthdays,
        employeeImport:ctx.has("employee.import"),
        departments: ctx.has(...ORGANIZATION_NAV_PERMISSION_CODES,"organization.department_workspace.manage"),
        organization: ctx.has(...ORGANIZATION_NAV_PERMISSION_CODES),
        storeMap: ctx.has("store.store.view","store.store.view_inactive","store.manage"),
        storeManagement: ctx.has("store.store.view", "store.store.view_inactive", "store.store.create", "store.store.edit", "store.store.clone", "store.manage"),
        supervisors: ctx.has("store.supervisor.assign", "store.manager.assign", "store.manage"),
        storeManagers: ctx.has("store.manager.assign", "store.manage"),
        tasks: ctx.has("task.view_own"),
        taskArchive,
        taskManagement,
        inspectionSettings: ctx.has("inspection.template.manage"),
        improvements,
        monthly: ctx.has(...moduleCodes.monthly),
        monthlyExport: monthlyExport,
        performance: ctx.has(...moduleCodes.performance),
        inventory: ctx.has(...moduleCodes.inventory),
        importInventory: ctx.has(
          "inventory.result_analysis.import",
          "inventory.manage",
          "inventory.inventory.access",
          "inventory.inventory.view",
        ),
        deleteInventory: ctx.has(
          "inventory.result_analysis.delete",
          "inventory.manage",
          "inventory.inventory.access",
          "inventory.inventory.view",
        ),
        compareInspections:
          ctx.has("inspection.compare") &&
          ctx.has("inspection.manager_tab") &&
          ctx.has(...INSPECTION_CODES),
        createInspections: ctx.has("inspection.create"),
        inspections: ctx.has(...INSPECTION_CODES),
        managerInspections: ctx.has("inspection.manager_tab"),
        campaigns: ctx.has(...CAMPAIGN_READ_CODES),
        editCampaigns: ctx.has(...CAMPAIGN_EDIT_CODES),
      },
      stores: Array.from(stores.values()),
      environment: "DEV",
      integrated: process.env.WORKSPACE_USE_EXISTING_SESSION === "true",
      navigation: workspaceNavigation(ctx, {
        transfers,
        movementDraft:ctx.has("employee.promotion.batch"),
        movementHistory,
        employees,
        employeeCreate,
        employeeBirthdays,
        employeeImport:ctx.has("employee.import"),
        improvements,
        taskArchive,
        taskManagement,
        monthlyExport,
      }),
    });
  } catch (error) {
    return failed(error);
  }
}
