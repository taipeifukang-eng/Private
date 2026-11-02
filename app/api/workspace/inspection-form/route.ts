import { createHash } from "crypto";
import {
  checked,
  checkOrigin,
  context,
  failed,
  respond,
  requireCapability,
  uuid,
  WorkspaceError,
  type Context,
} from "@/lib/workspace/server";
import { scoreInspection } from "@/lib/workspace/inspection-scoring";
export const dynamic = "force-dynamic";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function editable(ctx: Context, id: string | null, type: string) {
  if (!["supervisor", "manager"].includes(type))
    throw new WorkspaceError(400, "巡店類型不正確");
  if (type === "manager") requireCapability(ctx, ["inspection.manager_tab"]);
  if (!id) {
    requireCapability(ctx, ["inspection.create"]);
    return null;
  }
  if (!uuid(id)) throw new WorkspaceError(400, "巡店識別不正確");
  const r = checked(
    await ctx.auth
      .from("inspection_masters")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!r || r.inspector_id !== ctx.user.id)
    throw new WorkspaceError(403, "只有巡店建立者可以編輯");
  if (!["draft", "in_progress"].includes(r.status))
    throw new WorkspaceError(409, "已完成或已結案的巡店不能編輯");
  if ((r.inspection_type || "supervisor") !== type)
    throw new WorkspaceError(400, "不能變更既有巡店類型");
  return r;
}
async function templatesFor(ctx: Context, id: string | null) {
  const before = checked(
    await ctx.admin
      .from("workspace_inspection_settings_revision")
      .select("version")
      .eq("singleton", true)
      .single(),
  );
  if (!before) throw new WorkspaceError(409, "巡店設定尚未就緒");
  const results = id
    ? checked(
        await ctx.auth
          .from("inspection_results")
          .select("*")
          .eq("inspection_id", id),
      ) || []
    : [];
  const ids = results.map((r) => r.template_id);
  let q = ctx.auth
    .from("inspection_templates")
    .select("*")
    .order("section_order")
    .order("item_order")
    .order("id");
  q = ids.length
    ? q.or(`is_active.eq.true,id.in.(${ids.join(",")})`)
    : q.eq("is_active", true);
  const templates = checked(await q) || [];
  const grades =
    checked(
      await ctx.admin
        .from("inspection_grade_mapping")
        .select("grade,min_score")
        .order("grade", { ascending: false }),
    ) || [];
  if (grades.length !== 11)
    throw new WorkspaceError(409, "評級設定不完整，請聯絡管理員");
  const after = checked(
    await ctx.admin
      .from("workspace_inspection_settings_revision")
      .select("version")
      .eq("singleton", true)
      .single(),
  );
  if (!after || before.version !== after.version)
    throw new WorkspaceError(
      409,
      "巡店設定正在更新，請稍後重試；本頁草稿仍保留",
    );
  return {
    settingsVersion: after.version,
    templates,
    grades,
    results,
    templateHash: hash({
      grades,
      templates: templates.map((t) => ({
        id: t.id,
        max_score: t.max_score,
        checklist_items: t.checklist_items,
        updated_at: t.updated_at,
      })),
    }),
  };
}
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      p = new URL(request.url).searchParams,
      id = p.get("id"),
      type = p.get("type") || "supervisor";
    const record = await editable(ctx, id, type);
    const stores =
      checked(
        await ctx.auth
          .from("stores")
          .select("id,store_name,store_code")
          .order("store_code"),
      ) || [];
    const store = p.get("store") || record?.store_id;
    if (store && !stores.some((s) => s.id === store))
      throw new WorkspaceError(403, "沒有此門市權限");
    const data = await templatesFor(ctx, id);
    const staff = id
      ? checked(
          await ctx.auth
            .from("inspection_on_duty_staff")
            .select(
              "employee_code,employee_name,position,is_duty_supervisor,is_manually_added",
            )
            .eq("inspection_id", id),
        ) || []
      : [];
    let roster: any[] = [];
    if (store) {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      const [y, m] = today.split("-").map(Number);
      const previous = new Date(Date.UTC(y, m - 2, 1))
        .toISOString()
        .slice(0, 7);
      roster =
        checked(
          await ctx.auth
            .from("monthly_staff_status")
            .select("employee_code,employee_name,position")
            .eq("store_id", store)
            .eq("year_month", previous)
            .not(
              "monthly_status",
              "in",
              "(resigned,leave_of_absence,transferred_out)",
            )
            .order("position"),
        ) || [];
    }
    return respond({ ...data, record, stores, staff, roster });
  } catch (e) {
    return failed(e);
  }
}
function imageValue(value: unknown) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    value.length > 1500000 ||
    !/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/.test(
      value,
    )
  )
    throw new WorkspaceError(400, "照片或簽名格式不正確，請重新選擇");
  return value;
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const raw = await request.text();
    if (raw.length > 25000000)
      throw new WorkspaceError(413, "照片總容量過大，請縮小後重試");
    const body = JSON.parse(raw);
    if (!uuid(body.writeId)) throw new WorkspaceError(400, "儲存識別不正確");
    // Permit a completed write to be replayed after a lost response, but never modified.
    const prior = checked(
      await ctx.admin
        .from("inspection_masters")
        .select("id,inspector_id,workspace_write_hash,workspace_write_id")
        .eq("workspace_write_id", body.writeId)
        .maybeSingle(),
    );
    const requestHash = hash(body);
    if (prior) {
      if (
        prior.inspector_id !== ctx.user.id ||
        prior.workspace_write_hash !== requestHash
      )
        throw new WorkspaceError(409, "重送內容與已儲存版本不同");
      return respond({
        record: checked(
          await ctx.auth
            .from("inspection_masters")
            .select("*")
            .eq("id", prior.id)
            .single(),
        ),
        replayed: true,
      });
    }
    const record = await editable(ctx, body.id || null, body.type);
    const store = checked(
      await ctx.auth
        .from("stores")
        .select("id")
        .eq("id", body.store)
        .maybeSingle(),
    );
    if (!store) throw new WorkspaceError(403, "沒有此門市權限");
    if (!["draft", "completed"].includes(body.status))
      throw new WorkspaceError(400, "儲存狀態不正確");
    if (
      !/^20\d{2}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(Date.parse(body.date)) ||
      new Date(body.date).toISOString().slice(0, 10) !== body.date
    )
      throw new WorkspaceError(400, "巡店日期不正確");
    if (
      typeof body.temperature !== "number" ||
      !Number.isFinite(body.temperature) ||
      Math.abs(body.temperature) > 99.9
    )
      throw new WorkspaceError(400, "請輸入有效室內溫度");
    if (typeof body.notes !== "string" || body.notes.length > 8000)
      throw new WorkspaceError(400, "巡店備註最多 8000 字");
    const { templates, templateHash, grades, settingsVersion } =
      await templatesFor(ctx, body.id || null);
    if (!templates.length)
      throw new WorkspaceError(409, "目前沒有可用的巡店範本");
    if (templateHash !== body.templateHash)
      throw new WorkspaceError(409, "巡店範本已更新，請保留草稿並重新載入");
    if (!Array.isArray(body.scores))
      throw new WorkspaceError(400, "評分資料不正確");
    for (const score of body.scores) {
      if (
        typeof score.notes !== "string" ||
        score.notes.length > 4000 ||
        !Array.isArray(score.photos) ||
        score.photos.length > 5
      )
        throw new WorkspaceError(400, "檢查備註或照片數量不正確");
      score.photos.forEach(imageValue);
    }
    let computed;
    try {
      computed = scoreInspection(templates, body.scores, grades);
    } catch (e) {
      throw new WorkspaceError(400, (e as Error).message);
    }
    if (!Array.isArray(body.staff) || body.staff.length > 150)
      throw new WorkspaceError(400, "當班人員格式不正確");
    const staff = body.staff.map((s: any) => {
      if (
        typeof s.employee_name !== "string" ||
        !s.employee_name.trim() ||
        s.employee_name.length > 100 ||
        typeof s.employee_code !== "string" ||
        s.employee_code.length > 20 ||
        typeof s.position !== "string" ||
        s.position.length > 50
      )
        throw new WorkspaceError(400, "當班人員姓名、員編或職位不正確");
      return {
        employee_name: s.employee_name.trim(),
        employee_code: s.employee_code || null,
        position: s.position || null,
        is_duty_supervisor: s.is_duty_supervisor === true,
        is_manually_added: s.is_manually_added === true,
      };
    });
    let gps: any = {};
    let date = body.date;
    if (body.gps) {
      const g = body.gps;
      if (
        !Number.isFinite(g.latitude) ||
        Math.abs(g.latitude) > 90 ||
        !Number.isFinite(g.longitude) ||
        Math.abs(g.longitude) > 180 ||
        !Number.isFinite(g.accuracy) ||
        g.accuracy < 0 ||
        !Number.isFinite(Date.parse(g.capturedAt))
      )
        throw new WorkspaceError(400, "定位資料不正確");
      gps = {
        gps_latitude: g.latitude,
        gps_longitude: g.longitude,
        gps_accuracy: g.accuracy,
        gps_timestamp: g.capturedAt,
      };
      date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(g.capturedAt));
    }
    const master = {
      store_id: body.store,
      inspection_date: date,
      inspection_type: body.type,
      status: body.status,
      total_score: computed.total,
      grade: computed.grade,
      score_percentage: Math.round((computed.total / 220) * 10000) / 100,
      indoor_temperature: body.temperature,
      supervisor_notes: body.notes,
      signature_photo_url: imageValue(body.signature),
      supervisor_signature_url: imageValue(body.supervisorSignature),
      ...gps,
    };
    const result = await ctx.admin.rpc("workspace_save_inspection", {
      p_actor: ctx.user.id,
      p_id: record?.id || null,
      p_version: body.version || 0,
      p_write: body.writeId,
      p_hash: requestHash,
      p_master: { ...master, settings_version: settingsVersion },
      p_results: computed.results,
      p_staff: staff,
    });
    if (result.error) {
      const m = result.error.message;
      if (m.includes("SETTINGS_CONFLICT"))
        throw new WorkspaceError(
          409,
          "送出期間巡店設定已變更，資料尚未儲存，請保留草稿並重新開啟核對",
        );
      if (m.includes("DUPLICATE_DAY"))
        throw new WorkspaceError(
          409,
          "你在此門市同一天已有同類巡店，請開啟既有紀錄",
        );
      if (m.includes("WRITE_CONFLICT"))
        throw new WorkspaceError(409, "紀錄已變更或完成，請保留草稿並重新載入");
      if (m.includes("NOT_OWNER"))
        throw new WorkspaceError(403, "只有巡店建立者可以編輯");
      throw new WorkspaceError(
        503,
        "巡店儲存未完成，資料未部分寫入，請稍後重試",
      );
    }
    return respond({ record: result.data });
  } catch (e) {
    return failed(e);
  }
}
