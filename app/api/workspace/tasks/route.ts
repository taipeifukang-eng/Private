import { context, failed, respond, requireCapability } from "@/lib/workspace/server";
import { myTaskRows } from "@/lib/workspace/task-list";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const ctx = await context();
    requireCapability(ctx, ["task.view_own"]);
    return respond({ records: await myTaskRows(ctx) });
  } catch (e) {
    return failed(e);
  }
}
