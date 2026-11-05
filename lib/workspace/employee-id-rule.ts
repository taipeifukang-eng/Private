// 員編規則（M2 規格 E.1、E.2、E.3，使用者 2026-11-05 survey/m2 確認）。
// 所有「新增」入口（新增員工、異動入職、員工匯入、每月人員狀態手動新增、生日匯入比對）前後端與 DEV SQL
// （workspace_employee_id_valid / workspace_employee_id_type）都使用這一套規則；長度上限也由本規則決定。
//   FK  + 4 碼數字  例 FK1234
//   FKF + 5 碼數字  例 FKF12345
//   FKPT+ 3 碼數字  例 FKPT123（兼職）
// FKI（實習生）一律拒絕：實習生不出現在系統。只擋「新建立」的員編，既有員編不改、編輯時員編唯讀。

export const EMPLOYEE_ID_FORMAT_TEXT = 'FK+4碼數字、FKF+5碼數字、FKPT+3碼數字';
export const EMPLOYEE_ID_PATTERN = /^(?:FK\d{4}|FKF\d{5}|FKPT\d{3})$/;
/** 與 DEV SQL workspace_employee_id_valid 完全相同的 POSIX 規則。 */
export const EMPLOYEE_ID_SQL_PATTERN = '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$';
/** 規則允許的最長員編（FKF+5 = 8 碼）。所有新增入口的長度上限都由此決定。 */
export const EMPLOYEE_ID_MAX_LENGTH = 8;
export const EMPLOYEE_ID_PART_TIME_PREFIX = 'FKPT';

export type EmployeeIdRejection = 'empty' | 'intern' | 'format';
export type EmployeeIdCheck = { ok: true; code: string } | { ok: false; code: string; reason: EmployeeIdRejection; message: string };

/** 去掉前後空白並轉大寫（非字串視為空）。 */
export function normalizeEmployeeId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** FKI 開頭一律視為實習生員編。 */
export function isInternEmployeeId(value: unknown): boolean {
  return normalizeEmployeeId(value).startsWith('FKI');
}

export function isValidEmployeeId(value: unknown): boolean {
  return EMPLOYEE_ID_PATTERN.test(normalizeEmployeeId(value));
}

export const EMPLOYEE_ID_MESSAGES = {
  empty: '請填寫員編',
  intern: '實習生不納入系統，員編不可為 FKI 開頭',
  format: `員編格式錯誤。正確格式：${EMPLOYEE_ID_FORMAT_TEXT}`,
} as const;

export function checkEmployeeId(value: unknown): EmployeeIdCheck {
  const code = normalizeEmployeeId(value);
  if (!code) return { ok: false, code, reason: 'empty', message: EMPLOYEE_ID_MESSAGES.empty };
  if (code.startsWith('FKI')) return { ok: false, code, reason: 'intern', message: EMPLOYEE_ID_MESSAGES.intern };
  if (!EMPLOYEE_ID_PATTERN.test(code)) return { ok: false, code, reason: 'format', message: EMPLOYEE_ID_MESSAGES.format };
  return { ok: true, code };
}

export type EmploymentTypeByCode = 'part_time' | 'full_time';

/** E.3：FKPT 開頭自動兼職，其餘正職。 */
export function employmentTypeForEmployeeId(value: unknown): EmploymentTypeByCode {
  return normalizeEmployeeId(value).startsWith(EMPLOYEE_ID_PART_TIME_PREFIX) ? 'part_time' : 'full_time';
}

export const EMPLOYMENT_TYPE_BY_CODE_LABEL = '兼職（依員編）';

/** Excel 員編欄：只有 4 位數字補 FK、只有 5 位數字補 FKF；其餘只做去空白與轉大寫。 */
export function completeExcelEmployeeId(value: unknown): string {
  const code = normalizeEmployeeId(typeof value === 'number' && Number.isFinite(value) ? String(value) : value);
  if (/^\d{4}$/.test(code)) return `FK${code}`;
  if (/^\d{5}$/.test(code)) return `FKF${code}`;
  return code;
}
