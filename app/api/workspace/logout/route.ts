import {
  checkOrigin,
  failed,
  respond,
  sessionClient,
  WorkspaceError,
} from "@/lib/workspace/server";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { error } = await sessionClient().auth.signOut({ scope: "local" });
    if (error) throw new WorkspaceError(503, "登出失敗，請重試");
    return respond({ success: true });
  } catch (error) {
    return failed(error);
  }
}
