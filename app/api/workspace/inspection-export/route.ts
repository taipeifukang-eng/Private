import { NextRequest } from "next/server";
import { GET as exportScores } from "@/app/api/inspection/export-monthly-score/route";
import {
  context,
  failed,
  requireCapability,
  WorkspaceError,
} from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const ctx = await context();
    requireCapability(ctx, ["inspection.export"]);
    if (process.env.WORKSPACE_USE_EXISTING_SESSION !== "true")
      throw new WorkspaceError(503, "請使用原測試站工作台");
    if (
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(
        request.nextUrl.searchParams.get("month") || "",
      )
    )
      throw new WorkspaceError(400, "請選擇有效月份");
    return await exportScores(request);
  } catch (e) {
    return failed(e);
  }
}
