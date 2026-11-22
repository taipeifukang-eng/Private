import { NextRequest } from "next/server";
import { dispatch } from "@/lib/workspace/general-affairs/router";
import { runGa } from "@/lib/workspace/general-affairs/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// M7/M8 第 1 批（G01-G05）：總務共用基礎、分類、料件、型號與架型、適用料件對照、附件、選擇器。
// 全部以使用者登入身分呼叫（RLS 與資料庫函式決定能不能做）；舊版 /api/general-affairs 不受影響。
type Ctx = { params: { path?: string[] } };
const handle = (request: NextRequest, { params }: Ctx) => runGa(request, params.path || [], (ctx, req, segs) => dispatch(ctx, req, segs));
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
