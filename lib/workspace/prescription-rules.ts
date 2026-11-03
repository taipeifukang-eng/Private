/**
 * 處方箋報表的欄位驗證、資料狀態與總慢箋張數（Vue 處方箋頁與測試共用）。
 * 逐行對照舊版 components/performance/PrescriptionTab.tsx（validCount、validPointValue、rowStatus、statusLabel、calculatedTotal）。
 */
export const PRESCRIPTION_FIELDS = [
  "regular_prescription_count",
  "regular_prescription_point_value",
  "chronic_prescription_count",
  "chronic_prescription_point_value",
] as const;
export type PrescriptionField = (typeof PRESCRIPTION_FIELDS)[number];
export type PrescriptionStatus = "complete" | "partial" | "empty" | "invalid";

type Cell = string | number | null | undefined;
export type PrescriptionInputRow = Partial<Record<PrescriptionField, Cell>>;

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v));

export function validCount(value: string) {
  return /^\d+$/.test(value.trim());
}

export function validPointValue(value: string) {
  return /^\d+(\.\d{1,4})?$/.test(value.trim());
}

export function prescriptionStatus(row: PrescriptionInputRow): PrescriptionStatus {
  const v = Object.fromEntries(PRESCRIPTION_FIELDS.map((k) => [k, text(row[k])])) as Record<PrescriptionField, string>;
  const hasValues = PRESCRIPTION_FIELDS.some((k) => v[k].trim() !== "");
  const invalid =
    (v.regular_prescription_count && !validCount(v.regular_prescription_count)) ||
    (v.chronic_prescription_count && !validCount(v.chronic_prescription_count)) ||
    (v.regular_prescription_point_value && !validPointValue(v.regular_prescription_point_value)) ||
    (v.chronic_prescription_point_value && !validPointValue(v.chronic_prescription_point_value));
  if (invalid) return "invalid";
  if (PRESCRIPTION_FIELDS.every((k) => v[k].trim() !== "")) return "complete";
  return hasValues ? "partial" : "empty";
}

export function prescriptionStatusLabel(status: PrescriptionStatus) {
  return status === "complete" ? "已完成" : status === "partial" ? "部分填寫" : status === "invalid" ? "格式錯誤" : "未填";
}

/** 總慢箋張數 = 一般箋 / 4（四捨五入到小數 1 位）+ 慢箋；任一張數缺少或格式錯誤時為 null。 */
export function prescriptionTotal(row: PrescriptionInputRow): number | null {
  const regular = text(row.regular_prescription_count).trim();
  const chronic = text(row.chronic_prescription_count).trim();
  if (!validCount(regular) || !validCount(chronic)) return null;
  const roundedRegularQuarter = Math.round((Number(regular) / 4 + Number.EPSILON) * 10) / 10;
  return roundedRegularQuarter + Number(chronic);
}

/** 儲存前檢查（舊版 saveChanges 的訊息）；全部通過回傳 null。 */
export function prescriptionSaveError(row: PrescriptionInputRow & { store_code?: string; store_name?: string }): string | null {
  const who = `${row.store_code ?? ""} ${row.store_name ?? ""}`;
  const v = (k: PrescriptionField) => text(row[k]);
  if (v("regular_prescription_count") && !validCount(v("regular_prescription_count"))) return `${who}：一般箋張數需為非負整數`;
  if (v("chronic_prescription_count") && !validCount(v("chronic_prescription_count"))) return `${who}：慢箋張數需為非負整數`;
  if (v("regular_prescription_point_value") && !validPointValue(v("regular_prescription_point_value"))) return `${who}：一般箋點值最多輸入小數四位`;
  if (v("chronic_prescription_point_value") && !validPointValue(v("chronic_prescription_point_value"))) return `${who}：慢箋點值最多輸入小數四位`;
  return null;
}
