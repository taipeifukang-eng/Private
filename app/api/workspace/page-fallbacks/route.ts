import { NextRequest } from "next/server";
import { context, failed } from "@/lib/workspace/server";
import { listFallbacks, setFallback } from "@/lib/workspace/page-fallbacks";

// M9 F01S N2：系統管理員的逐頁「回舊版」開關。GET 清單、PUT 切換；非系統管理員一律 403。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await listFallbacks(await context({ profile: false }));
  } catch (e) {
    return failed(e);
  }
}
export async function PUT(request: NextRequest) {
  try {
    return await setFallback(await context({ profile: false }), request);
  } catch (e) {
    return failed(e);
  }
}
