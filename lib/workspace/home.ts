// M3 W11 登入首頁聚合（GET /api/workspace/home）。讀取規則對等舊版 app/page.tsx，一律以 service role 讀取。
// 與舊版不同之處（皆已核可）：Q12 獎金月份標註月結狀態、Q13 督導只數可確認的調店、Q14 我的任務未完成優先。
import { checked, type Context } from "./server";
import { deriveMonthState } from "./monthly-status-rules";
import { myTaskRows } from "./task-list";
import {
  annualFeeReminder, applyBonusConfirmation, BONUS_SELECT, countConfirmable, homeFlags, isStillActive, licenseReminder,
  monthBirthdays, onboardingList, pickHomeTasks, summarizeBonus, taipeiDate, transferPendingScope,
  type AnnualFeeRecord, type BirthdayRow, type OnboardingRow,
} from "./home-rules";

const PAGE = 500;
/** 分頁讀完（舊版沒分頁，超過 1000 列會被截斷；資料量小時結果相同）。order 用於穩定分頁。 */
async function all<T = any>(build: () => any, order: string[] = ["id"]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = build();
    for (const o of order) q = q.order(o);
    const rows = checked(await q.range(from, from + PAGE - 1)) as T[] | null;
    out.push(...(rows || []));
    if (!rows || rows.length < PAGE) return out;
  }
}
const chunks = <T,>(list: T[], n = 100) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export async function loadHome(ctx: Context, now: Date = new Date()) {
  const db = ctx.admin;
  const today = taipeiDate(now);
  const profile = checked(
    await db.from("profiles").select("full_name,role,job_title,employee_code").eq("id", ctx.user.id).maybeSingle(),
  ) as any;
  const flags = homeFlags({ role: profile?.role, jobTitle: profile?.job_title });
  const employeeCode = String(profile?.employee_code || "").toUpperCase();

  // 管轄門市（任何任命）：新人入職、督導／店長壽星、提醒範圍
  const managedRows = await all<{ store_id: string; role_type: string | null }>(
    () => db.from("store_managers").select("store_id,role_type").eq("user_id", ctx.user.id),
  );
  const managedStoreIds = Array.from(new Set(managedRows.map((r) => String(r.store_id || "")).filter(Boolean)));

  const [tasks, bonus, onboarding, birthdays, reminders, transfer] = await Promise.all([
    loadTasks(ctx),
    loadBonus(ctx, employeeCode),
    loadOnboarding(ctx, managedStoreIds, today),
    loadBirthdays(ctx, flags, managedStoreIds, today),
    loadReminders(ctx, flags, managedStoreIds, today),
    loadTransfer(ctx, flags.isAdmin),
  ]);

  return {
    name: profile?.full_name || ctx.user.email || "使用者",
    yearMonth: today.yearMonth,
    month: today.month,
    employeeCode,
    flags: { isAdmin: flags.isAdmin, licenseGroupByZone: flags.licenseGroupByZone },
    transfer,
    bonus,
    onboarding,
    tasks,
    birthdays,
    annualFee: reminders.annualFee,
    license: reminders.license,
    refreshedAt: now.toISOString(),
  };
}

async function loadTasks(ctx: Context) {
  const rows = await myTaskRows(ctx);
  const mine = pickHomeTasks(rows as any[], ctx.user.id);
  return {
    rows: mine.map((r: any) => ({
      id: r.id,
      title: r.template?.title || "未知專案",
      status: r.status as string,
      percent: r.percent as number,
      created_at: r.created_at as string,
    })),
  };
}

