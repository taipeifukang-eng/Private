import { NextRequest } from "next/server";
import * as members from "@/app/api/relationship-members/route";
import * as member from "@/app/api/relationship-members/[id]/route";
import * as approve from "@/app/api/relationship-members/[id]/approve/route";
import * as reject from "@/app/api/relationship-members/[id]/reject/route";
import * as sales from "@/app/api/relationship-sales/route";
import * as importer from "@/app/api/relationship-sales/import/route";
import {
  context,
  checkOrigin,
  failed,
  respond,
  requireCapability,
  WorkspaceError,
} from "@/lib/workspace/server";
import { hasPermission } from "@/lib/permissions/check";
export const dynamic = "force-dynamic";
async function run(r: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context();
    requireCapability(ctx, [
      "relationship_member.view",
      "relationship_member.edit",
      "relationship_member.delete",
      "relationship_member.approve",
    ]);
    if (method !== "GET") checkOrigin(r);
    if (path.length === 0) {
      if (method === "POST") return members.POST(r);
      if (method === "GET") {
        const response = await members.GET();
        if (!response.ok) return response;
        const data = await response.json();
        const [view, edit, remove, approval] = await Promise.all(
          ["view", "edit", "delete", "approve"].map((code) =>
            hasPermission(ctx.user.id, "relationship_member." + code),
          ),
        );
        return respond({
          ...data,
          capabilities: {
            submit: view || edit,
            sales: view || edit,
            edit,
            delete: remove,
            approve: approval,
          },
        });
      }
    }
    if (path[0] === "sales") {
      if (path.length === 1 && method === "GET") return sales.GET(r);
      if (path.length === 2 && path[1] === "import" && method === "POST")
        return importer.POST(r);
    }
    const id = path[0];
    if (!/^[0-9a-f-]{36}$/i.test(id || ""))
      throw new WorkspaceError(400, "會員識別碼不正確");
    if (path.length === 1 && method === "PATCH")
      return member.PATCH(r, { params: { id } });
    if (path.length === 1 && method === "DELETE")
      return member.DELETE(r, { params: { id } });
    if (path.length === 2 && method === "POST") {
      if (path[1] === "approve") return approve.POST(r, { params: { id } });
      if (path[1] === "reject") return reject.POST(r, { params: { id } });
    }
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: C) =>
  run(r, c.params.path || [], "POST");
export const PATCH = (r: NextRequest, c: C) =>
  run(r, c.params.path || [], "PATCH");
export const DELETE = (r: NextRequest, c: C) =>
  run(r, c.params.path || [], "DELETE");
