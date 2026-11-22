import { NextRequest } from "next/server";
import {
  context,
  checkOrigin,
  requireCapability,
  WorkspaceError,
  respond,
  failed,
} from "@/lib/workspace/server";
import { USER_MANAGEMENT_NAV_PERMISSION_CODES } from "@/lib/permissions/rbac-management";
import {
  getUserRbacListSummaries,
  getUserRbacDetail,
  isAdminLikeLegacyOrRole,
  isDevTestAccount,
} from "@/lib/admin/user-rbac-view";
import { deleteUser } from "@/app/auth/actions";
import { hasPermission } from "@/lib/permissions/check";
import { isBanActive, isPendingActivation } from "@/lib/workspace/user-management-rules";
export const dynamic = "force-dynamic";
async function access() {
  const ctx = await context();
  requireCapability(ctx, [...USER_MANAGEMENT_NAV_PERMISSION_CODES]);
  return ctx;
}
function id(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new WorkspaceError(400, "使用者 ID 格式錯誤");
  return value;
}
async function permission(user: string, code: string) {
  if (!(await hasPermission(user, code)))
    throw new WorkspaceError(403, "沒有此操作權限");
}
export async function GET(request: NextRequest) {
  try {
    const ctx = await access(),
      target = request.nextUrl.searchParams.get("id");
    if (target) {
      const detail = await getUserRbacDetail(ctx.admin, id(target));
      if (!detail) throw new WorkspaceError(404, "找不到使用者");
      return respond({ detail });
    }
    const { data: profiles, error } = await ctx.admin
      .from("profiles")
      .select(
        "id,email,full_name,role,department,job_title,employee_code,created_at,updated_at",
      );
    if (error) throw error;
    const rows = new Map<string, any>(
      (profiles || []).map((p) => [
        p.id,
        { ...p, is_disabled: false, has_auth: false },
      ]),
    );
    for (let page = 1; ; page++) {
      const { data, error } = await ctx.admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      for (const u of data.users) {
        const profile = rows.get(u.id);
        rows.set(u.id, {
          id: u.id,
          email: u.email || "",
          full_name: u.user_metadata?.full_name || u.user_metadata?.name || "",
          role: "member",
          created_at: u.created_at,
          ...profile,
          has_auth: true,
          is_disabled: isBanActive(u.banned_until),
        });
      }
      if (data.users.length < 1000) break;
    }
    const summaries = await getUserRbacListSummaries(
      ctx.admin,
      Array.from(rows.keys()),
    );
    const users = Array.from(rows.values()).map((u) => {
      const s = summaries.get(u.id);
      return {
        ...u,
        rbac_roles: s?.roles || [],
        effective_permission_count: s?.effective_permission_count || 0,
        store_scope_count: s?.store_scope_count || 0,
        is_admin_compatibility: isAdminLikeLegacyOrRole(
          u.role,
          (s?.roles || []).filter((r) => r.is_current).map((r) => r.code),
        ),
        is_dev_test_account: isDevTestAccount(u.email),
      };
    }).map((u) => ({ ...u, is_pending_activation: isPendingActivation(u) }));
    const codes = ["create", "edit", "delete", "change_role"];
    const flags = await Promise.all(
      codes.map((c) => hasPermission(ctx.user.id, "user.user." + c)),
    );
    return respond({
      users,
      // M5 Q15：待開通 = 沒有任何生效角色的有效帳號（站內通知，不另寄信）
      pendingCount: users.filter((u) => u.is_pending_activation).length,
      currentUser: ctx.user.id,
      capabilities: {
        ...Object.fromEntries(codes.map((c, i) => [c, flags[i]])),
        reset: rows.get(ctx.user.id)?.role === "admin",
      },
    });
  } catch (e) {
    return failed(e);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    checkOrigin(request);
    const ctx = await access(),
      body = await request.json(),
      target = id(body.id),
      changes: Record<string, any> = {};
    if (body.action === "role") {
      await permission(ctx.user.id, "user.user.change_role");
      if (target === ctx.user.id)
        throw new WorkspaceError(400, "不能修改目前登入使用者的相容角色");
      if (!["admin", "manager", "member"].includes(body.role))
        throw new WorkspaceError(400, "角色格式錯誤");
      changes.role = body.role;
    } else if (body.action === "edit") {
      await permission(ctx.user.id, "user.user.edit");
      for (const key of [
        "full_name",
        "employee_code",
        "department",
        "job_title",
      ]) {
        if (typeof body[key] !== "string" || body[key].length > 200)
          throw new WorkspaceError(400, "欄位格式錯誤");
        changes[key] = body[key].trim() || null;
      }
      if (!changes.full_name || !changes.employee_code)
        throw new WorkspaceError(400, "姓名及員工編號不可空白");
      changes.employee_code = changes.employee_code.toUpperCase();
      const { data, error } = await ctx.admin
        .from("profiles")
        .select("id")
        .eq("employee_code", changes.employee_code)
        .neq("id", target)
        .limit(1);
      if (error) throw error;
      if (data?.length)
        throw new WorkspaceError(409, "員工編號已被其他使用者使用");
    } else throw new WorkspaceError(400, "未知操作");
    const { data, error } = await ctx.admin
      .from("profiles")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", target)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new WorkspaceError(404, "找不到使用者資料");
    return respond({ success: true, message: "已更新使用者" });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const ctx = await access(),
      body = await request.json();
    // M5 Q12：新增使用者改回連到公開註冊頁，由本人自己註冊；管理員直接建立帳號的功能已移除。
    if (body.action === "create")
      throw new WorkspaceError(
        400,
        "新增使用者請由本人使用公開註冊頁自行註冊，管理員無法代為建立帳號",
      );
    if (
      typeof body.password !== "string" ||
      body.password.length < 6 ||
      body.password.length > 128
    )
      throw new WorkspaceError(400, "密碼需為 6 至 128 個字元");
    if (body.action === "reset") {
      const { data: actor, error } = await ctx.admin
        .from("profiles")
        .select("role")
        .eq("id", ctx.user.id)
        .single();
      if (error) throw error;
      if (actor?.role !== "admin")
        throw new WorkspaceError(403, "只有管理員可以重置密碼");
      const { error: resetError } = await ctx.admin.auth.admin.updateUserById(
        id(body.id),
        { password: body.password },
      );
      if (resetError) throw new WorkspaceError(400, resetError.message);
      return respond({
        success: true,
        message: "密碼已重置，請妥善保存新密碼",
      });
    }
    throw new WorkspaceError(400, "未知操作");
  } catch (e) {
    return failed(e);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    checkOrigin(request);
    const ctx = await access();
    await permission(ctx.user.id, "user.user.delete");
    const target = id(request.nextUrl.searchParams.get("id"));
    const result = await deleteUser(target);
    if (!result.success)
      throw new WorkspaceError(400, result.error || "刪除失敗");
    return respond(result);
  } catch (e) {
    return failed(e);
  }
}
