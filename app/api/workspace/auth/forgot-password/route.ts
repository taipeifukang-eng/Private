import {
  assertWorkspace,
  checkOrigin,
  failed,
  respond,
  sessionClient,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  FORGOT_PASSWORD_NOTICE,
  isValidEmail,
  mailMockActive,
  resetRedirectUrl,
} from "@/lib/workspace/auth-public";

// M5 W22：忘記密碼一律回同一句「若此信箱已註冊會收到重設信」，不透露帳號是否存在。
// 缺網站網址設定時直接報錯（舊版會退回 localhost 連結，寄出的信打不開）。信件測試依 D17 mock。
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    assertWorkspace();
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!isValidEmail(email)) throw new WorkspaceError(400, "請輸入有效的電子郵件");
    if (!mailMockActive(process.env.WORKSPACE_AUTH_MAIL_MOCK, email)) {
      let redirectTo: string;
      try {
        redirectTo = resetRedirectUrl(process.env.NEXT_PUBLIC_SITE_URL);
      } catch {
        throw new WorkspaceError(503, "系統尚未設定網站網址，暫時無法寄送重設信，請聯絡管理員");
      }
      const { error } = await sessionClient().auth.resetPasswordForEmail(email, { redirectTo });
      // 只有「寄太頻繁」會明講（與信箱是否存在無關）；其他失敗一律當作成功回覆，避免被拿來探測帳號。
      if (error && /rate limit|too many|security purposes/i.test(error.message))
        throw new WorkspaceError(429, "操作太頻繁，請稍後再試");
    }
    return respond({ success: true, message: FORGOT_PASSWORD_NOTICE });
  } catch (error) {
    return failed(error);
  }
}
