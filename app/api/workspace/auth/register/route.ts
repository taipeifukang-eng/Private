import { createClient } from "@supabase/supabase-js";
import {
  assertWorkspace,
  adminClient,
  checkOrigin,
  failed,
  respond,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  friendlyAuthError,
  mailMockActive,
  ONE_SHOT_CLIENT_OPTIONS,
  signUpReal,
  validateRegister,
} from "@/lib/workspace/auth-public";

// M5 W22 Q15：公開註冊保留。欄位與驗證照舊（姓名、信箱、密碼至少 6 字元），錯誤訊息中文化。
// 新註冊者不會被指派任何角色（本路由不寫 user_roles），登入後看到「帳號待管理員開通」。
// 此路由不需登入；以 Origin 檢查擋跨站送出。信件測試依 D17 mock（見 lib/workspace/auth-public.ts mailMockActive）。
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    assertWorkspace();
    const body = await request.json().catch(() => ({}));
    const input = {
      fullName: typeof body?.fullName === "string" ? body.fullName.trim() : "",
      email: typeof body?.email === "string" ? body.email.trim() : "",
      password: body?.password,
      confirmPassword: body?.confirmPassword,
    };
    const invalid = validateRegister(input);
    if (invalid) throw new WorkspaceError(400, invalid);
    let message: string | undefined;
    if (mailMockActive(process.env.WORKSPACE_AUTH_MAIL_MOCK, input.email)) {
      // 不寄驗證信：直接建立已驗證帳號（只限 example.test 且測試旗標開啟）。
      const { error } = await adminClient().auth.admin.createUser({
        email: input.email,
        password: input.password as string,
        email_confirm: true,
        user_metadata: { full_name: input.fullName },
      });
      message = error?.message;
    } else {
      // 不帶 cookie 的一次性 client：註冊本身不應順便登入。
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        ONE_SHOT_CLIENT_OPTIONS,
      );
      message = await signUpReal(anon, { fullName: input.fullName, email: input.email, password: input.password as string });
    }
    if (message) {
      const text = friendlyAuthError(message, "register");
      throw new WorkspaceError(/已經註冊/.test(text) ? 409 : /太頻繁/.test(text) ? 429 : 400, text);
    }
    return respond({
      success: true,
      message:
        "註冊完成。若收到驗證信，請先完成信箱驗證再登入；帳號需由管理員開通角色後才能使用功能。",
    });
  } catch (error) {
    return failed(error);
  }
}
