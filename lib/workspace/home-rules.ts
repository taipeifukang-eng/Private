// M3 W11 登入首頁的純規則（無 I/O，供 /api/workspace/home、Vue 首頁與測試共用）。
// 規則來源是舊版 app/page.tsx，凡與舊版不同之處都在註解標題號並登記於 tests/parity/allowlist.json。

export type HomeIdentity = { role: string | null | undefined; jobTitle: string | null | undefined };

/** 舊版以 profiles.role 與 job_title 決定提醒卡片的可見對象（Q11：照舊版，含缺口）。 */
export function homeFlags({ role, jobTitle }: HomeIdentity) {
  const title = jobTitle || "";
  const r = role || "";
  const isSupervisor = title.includes("督導");
  const isStoreManager = ["店長", "代理店長"].includes(title) && !isSupervisor;
  const isManagerOrAdmin = r === "admin" || (r === "manager" && !isSupervisor && !isStoreManager);
  const isBusinessAdminSupervisor = title.includes("營業部行政主管") || title.includes("營業部行政助理主管");
  return {
    isAdmin: r === "admin",
    isSupervisor,
    isStoreManager,
    isManagerOrAdmin,
    isBusinessAdminSupervisor,
    canViewBirthdays: isManagerOrAdmin || isSupervisor || isStoreManager,
    canViewAnnualFee: isManagerOrAdmin || isBusinessAdminSupervisor || isSupervisor || isStoreManager,
    canViewLicense: isManagerOrAdmin || isSupervisor || isBusinessAdminSupervisor,
    /** 提醒名單範圍：管理員、經理、營業部行政主管看全部，其餘只看自己有任命的門市。 */
    reminderScopeAll: isManagerOrAdmin || isBusinessAdminSupervisor,
    /** 執照提醒分督導區顯示（督導平列）。 */
    licenseGroupByZone: isManagerOrAdmin || isBusinessAdminSupervisor,
  };
}

