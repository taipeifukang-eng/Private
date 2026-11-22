// M4 P04 督導與經理巡店比較：差異判定（純函式，供 API、單元與新舊對照測試共用）。
// 規則（m4-spec「巡店比較的差異判定」）：一邊沒有該項紀錄視為 0 扣分；扣分不同才標差異；
// 只有兩邊都沒有該項紀錄才顯示「缺少明細」。

export type CompareStatus = "same" | "missing" | "manager_only" | "supervisor_only" | "both_different";
type Side = { deduction_amount?: number | string | null } | null | undefined;

export function compareStatus(supervisor: Side, manager: Side): CompareStatus {
  if (!supervisor && !manager) return "missing";
  const a = Number(supervisor?.deduction_amount) || 0;
  const b = Number(manager?.deduction_amount) || 0;
  if (a === b) return "same";
  if (a === 0) return "manager_only";
  if (b === 0) return "supervisor_only";
  return "both_different";
}

/** 舊版 app/inspection/compare/page.tsx handleCompare 的判定（缺紀錄視為 0 扣分；兩邊都沒扣分就是 same；沒有 missing）。 */
export function legacyCompareStatus(supervisor: Side, manager: Side): Exclude<CompareStatus, "missing"> {
  const a = Number(supervisor?.deduction_amount) || 0;
  const b = Number(manager?.deduction_amount) || 0;
  if (a > 0 && b > 0) return a === b ? "same" : "both_different";
  if (a > 0 && b === 0) return "supervisor_only";
  if (a === 0 && b > 0) return "manager_only";
  return "same";
}
