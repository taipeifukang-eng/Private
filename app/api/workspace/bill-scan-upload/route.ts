import { NextRequest } from "next/server";
import { publicScanStatus, publicScanUpload } from "@/lib/workspace/general-affairs/utility-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// 水電帳單手機掃 QR 上傳的公開路由（不需登入，只認 X-Scan-Token 權杖）。
// 只開放 GET（權杖狀態）與 POST（上傳）；沒有任何讀檔、列表、刪除功能；其餘方法 405。細節與安全規則見 lib/workspace/general-affairs/utility-scan.ts。
export const GET = (request: NextRequest) => publicScanStatus(request);
export const POST = (request: NextRequest) => publicScanUpload(request);
const notAllowed = () => Response.json({ error: "不支援的操作" }, { status: 405, headers: { Allow: "GET, POST" } });
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