// ---- 日期（一律用台北時間；舊版用伺服器本地時間，台北部署時相同）----
export type TaipeiDate = { year: number; month: number; day: number; ymd: string; yearMonth: string; monthEnd: string };
export function taipeiDate(now: Date = new Date()): TaipeiDate {
  const t = new Date(now.getTime() + 8 * 3600_000);
  const year = t.getUTCFullYear(),
    month = t.getUTCMonth() + 1,
    day = t.getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day, ymd: `${year}-${p(month)}-${p(day)}`, yearMonth: `${year}-${p(month)}`, monthEnd: `${year}-${p(month)}-${p(last)}` };
}
const validDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** 基隆規則：上一期結束日所在月份的第 1 天再加 4 個月（回傳 YYYY-MM-01）。 */
export function keelungReminderStart(periodEnd: string | null | undefined): string | null {
  const d = validDate(periodEnd);
  if (!d) return null;
  let year = Number(d.slice(0, 4)),
    month = Number(d.slice(5, 7)) + 4;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
/** 執照提醒：只看年份，到期年前兩年的 1/1 起提醒。 */
export function licenseReminderStart(renewalDate: string | null | undefined): string | null {
  const d = validDate(renewalDate);
  return d ? `${Number(d.slice(0, 4)) - 2}-01-01` : null;
}

export type AnnualFeeRecord = { association_city: string | null; fee_year: number | null; fee_period_end: string | null };
/**
 * 常年會費提醒（舊版規則）：records 需已依 created_at 新到舊排序。
 * 基隆市依上一期結束日；其他縣市 4 月起，當年度（西元或民國）沒有繳費紀錄才提醒。
 */
export function annualFeeReminder(records: AnnualFeeRecord[], today: TaipeiDate): { city: string; reason: string } | null {
  const rocYear = today.year - 1911;
  const city = records[0]?.association_city || "未設定";
  if (city === "基隆市") {
    const latestEnd = records.find((r) => r.fee_period_end)?.fee_period_end || null;
    const start = keelungReminderStart(latestEnd);
    const should = start ? today.ymd >= start : today.month >= 4;
    if (!should) return null;
    return {
      city,
      reason: latestEnd
        ? `基隆規則：上一期結束後第4個月起提醒（上一期至 ${latestEnd.slice(0, 10)}）`
        : "基隆規則：尚無上一期結束日，暫以 4 月起提醒",
    };
  }
  if (records.some((r) => r.fee_year === today.year || r.fee_year === rocYear)) return null;
  if (today.month < 4) return null;
  return { city, reason: `${rocYear} 年（民國）尚無常年會費申請記錄` };
}
export function licenseReminder(renewalDate: string | null | undefined, today: TaipeiDate): { date: string; reason: string } | null {
  const start = licenseReminderStart(renewalDate);
  const date = validDate(renewalDate);
  if (!start || !date || today.ymd < start) return null;
  return { date, reason: `執照更新日 ${date.replace(/-/g, "/")}，已進入到期前 2 年提醒區間` };
}

/** 在職判斷：以異動紀錄覆蓋（離職日 >= 復職／到職日，或有離職卻沒有復職 = 已離職）。 */
export function isStillActive(resignation: string | null | undefined, reactivation: string | null | undefined) {
  return !(resignation && (!reactivation || resignation >= reactivation));
}

// ---- 壽星 ----
export type BirthdayRow = { employee_code: string; employee_name: string; birthday: string };
export function monthBirthdays(rows: BirthdayRow[], month: number): BirthdayRow[] {
  const inMonth = rows.filter((r) => r.birthday && parseInt(r.birthday.split("-")[1], 10) === month);
  const byCode = new Map<string, BirthdayRow>();
  for (const r of inMonth) if (!byCode.has(r.employee_code)) byCode.set(r.employee_code, r);
  return Array.from(byCode.values()).sort((a, b) => {
    const [, am, ad] = a.birthday.split("-").map(Number),
      [, bm, bd] = b.birthday.split("-").map(Number);
    return am !== bm ? am - bm : ad - bd;
  });
}

// ---- 新人入職 ----
export type OnboardingRow = {
  employee_code: string;
  employee_name: string;
  movement_date: string;
  store_id: string | null;
  store_code: string | null;
  store_name: string | null;
  onboarding_is_pharmacist: boolean | null;
};
/** 同員編同門市只留第一筆；依到職日、門市代碼、員編排序。 */
export function onboardingList(rows: OnboardingRow[]): OnboardingRow[] {
  const map = new Map<string, OnboardingRow>();
  for (const r of rows) {
    const code = String(r.employee_code || "").toUpperCase(),
      name = String(r.employee_name || "").trim();
    const key = `${code}::${r.store_id || "-"}`;
    if (!code || !name || map.has(key)) continue;
    map.set(key, { ...r, employee_code: code, employee_name: name });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.movement_date !== b.movement_date
      ? a.movement_date.localeCompare(b.movement_date)
      : (a.store_code || "") !== (b.store_code || "")
        ? (a.store_code || "").localeCompare(b.store_code || "", "zh-TW")
        : a.employee_code.localeCompare(b.employee_code),
  );
}

// ---- 每月獎金（20 欄位）----
export const BONUS_FIELDS = [
  ["group_bonus", "月團體獎金"],
  ["hr_subsidy_bonus", "人時補助獎金"],
  ["single_item_bonus", "上月單品獎金"],
  ["inventory_diff_penalty", "盤差獎罰"],
  ["talent_bonus", "育才獎金"],
  ["transport_fee", "交通費用"],
  ["inventory_bonus", "庫存獎金"],
  ["rx_incentive_bonus", "處方箋獎勵"],
  ["quarterly_makeup_bonus", "季度補差額"],
  ["meal_allowance", "誤餐費"],
  ["spring_festival_bonus", "春節出勤獎金"],
  ["pharmacist_guarantee", "藥師底薪保障補貼"],
  ["owner_rx_makeup", "店東處方箋補差額"],
  ["sales_competition_bonus", "銷售競賽獎金"],
  ["owner_signing_bonus", "店東簽約獎金"],
  ["long_term_care_bonus", "長照獎金"],
  ["manager_supervisor_quarterly_bonus", "經理.督導季獎金"],
  ["opening_abnormal_responsibility_amount", "開店異常責任金額"],
  ["bonus_difference_adjustment", "獎金差額調整"],
  ["other_bonus", "其他獎金"],
] as const;
export type BonusKey = (typeof BONUS_FIELDS)[number][0];
export const BONUS_SELECT = ["year_month", "store_id", ...BONUS_FIELDS.map((f) => f[0]), "other_bonus_note"].join(",");
export type BonusMonth = {
  yearMonth: string;
  total: number;
  otherNote: string | null;
  storeIds: string[];
  amounts: Record<BonusKey, number>;
  items: { key: BonusKey; label: string; amount: number }[];
  /** Q12：該月月結狀態已確認才為 true；否則畫面標註「尚未確認，金額可能調整」。 */
  confirmed: boolean;
};
/** 同月份加總；金額全為 0 的月份不顯示；最近 12 個月（舊版）。confirmed 由 applyBonusConfirmation 填入。 */
export function summarizeBonus(rows: any[]): BonusMonth[] {
  const map = new Map<string, BonusMonth>();
  for (const row of rows || []) {
    const ym = String(row.year_month || "");
    if (!ym) continue;
    const cur =
      map.get(ym) ||
      ({
        yearMonth: ym,
        total: 0,
        otherNote: null,
        storeIds: [],
        amounts: Object.fromEntries(BONUS_FIELDS.map((f) => [f[0], 0])) as Record<BonusKey, number>,
        items: [],
        confirmed: false,
      } as BonusMonth);
    for (const [key] of BONUS_FIELDS) cur.amounts[key] += Number(row[key]) || 0;
    const note = Number(row.other_bonus) !== 0 ? String(row.other_bonus_note || "").trim() : "";
    if (note) {
      const notes = cur.otherNote ? cur.otherNote.split("；").map((n) => n.trim()).filter(Boolean) : [];
      if (!notes.includes(note)) cur.otherNote = [...notes, note].join("；");
    }
    if (row.store_id && !cur.storeIds.includes(String(row.store_id))) cur.storeIds.push(String(row.store_id));
    map.set(ym, cur);
  }
  return Array.from(map.values())
    .map((m) => {
      m.total = BONUS_FIELDS.reduce((s, [k]) => s + (m.amounts[k] || 0), 0);
      m.items = BONUS_FIELDS.filter(([k]) => m.amounts[k] !== 0).map(([key, label]) => ({ key, label, amount: m.amounts[key] }));
      return m;
    })
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .filter((m) => BONUS_FIELDS.some(([k]) => m.amounts[k] !== 0))
    .slice(0, 12);
}
/** 該月所有出現過獎金的門市，其月結狀態都是已確認，才算已確認；查不到狀態視為未確認。 */
export function applyBonusConfirmation(months: BonusMonth[], isConfirmed: (yearMonth: string, storeId: string) => boolean): BonusMonth[] {
  return months.map((m) => ({ ...m, confirmed: m.storeIds.length > 0 && m.storeIds.every((s) => isConfirmed(m.yearMonth, s)) }));
}

// ---- 調店待確認數（Q13）----
/**
 * 管理員與有「建立調店」權限者看全部待確認；其餘（督導）只數「我現在可以確認」的：
 * 原店或新店任一位督導可確認（M2 H.1／H.7），店長不能確認。卡片只給有確認權限者。
 */
export function transferPendingScope(opts: { isAdmin: boolean; canCreate: boolean; canConfirm: boolean }): "none" | "all" | "supervised" {
  if (!opts.canConfirm) return "none";
  return opts.isAdmin || opts.canCreate ? "all" : "supervised";
}
export function countConfirmable(requests: { from_store_id: string; to_store_id: string }[], supervised: ReadonlySet<string>): number {
  return requests.filter((r) => supervised.has(r.from_store_id) || supervised.has(r.to_store_id)).length;
}

// ---- 我的任務（Q14）----
export type HomeTaskInput = { id: string; assigned_to: string | null; created_at: string; status: string };
/** 只列指派給本人者（舊版）；未完成優先、建立時間新到舊，不足 3 筆才補已完成。 */
export function pickHomeTasks<T extends HomeTaskInput>(rows: T[], userId: string, limit = 3): T[] {
  const mine = rows.filter((r) => r.assigned_to === userId);
  const byNewest = (a: T, b: T) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  const open = mine.filter((r) => r.status !== "completed").sort(byNewest);
  const done = mine.filter((r) => r.status === "completed").sort(byNewest);
  return [...open, ...done].slice(0, limit);
}
