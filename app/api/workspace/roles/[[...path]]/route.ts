import { NextRequest } from "next/server";
import * as list from "@/app/api/roles/route";
import * as role from "@/app/api/roles/[id]/route";
import * as permissions from "@/app/api/roles/[id]/permissions/route";
import * as users from "@/app/api/roles/[id]/users/route";
import * as assignment from "@/app/api/roles/[id]/users/[userId]/route";
import {
  context,
  checkOrigin,
  failed,
  respond,
  WorkspaceError,
  requireCapability,
} from "@/lib/workspace/server";
import { ROLE_MANAGEMENT_NAV_PERMISSION_CODES } from "@/lib/permissions/rbac-management";
import { hasPermission } from "@/lib/permissions/check";
export const dynamic = "force-dynamic";
async function run(req: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context();
    requireCapability(ctx, [...ROLE_MANAGEMENT_NAV_PERMISSION_CODES]);
    if (method !== "GET") checkOrigin(req);
    if (path.length === 0) {
      if (method === "POST") return list.POST(req);
      if (method === "GET") {
        const response = await list.GET(req);
        if (!response.ok) return response;
        const data = await response.json();
        const capabilities: Record<string, boolean> = {};
        for (const [key, code] of Object.entries({
          create: "role.role.create",
          edit: "role.role.edit",
          delete: "role.role.delete",
          viewPermissions: "role.permission.view",
          assignPermissions: "role.permission.assign",
          viewUsers: "role.user_role.view",
          assignUsers: "role.user_role.assign",
          revokeUsers: "role.user_role.revoke",
        }))
          capabilities[key] = await hasPermission(ctx.user.id, code);
        return respond({ ...data, capabilities });
      }
    }
    const [id, section, userId] = path;
    if (!/^[0-9a-f-]{36}$/i.test(id || ""))
      throw new WorkspaceError(400, "角色代號不正確");
    if (path.length === 1 && ["GET", "PATCH", "DELETE"].includes(method))
      return role[method as "GET" | "PATCH" | "DELETE"](req, {
        params: { id },
      });
    if (path.length === 2 && ["GET", "POST"].includes(method)) {
      if (section === "permissions")
        return permissions[method as "GET" | "POST"](req, { params: { id } });
      if (section === "users")
        return users[method as "GET" | "POST"](req, { params: { id } });
    }
    if (path.length === 3 && section === "users" && method === "DELETE")
      return assignment.DELETE(req, { params: { id, userId } });
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type RouteContext = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: RouteContext) =>
  run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: RouteContext) =>
  run(r, c.params.path || [], "POST");
export const PATCH = (r: NextRequest, c: RouteContext) =>
  run(r, c.params.path || [], "PATCH");
export const DELETE = (r: NextRequest, c: RouteContext) =>
  run(r, c.params.path || [], "DELETE");