async function loadBonus(ctx: Context, employeeCode: string) {
  const visible = ctx.has("home.bonus_detail.view_own");
  if (!visible) return { visible: false, months: [] as any[] };
  if (!employeeCode) return { visible, months: [] as any[] };
  const db = ctx.admin;
  // 舊版取最近 120 列後分月加總
  const rows = checked(
    await db.from("monthly_bonus_records").select(BONUS_SELECT).eq("employee_code", employeeCode).order("year_month", { ascending: false }).limit(120),
  ) as any[];
  let months = summarizeBonus(rows || []);
  if (months.length) {
    // Q12：該月月結狀態。門市月狀態由人員列推導（deriveMonthState），沒有人員列時退回 monthly_store_summary.store_status。
    const yms = months.map((m) => m.yearMonth),
      storeIds = Array.from(new Set(months.flatMap((m) => m.storeIds)));
    const staff = await all<{ year_month: string; store_id: string; status: string | null }>(
      () => db.from("monthly_staff_status").select("year_month,store_id,status").in("year_month", yms).in("store_id", storeIds),
    );
    const summary = await all<{ year_month: string; store_id: string; store_status: string | null }>(
      () => db.from("monthly_store_summary").select("year_month,store_id,store_status").in("year_month", yms).in("store_id", storeIds),
    );
    const key = (ym: string, s: string) => `${ym}::${s}`;
    const grouped = new Map<string, { status: string | null }[]>();
    for (const r of staff) grouped.set(key(r.year_month, r.store_id), [...(grouped.get(key(r.year_month, r.store_id)) || []), r]);
    const summaryOf = new Map(summary.map((r) => [key(r.year_month, r.store_id), r.store_status]));
    months = applyBonusConfirmation(months, (ym, s) => {
      const derived = deriveMonthState(grouped.get(key(ym, s)) || []);
      return (derived ?? (summaryOf.get(key(ym, s)) === "confirmed" ? "confirmed" : null)) === "confirmed";
    });
  }
  return {
    visible,
    months: months.map((m) => ({ yearMonth: m.yearMonth, total: m.total, otherNote: m.otherNote, confirmed: m.confirmed, items: m.items })),
  };
}

async function loadOnboarding(ctx: Context, storeIds: string[], today: ReturnType<typeof taipeiDate>) {
  if (!storeIds.length) return { rows: [] as OnboardingRow[] };
  const rows = await all<any>(
    () =>
      ctx.admin
        .from("employee_movement_history")
        .select("employee_code,employee_name,movement_date,store_id,onboarding_is_pharmacist,stores(store_code,store_name)")
        .eq("movement_type", "onboarding")
        .in("store_id", storeIds)
        .gte("movement_date", `${today.yearMonth}-01`)
        .lte("movement_date", today.monthEnd),
    ["movement_date", "id"],
  );
  return {
    rows: onboardingList(
      rows.map((r) => ({
        employee_code: String(r.employee_code || ""),
        employee_name: String(r.employee_name || ""),
        movement_date: String(r.movement_date || ""),
        store_id: r.store_id ? String(r.store_id) : null,
        store_code: r.stores?.store_code ? String(r.stores.store_code) : null,
        store_name: r.stores?.store_name ? String(r.stores.store_name) : null,
        onboarding_is_pharmacist: r.onboarding_is_pharmacist ?? null,
      })),
    ),
  };
}

async function loadBirthdays(ctx: Context, flags: ReturnType<typeof homeFlags>, managedStoreIds: string[], today: ReturnType<typeof taipeiDate>) {
  if (!flags.canViewBirthdays) return { visible: false, rows: [] as BirthdayRow[] };
  let rows: BirthdayRow[] = [];
  const base = () => ctx.admin.from("store_employees").select("employee_code,employee_name,birthday").eq("is_active", true).not("birthday", "is", null);
  if (flags.isManagerOrAdmin) rows = await all<BirthdayRow>(base);
  else if (managedStoreIds.length) {
    for (const part of chunks(managedStoreIds)) rows.push(...(await all<BirthdayRow>(() => base().in("store_id", part))));
  }
  return { visible: true, rows: monthBirthdays(rows, today.month) };
}

