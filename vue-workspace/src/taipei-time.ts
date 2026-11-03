// 與舊版 app/inspection/[id]/page.tsx 的 formatTaipeiDateTime / Date / Time 相同格式（zh-TW、Asia/Taipei）。
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const toDate = (value?: string | Date | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
export const formatTaipeiDateTime = (value?: string | Date | null) =>
  toDate(value)?.toLocaleString("zh-TW", { timeZone: TAIPEI_TIME_ZONE }) ?? "";
export const formatTaipeiDate = (value?: string | Date | null) =>
  toDate(value)?.toLocaleDateString("zh-TW", { timeZone: TAIPEI_TIME_ZONE }) ?? "";
export const formatTaipeiTime = (value?: string | Date | null) =>
  toDate(value)?.toLocaleTimeString("zh-TW", { timeZone: TAIPEI_TIME_ZONE }) ?? "";
