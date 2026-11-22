// 規格 G.3：「外務時數: N小時」前綴去重（伺服器端）。
// 舊版每次儲存都把前綴加在 partial_month_notes 前面，而編輯頁載入時又帶回含前綴的備註，所以前綴會疊加。
// 這裡先移除既有的前綴（含其後的「; 」分隔，可能有多個疊加），再視外務時數加上最新一個。
const PREFIX = /^(?:外務時數:\s*[0-9]+(?:\.[0-9]+)?\s*小時(?:;\s*|$))+/;

export function stripExternalHoursPrefix(notes: string | null | undefined): string {
  return String(notes ?? "").replace(PREFIX, "");
}

export function applyExternalHoursPrefix(
  notes: string | null | undefined,
  externalHours: number | null | undefined,
): string | null {
  const rest = stripExternalHoursPrefix(notes);
  const hours = Number(externalHours);
  if (Number.isFinite(hours) && hours > 0)
    return `外務時數: ${hours}小時${rest ? "; " + rest : ""}`;
  return rest || null;
}
