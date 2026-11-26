import {
  GPS_DB_ERROR_PREFIX,
  GPS_EXEMPT_PERMISSION_CODE,
  formatTaipeiDate,
  isCoordinateInRange,
  toExemptGpsFix,
} from "../inspection/gps-policy";

/**
 * 新版巡店「定位例外」的伺服器端規則（純函式，可單元測試）。
 *
 * - 資格：inspection.gps_exempt 權限，或系統管理員。呼叫端傳入 ctx.has（= isAdmin || 權限碼），
 *   語意與正式區 has_permission 相同（不檢查 roles.is_active）。
 * - 為什麼一定要在 API 層檢查：Vue 的寫入走 service_role，auth.uid() 為 NULL，
 *   資料庫 trigger 會把它視為受信任寫入而不檢查例外權限，所以這裡是唯一防線。
 */
export const GPS_EXEMPT_FORBIDDEN_MESSAGE =
  GPS_DB_ERROR_PREFIX + "你沒有「巡店定位例外」權限";

export function canUseGpsExempt(has: (...codes: string[]) => boolean): boolean {
  return has(GPS_EXEMPT_PERMISSION_CODE) === true;
}

export type ExemptGpsColumns = {
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  gps_timestamp: string | null;
};

export type ExemptPlan =
  | { exempt: false }
  | {
      exempt: true;
      gps: ExemptGpsColumns;
      /** 巡店日期：伺服器端台北今天，不信任 client 傳來的 date。 */
      date: string;
    }
  | { error: { status: number; message: string } };

/**
 * 判斷這次「新增」是否走定位例外。
 * - 只有 body.gps_exempt === true 才算例外；其他情況回 { exempt: false }，交給一般定位驗證。
 * - 例外但沒資格：403。
 * - 例外且有座標：座標必須合法（超出範圍 400）；沒座標則四個欄位全 null。
 */
export function planGpsExempt(
  body: { gps_exempt?: unknown; gps?: unknown },
  has: (...codes: string[]) => boolean,
  now: Date = new Date(),
): ExemptPlan {
  if (body?.gps_exempt !== true) return { exempt: false };
  if (!canUseGpsExempt(has))
    return { error: { status: 403, message: GPS_EXEMPT_FORBIDDEN_MESSAGE } };
  const raw = body.gps && typeof body.gps === "object" ? (body.gps as any) : null;
  const hasAnyCoordinate =
    !!raw && (raw.latitude != null || raw.longitude != null);
  if (hasAnyCoordinate && !isCoordinateInRange(raw.latitude, raw.longitude))
    return {
      error: {
        status: 400,
        message: "定位資料不完整或座標超出範圍，請重新定位後再送出",
      },
    };
  const fix = toExemptGpsFix(
    raw
      ? {
          latitude: raw.latitude,
          longitude: raw.longitude,
          accuracy: raw.accuracy,
          capturedAt:
            typeof raw.capturedAt === "string" ? raw.capturedAt : null,
        }
      : null,
  );
  return {
    exempt: true,
    gps: {
      gps_latitude: fix?.latitude ?? null,
      gps_longitude: fix?.longitude ?? null,
      gps_accuracy: fix?.accuracy ?? null,
      gps_timestamp: fix?.capturedAt ?? null,
    },
    date: formatTaipeiDate(now),
  };
}
