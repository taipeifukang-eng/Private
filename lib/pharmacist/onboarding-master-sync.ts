/**
 * 入職異動勾選「是藥師」時，同步員工主檔 store_employees.is_pharmacist = true。
 *
 * 規則：
 *  - 只會把主檔改成 true；入職改回「否」時不自動把主檔改 false（可能已有其他依據，如手動維護或復職）。
 *  - 職位文字不動。
 */

export interface OnboardingPharmacistInput {
  employee_code?: string | null;
  is_pharmacist?: boolean | null;
}

/** 純函式：挑出需要同步為藥師的員編（大寫、去重、略過空值與非藥師）。 */
export function pickOnboardingPharmacistCodes(inputs: OnboardingPharmacistInput[]): string[] {
  const codes = new Set<string>();
  for (const i of inputs || []) {
    const code = String(i?.employee_code || '').trim().toUpperCase();
    if (code && i?.is_pharmacist === true) codes.add(code);
  }
  return Array.from(codes);
}

/** 把入職勾是藥師的人在主檔改成 is_pharmacist=true（只改目前不是 true 的列）。 */
export async function syncOnboardingPharmacistToEmployeeMaster(
  client: any,
  inputs: OnboardingPharmacistInput[],
): Promise<number> {
  const codes = pickOnboardingPharmacistCodes(inputs);
  if (!codes.length) return 0;
  const { data, error } = await client
    .from('store_employees')
    .update({ is_pharmacist: true, updated_at: new Date().toISOString() })
    .in('employee_code', codes)
    .or('is_pharmacist.is.null,is_pharmacist.eq.false')
    .select('employee_code');
  if (error) throw new Error(`同步員工主檔藥師身分失敗：${error.message}`);
  return (data || []).length;
}