async function loadReminders(ctx: Context, flags: ReturnType<typeof homeFlags>, managedStoreIds: string[], today: ReturnType<typeof taipeiDate>) {
  const empty = { annualFee: { visible: flags.canViewAnnualFee, rows: [] as any[] }, license: { visible: flags.canViewLicense, rows: [] as any[] } };
  if (!flags.canViewAnnualFee && !flags.canViewLicense) return empty;
  const db = ctx.admin;
  const scope = flags.reminderScopeAll ? null : new Set(managedStoreIds);
  const snapshotCols = "employee_code,employee_name,store_id,year_month,is_active,stores(store_name)";
  // 藥師母體：本月名冊快照，沒有就退回最近一期
  let snap = await all<any>(() => db.from("pharmacist_monthly_snapshot").select(snapshotCols).eq("year_month", today.yearMonth));
  if (!snap.length) {
    const latest = checked(
      await db.from("pharmacist_monthly_snapshot").select("year_month").lte("year_month", today.yearMonth).order("year_month", { ascending: false }).limit(1).maybeSingle(),
    ) as any;
    if (latest?.year_month) snap = await all<any>(() => db.from("pharmacist_monthly_snapshot").select(snapshotCols).eq("year_month", latest.year_month));
  }
  const byCode = new Map<string, { name: string; storeId: string; storeName: string | null; active: boolean }>();
  for (const r of snap) {
    const code = String(r.employee_code || "").toUpperCase();
    if (!code || byCode.has(code)) continue;
    byCode.set(code, { name: String(r.employee_name || ""), storeId: String(r.store_id || ""), storeName: r.stores?.store_name ? String(r.stores.store_name) : null, active: r.is_active !== false });
  }
  const activeCodes = Array.from(byCode.entries()).filter(([, v]) => v.active).map(([c]) => c);
  // 以異動紀錄覆蓋在職判斷（離職 >= 復職/到職）
  const resign = new Map<string, string>(), react = new Map<string, string>();
  for (const part of chunks(activeCodes)) {
    const moves = await all<any>(
      () => db.from("employee_movement_history").select("employee_code,movement_type,movement_date").in("employee_code", part).in("movement_type", ["resignation", "onboarding", "return_to_work"]),
      ["movement_date", "id"],
    );
    moves.sort((a, b) => String(b.movement_date).localeCompare(String(a.movement_date)));
    for (const m of moves) {
      const code = String(m.employee_code || "").toUpperCase(), date = String(m.movement_date || "");
      if (!code || !date) continue;
      if (m.movement_type === "resignation" && !resign.has(code)) resign.set(code, date);
      if ((m.movement_type === "onboarding" || m.movement_type === "return_to_work") && !react.has(code)) react.set(code, date);
    }
  }
  const candidates = activeCodes.filter((c) => isStillActive(resign.get(c), react.get(c))).filter((c) => !scope || (!!byCode.get(c)!.storeId && scope.has(byCode.get(c)!.storeId)));
  // 補查缺少的門市名稱
  const missing = Array.from(new Set(candidates.map((c) => byCode.get(c)!).filter((v) => v.storeId && !v.storeName).map((v) => v.storeId)));
  const names = new Map<string, string>();
  for (const part of chunks(missing)) for (const s of checked(await db.from("stores").select("id,store_name").in("id", part)) as any[]) names.set(String(s.id), String(s.store_name || ""));
  const info = (code: string) => {
    const v = byCode.get(code)!;
    return { employee_code: code, employee_name: v.name, store_id: v.storeId, store_name: v.storeName || (v.storeId ? names.get(v.storeId) || null : null) };
  };
  if (!candidates.length) return empty;

  const annualRows: any[] = [];
  if (flags.canViewAnnualFee) {
    const fees: any[] = [];
    for (const part of chunks(candidates)) fees.push(...(await all<any>(() => db.from("pharmacist_annual_fees").select("employee_code,association_city,fee_year,fee_period_end,created_at").in("employee_code", part), ["created_at", "id"])));
    fees.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const feeBy = new Map<string, AnnualFeeRecord[]>();
    for (const f of fees) {
      const code = String(f.employee_code || "").toUpperCase();
      if (code) feeBy.set(code, [...(feeBy.get(code) || []), f]);
    }
    for (const code of candidates) {
      const r = annualFeeReminder(feeBy.get(code) || [], today);
      if (r) annualRows.push({ ...info(code), association_city: r.city, reason: r.reason });
    }
    annualRows.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  }

  const licenseRows: any[] = [];
  if (flags.canViewLicense) {
    // 督導區：每間門市取主責督導（沒有主責取全部），依建立時間、員編挑第一位
    const zone = new Map<string, string>();
    if (flags.licenseGroupByZone) {
      const assign = await all<any>(() => db.from("store_managers").select("store_id,user_id,is_primary,role_type,created_at").eq("role_type", "supervisor"));
      const userIds = Array.from(new Set(assign.map((r) => String(r.user_id || "")).filter(Boolean)));
      const profiles = new Map<string, any>();
      for (const part of chunks(userIds)) for (const p of checked(await db.from("profiles").select("id,full_name,employee_code,job_title").in("id", part)) as any[]) profiles.set(String(p.id), p);
      const byStore = new Map<string, any[]>();
      for (const r of assign) {
        if (!profiles.get(String(r.user_id || ""))?.job_title?.includes("督導")) continue;
        const sid = String(r.store_id || "");
        if (sid) byStore.set(sid, [...(byStore.get(sid) || []), r]);
      }
      byStore.forEach((list, storeId) => {
        const primary = list.filter((r) => r.is_primary === true);
        const pool = primary.length ? primary : list;
        const picked = [...pool].sort((a, b) => {
          const at = Date.parse(a.created_at || "1970-01-01T00:00:00Z"), bt = Date.parse(b.created_at || "1970-01-01T00:00:00Z");
          if (at !== bt) return at - bt;
          return (profiles.get(String(a.user_id))?.employee_code || "").localeCompare(profiles.get(String(b.user_id))?.employee_code || "");
        })[0];
        const u = profiles.get(String(picked?.user_id || ""));
        zone.set(storeId, u?.full_name ? `${u.full_name}${u.employee_code ? ` (${u.employee_code})` : ""}` : "未指派督導區");
      });
    }
    const profs: any[] = [];
    for (const part of chunks(candidates)) profs.push(...(checked(await db.from("pharmacist_profiles").select("employee_code,license_renewal_date").in("employee_code", part).not("license_renewal_date", "is", null)) as any[]));
    for (const p of profs) {
      const code = String(p.employee_code || "").toUpperCase();
      const r = code && byCode.has(code) ? licenseReminder(p.license_renewal_date, today) : null;
      if (!r || !candidates.includes(code)) continue;
      const i = info(code);
      licenseRows.push({ ...i, license_renewal_date: r.date, supervisor_zone: zone.get(i.store_id) || "未指派督導區", reason: r.reason });
    }
    licenseRows.sort((a, b) => {
      if (flags.licenseGroupByZone && a.supervisor_zone !== b.supervisor_zone) return a.supervisor_zone.localeCompare(b.supervisor_zone, "zh-TW");
      return a.license_renewal_date !== b.license_renewal_date ? a.license_renewal_date.localeCompare(b.license_renewal_date) : a.employee_code.localeCompare(b.employee_code);
    });
  }
  return { annualFee: { visible: flags.canViewAnnualFee, rows: annualRows }, license: { visible: flags.canViewLicense, rows: licenseRows } };
}

