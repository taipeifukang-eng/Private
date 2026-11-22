// Shared by movement forms, imports and write APIs. Never silently convert ROC dates.
export const MOVEMENT_DATE_MIN = '1912-01-01';

export function getMovementDateError(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '請輸入完整西元日期（YYYY-MM-DD），例如 2026-10-01';
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1912) {
    const suggestion = year > 0 && year < 1000 ? `；若為民國 ${year} 年，請輸入西元 ${year + 1911} 年` : '';
    return `生效日期必須使用四位數西元年（1912 年起），不可輸入民國年${suggestion}`;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return '生效日期不存在，請確認月份與日期';
  }
  return null;
}
