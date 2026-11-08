import {
  assertWorkspace,
  checkOrigin,
  failed,
  respond,
  sessionClient,
  WorkspaceError,
} from "@/lib/workspace/server";
import { friendlyAuthError, validateNewPassword } from "@/lib/workspace/auth-public";

// M5 W22：重設密碼。重設信連結先經 /auth/callback 換成登入狀態（路徑不變），再由本頁設定新密碼。
// 與舊版相同：持有登入狀態即可設定新密碼；Q16 最短 6 字元。
export const dynamic = "force-dynamic";
/** 目前是否持有可重設密碼的登入狀態（不回傳任何帳號資料）。 */
export async function GET() {
  try {
    assertWorkspace();
    const {
      data: { user },
    } = await sessionClient().auth.getUser();
    return respond({ valid: !!user });
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await request.json().catch(() => ({}));
    const invalid = validateNewPassword(body?.password, body?.confirmPassword);
    if (invalid) throw new WorkspaceError(400, invalid);
    const client = sessionClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) throw new WorkspaceError(401, "重設連結已失效，請重新申請");
    const { error } = await client.auth.updateUser({ password: body.password });
    if (error) throw new WorkspaceError(400, friendlyAuthError(error.message, "reset"));
    return respond({ success: true, message: "密碼已成功重設，請用新密碼登入" });
  } catch (error) {
    return failed(error);
  }
}