/** C.3：待確認調店。卡片只給有確認權限者；督導只數自己現在可確認的。 */
async function loadTransfer(ctx: Context, isAdmin: boolean) {
  const db = ctx.admin;
  const canCreate = isAdmin || ctx.has("employee.store_transfer.create");
  const canConfirm = isAdmin || ctx.has("employee.store_transfer.confirm");
  const scope = transferPendingScope({ isAdmin, canCreate, canConfirm });
  if (scope === "none") return { show: false, pendingCount: 0, scope };
  if (scope === "all") {
    const { count, error } = await db.from("store_transfer_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (error) throw error;
    return { show: (count ?? 0) > 0, pendingCount: count ?? 0, scope };
  }
  const sup = await all<{ store_id: string }>(() => db.from("store_managers").select("store_id").eq("user_id", ctx.user.id).eq("role_type", "supervisor"));
  const supervised = new Set(sup.map((r) => String(r.store_id)));
  if (!supervised.size) return { show: false, pendingCount: 0, scope };
  const pending = await all<{ from_store_id: string; to_store_id: string }>(() => db.from("store_transfer_requests").select("from_store_id,to_store_id").eq("status", "pending"));
  const n = countConfirmable(pending, supervised);
  return { show: n > 0, pendingCount: n, scope };
}
