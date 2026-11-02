import {
  checkOrigin,
  failed,
  respond,
  sessionClient,
  WorkspaceError,
} from "@/lib/workspace/server";
import { resolveLoginEmail } from '@/lib/auth/dev-login';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { email, password } = await request.json();
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 512
    )
      throw new WorkspaceError(400, "請輸入有效帳號與密碼");
    const { error } = await sessionClient().auth.signInWithPassword({
      email: resolveLoginEmail(email),
      password,
    });
    if (error)
      throw new WorkspaceError(401, "帳號或密碼不正確，或帳號暫時無法登入");
    return respond({ success: true });
  } catch (error) {
    return failed(error);
  }
}
