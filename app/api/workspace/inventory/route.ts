import { NextRequest } from "next/server";
import * as original from "@/app/api/inventory/result-analysis/route";
import { checkOrigin, failed } from "@/lib/workspace/server";
import { moduleContext } from "@/lib/workspace/modules";
export const dynamic = "force-dynamic";
async function run(
  request: NextRequest,
  method: "GET" | "POST" | "PATCH" | "DELETE",
) {
  try {
    await moduleContext("inventory");
    if (method !== "GET") checkOrigin(request);
    return await original[method](request);
  } catch (e) {
    return failed(e);
  }
}
export const GET = (r: NextRequest) => run(r, "GET");
export const POST = (r: NextRequest) => run(r, "POST");
export const PATCH = (r: NextRequest) => run(r, "PATCH");
export const DELETE = (r: NextRequest) => run(r, "DELETE");
