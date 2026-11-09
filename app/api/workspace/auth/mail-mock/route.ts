import { NextResponse } from "next/server";

// D17：測試用探針。只有測試站（WORKSPACE_AUTH_MAIL_MOCK=true）才存在，讓 W22 測試確認信件 mock 已開啟再跑，避免對 DEV Supabase 真的寄信。
export const dynamic = "force-dynamic";
export async function GET() {
  if (process.env.WORKSPACE_AUTH_MAIL_MOCK !== "true") return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ active: true });
}
