import { checked, context, failed, respond } from "@/lib/workspace/server";
import {
  improvementAccess,
  improvementToday,
} from "@/lib/workspace/improvements";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const ctx = await context(),
      access = await improvementAccess(ctx);
    const own: string[] = [];
    if (!access.all)
      for (let start = 0; ; start += 500) {
        const rows =
          checked(
            await ctx.admin
              .from("inspection_masters")
              .select("id")
              .eq("inspector_id", ctx.user.id)
              .order("id")
              .range(start, start + 499),
          ) || [];
        own.push(...rows.map((r) => r.id));
        if (rows.length < 500) break;
      }
    const rows: any[] = [];
    const select =
      "id,inspection_id,store_id,section_name,item_name,deduction_amount,selected_items,status,deadline,days_taken,bonus_score,improved_at,created_at";
    const fetchRows = async (column?: string, ids?: string[]) => {
      for (let start = 0; ; start += 500) {
        let query = ctx.admin
          .from("inspection_improvements")
          .select(select)
          .order("deadline")
          .order("id")
          .range(start, start + 499);
        if (column && ids) query = query.in(column, ids);
        const batch = checked(await query) || [];
        rows.push(...batch);
        if (batch.length < 500) break;
      }
    };
    if (access.all) await fetchRows();
    else {
      for (let i = 0; i < own.length; i += 200)
        await fetchRows("inspection_id", own.slice(i, i + 200));
      for (let i = 0; i < access.stores.length; i += 200)
        await fetchRows("store_id", access.stores.slice(i, i + 200));
    }
    const unique = Array.from(new Map(rows.map((r) => [r.id, r])).values());
    const stores: any[] = [],
      masters: any[] = [],
      people: any[] = [];
    for (const [table, fields, ids, target] of [
      [
        "stores",
        "id,store_name,store_code",
        Array.from(new Set(unique.map((r) => r.store_id))),
        stores,
      ],
      [
        "inspection_masters",
        "id,inspection_date,inspector_id",
        Array.from(new Set(unique.map((r) => r.inspection_id))),
        masters,
      ],
    ] as const) {
      for (let i = 0; i < ids.length; i += 200)
        target.push(
          ...(checked(
            await ctx.admin
              .from(table)
              .select(fields)
              .in("id", ids.slice(i, i + 200)),
          ) || []),
        );
    }
    const ids = Array.from(new Set(masters.map((r) => r.inspector_id)));
    for (let i = 0; i < ids.length; i += 200)
      people.push(
        ...(checked(
          await ctx.admin
            .from("profiles")
            .select("id,full_name")
            .in("id", ids.slice(i, i + 200)),
        ) || []),
      );
    return respond({
      stores,
      records: unique
        .map((row) => {
          const master = masters.find((r) => r.id === row.inspection_id);
          return {
            ...row,
            status:
              row.status === "pending" && row.deadline < improvementToday()
                ? "overdue"
                : row.status,
            store: stores.find((s) => s.id === row.store_id),
            inspection_date: master?.inspection_date,
            inspector_name:
              people.find((p) => p.id === master?.inspector_id)?.full_name ||
              "未知",
          };
        })
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    });
  } catch (e) {
    return failed(e);
  }
}
