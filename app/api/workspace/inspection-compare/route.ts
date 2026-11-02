import {
  checked,
  context,
  failed,
  inspectionScope,
  inspectionStores,
  requireCapability,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCapability(ctx, ["inspection.compare"]);
    requireCapability(ctx, ["inspection.manager_tab"]);
    const scope = await inspectionScope(ctx);
    const p = new URL(request.url).searchParams;
    const store = p.get("store"),
      supervisor = p.get("supervisor"),
      manager = p.get("manager");
    const stores = await inspectionStores(ctx);
    if (!store)
      return respond({ stores, supervisorRecords: [], managerRecords: [] });
    if (!uuid(store) || !stores.some((s) => s.id === store))
      throw new WorkspaceError(404, "找不到可查看的門市");
    const base = () => {
      let q = ctx.admin
        .from("inspection_masters")
        .select(
          "id,store_id,inspector_id,inspection_date,inspection_type,status,total_score,max_possible_score,grade,supervisor_notes",
        )
        .eq("store_id", store)
        .eq("status", "completed");
      if (!scope.all && !scope.assigned.includes(store))
        q = q.eq("inspector_id", ctx.user.id);
      return q;
    };
    if (!supervisor && !manager) {
      const [sup, mgr] = await Promise.all([
        base()
          .or("inspection_type.eq.supervisor,inspection_type.is.null")
          .order("inspection_date", { ascending: false })
          .order("id")
          .limit(20),
        base()
          .eq("inspection_type", "manager")
          .order("inspection_date", { ascending: false })
          .order("id")
          .limit(20),
      ]);
      const supervisorRecords = checked(sup) || [],
        managerRecords = checked(mgr) || [];
      const ids = Array.from(
        new Set(
          [...supervisorRecords, ...managerRecords].map((r) => r.inspector_id),
        ),
      );
      const people = ids.length
        ? checked(
            await ctx.admin
              .from("profiles")
              .select("id,full_name")
              .in("id", ids),
          ) || []
        : [];
      const names = (rows: any[]) =>
        rows.map((r) => ({
          ...r,
          inspector_name:
            people.find((p) => p.id === r.inspector_id)?.full_name || "未知",
        }));
      return respond({
        stores,
        supervisorRecords: names(supervisorRecords),
        managerRecords: names(managerRecords),
      });
    }
    if (!uuid(supervisor) || !uuid(manager) || supervisor === manager)
      throw new WorkspaceError(400, "請選擇督導與經理巡店紀錄");
    const records = checked(await base().in("id", [supervisor, manager])) || [];
    const sup = records.find(
      (r) =>
        r.id === supervisor &&
        (!r.inspection_type || r.inspection_type === "supervisor"),
    );
    const mgr = records.find(
      (r) => r.id === manager && r.inspection_type === "manager",
    );
    if (!sup || !mgr)
      throw new WorkspaceError(404, "紀錄不存在、未完成，或不在可查看範圍內");
    const results =
      checked(
        await ctx.admin
          .from("inspection_results")
          .select(
            "inspection_id,template_id,max_score,given_score,deduction_amount,notes,photo_urls,selected_items,workspace_quantities",
          )
          .in("inspection_id", [supervisor, manager]),
      ) || [];
    const ids = Array.from(new Set(results.map((r) => r.template_id)));
    const templates = ids.length
      ? checked(
          await ctx.admin
            .from("inspection_templates")
            .select(
              "id,section,section_name,section_order,item_name,item_description,item_order",
            )
            .in("id", ids)
            .order("section_order")
            .order("item_order"),
        ) || []
      : [];
    const items = ids
      .map((id) => {
        const a = results.find(
          (r) => r.template_id === id && r.inspection_id === supervisor,
        );
        const b = results.find(
          (r) => r.template_id === id && r.inspection_id === manager,
        );
        const status =
          !a || !b
            ? "missing"
            : Number(a.deduction_amount) === Number(b.deduction_amount)
              ? "same"
              : Number(a.deduction_amount) === 0
                ? "manager_only"
                : Number(b.deduction_amount) === 0
                  ? "supervisor_only"
                  : "both_different";
        return {
          template: templates.find((t) => t.id === id) || {
            id,
            section_name: "未分類",
            item_name: "歷史檢查項目",
            section_order: 999,
            item_order: 999,
          },
          supervisor: a || null,
          manager: b || null,
          status,
        };
      })
      .sort(
        (a, b) =>
          a.template.section_order - b.template.section_order ||
          a.template.item_order - b.template.item_order,
      );
    return respond({ supervisor: sup, manager: mgr, items });
  } catch (e) {
    return failed(e);
  }
}
