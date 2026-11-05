// 巡店強制定位的共用規則（舊版 Next.js 與新版 Vue 共用同一份）。
// 純函式、不依賴 DOM / React，方便單元測試。
// 資料庫端的 trigger（supabase/migrations/*_inspection_require_gps.sql）使用相同門檻，修改時請同步。

/** 誤差超過此值（公尺）視為定位失敗，表單維持鎖住。 */
export const GPS_MAX_ACCURACY_M = 1000;
/** 誤差超過此值（公尺）但未超過上限時，只顯示橘色提示，不擋。 */
export const GPS_WARN_ACCURACY_M = 500;
/** gps_timestamp 比伺服器時間早超過此時間（毫秒）即拒絕：2 小時。 */
export const GPS_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** gps_timestamp 比伺服器時間晚超過此時間（毫秒）即拒絕：5 分鐘。 */
export const GPS_MAX_FUTURE_MS = 5 * 60 * 1000;
/** 高精度定位等待多久（毫秒）才改用一般定位。 */
export const GPS_HIGH_ACCURACY_FALLBACK_MS = 8000;

/** 資料庫 trigger 錯誤訊息的固定前綴，前端用它辨識並直接顯示。 */
export const GPS_DB_ERROR_PREFIX = '【巡店定位】';

export type GpsFailureKind =
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'unsupported'
  | 'accuracy_too_large'
  | 'invalid_fix'
  | 'time_invalid'
  | 'unknown';

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt?: string | null;
}

export type GpsFixCheck =
  | { ok: true; warning: boolean; message: string }
  | { ok: false; kind: GpsFailureKind; message: string };

/** 對應 GeolocationPositionError.code：1 拒絕、2 無法取得、3 逾時。 */
export function classifyGeolocationError(code: number | null | undefined): GpsFailureKind {
  switch (code) {
    case 1:
      return 'permission_denied';
    case 2:
      return 'position_unavailable';
    case 3:
      return 'timeout';
    default:
      return 'unknown';
  }
}

export function getGpsFailureMessage(kind: GpsFailureKind, accuracy?: number | null): string {
  switch (kind) {
    case 'permission_denied':
      return '定位權限被拒絕';
    case 'position_unavailable':
      return '無法取得位置';
    case 'timeout':
      return '定位逾時';
    case 'unsupported':
      return '當前瀏覽器不支援定位功能';
    case 'accuracy_too_large':
      return `定位誤差過大（±${formatAccuracy(accuracy)} 公尺）`;
    case 'invalid_fix':
      return '定位資料不完整或座標超出範圍';
    case 'time_invalid':
      return '定位時間異常，請重新定位';
    default:
      return '定位失敗';
  }
}

function formatAccuracy(accuracy?: number | null): string {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) ? String(Math.round(accuracy)) : '未知';
}

/** 精度分級：ok 正常、warn 橘色提示不擋、reject 視為失敗。缺值或非數字一律 reject。 */
export function evaluateGpsAccuracy(accuracy: number | null | undefined): 'ok' | 'warn' | 'reject' {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return 'reject';
  if (accuracy > GPS_MAX_ACCURACY_M) return 'reject';
  if (accuracy > GPS_WARN_ACCURACY_M) return 'warn';
  return 'ok';
}

export function isCoordinateInRange(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  );
}

/** 時間窗：不得早於 now 2 小時，不得晚於 now 5 分鐘。 */
export function isGpsTimestampWithinWindow(capturedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!capturedAt) return false;
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return false;
  const diff = t - now;
  return diff <= GPS_MAX_FUTURE_MS && diff >= -GPS_MAX_AGE_MS;
}

/** 前端在解鎖表單前檢查一筆定位結果，規則與資料庫 trigger 一致。 */
export function validateGpsFix(fix: GpsFix | null | undefined, now: number = Date.now()): GpsFixCheck {
  if (!fix || !isCoordinateInRange(fix.latitude, fix.longitude)) {
    return { ok: false, kind: 'invalid_fix', message: getGpsFailureMessage('invalid_fix') };
  }
  const level = evaluateGpsAccuracy(fix.accuracy);
  if (level === 'reject') {
    const missing = typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy) || fix.accuracy < 0;
    return missing
      ? { ok: false, kind: 'invalid_fix', message: getGpsFailureMessage('invalid_fix') }
      : { ok: false, kind: 'accuracy_too_large', message: getGpsFailureMessage('accuracy_too_large', fix.accuracy) };
  }
  if (!isGpsTimestampWithinWindow(fix.capturedAt, now)) {
    return { ok: false, kind: 'time_invalid', message: getGpsFailureMessage('time_invalid') };
  }
  return level === 'warn'
    ? { ok: true, warning: true, message: '建議使用手機' }
    : { ok: true, warning: false, message: '' };
}

/** 是否為資料庫 trigger 擋下的定位錯誤。 */
export function isGpsDbError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.includes(GPS_DB_ERROR_PREFIX);
}

/** 取出 trigger 的中文訊息（去除前綴以外的雜訊），供前端直接顯示。 */
export function getGpsDbErrorMessage(error: unknown): string {
  const message = String((error as { message?: unknown } | null | undefined)?.message ?? '');
  const index = message.indexOf(GPS_DB_ERROR_PREFIX);
  return index >= 0 ? message.slice(index) : message;
}

// ---------------------------------------------------------------------------
// 裝置與 LINE 偵測
// ---------------------------------------------------------------------------

export type GpsDeviceKind = 'ios' | 'android' | 'windows' | 'other';
export type GpsGuideTabId = 'ios' | 'android' | 'line' | 'windows';

export function isLineInAppBrowser(userAgent: string | null | undefined): boolean {
  return /\bLine\//i.test(userAgent || '');
}

/** iPadOS 13+ 的 Safari 會偽裝成 Mac，需靠 maxTouchPoints 判斷。 */
export function detectGpsDevice(
  userAgent: string | null | undefined,
  options: { maxTouchPoints?: number } = {}
): GpsDeviceKind {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && (options.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other';
}

/** 教學視窗預設分頁：LINE 內建瀏覽器優先，其次依裝置，其他裝置預設 Windows 桌機。 */
export function getDefaultGuideTab(
  userAgent: string | null | undefined,
  options: { maxTouchPoints?: number } = {}
): GpsGuideTabId {
  if (isLineInAppBrowser(userAgent)) return 'line';
  const device = detectGpsDevice(userAgent, options);
  if (device === 'ios') return 'ios';
  if (device === 'android') return 'android';
  return 'windows';
}

// ---------------------------------------------------------------------------
// 教學文字資料（分步驟文字 + 簡單圖示，不放截圖）
// ---------------------------------------------------------------------------

export interface GpsGuideStep {
  icon: string;
  text: string;
}

export interface GpsGuideTab {
  id: GpsGuideTabId;
  label: string;
  steps: GpsGuideStep[];
}

export const GPS_GUIDE_TABS: GpsGuideTab[] = [
  {
    id: 'ios',
    label: 'iPhone / iPad',
    steps: [
      { icon: '⚙️', text: '打開「設定」→「隱私權與安全性」→「定位服務」，確認最上方的「定位服務」是開啟的。' },
      { icon: '🧭', text: '在定位服務清單中找到「Safari 網站」，選擇「使用 App 期間」，並開啟「精確位置」。' },
      { icon: '🌐', text: '回到 Safari，點網址列左側的「ㄅㄚ」圖示 →「網站設定」，把「位置」設為「允許」。' },
      { icon: '🔄', text: '回到本頁，按下方「我開好了，重新定位」。' },
    ],
  },
  {
    id: 'android',
    label: 'Android 手機 / 平板',
    steps: [
      { icon: '⚙️', text: '打開「設定」→「位置資訊」，確認「使用位置資訊」是開啟的，精確度選「高精確度」或開啟「精確位置」。' },
      { icon: '🔒', text: '在 Chrome 點網址列左側的鎖頭（或調整圖示）→「權限」→「位置」，選擇「允許」。' },
      { icon: '📱', text: '若仍被封鎖：Chrome 右上角「⋮」→「設定」→「網站設定」→「位置資訊」，把本網站改為允許。' },
      { icon: '🔄', text: '回到本頁，按下方「我開好了，重新定位」。' },
    ],
  },
  {
    id: 'line',
    label: '從 LINE 開啟',
    steps: [
      { icon: '💬', text: 'LINE 內建瀏覽器常常無法取得定位，請改用 Safari（iPhone）或 Chrome（Android）開啟本頁。' },
      { icon: '⋯', text: '點畫面右上角「⋮」或「⋯」選單，選擇「用預設瀏覽器開啟」（或「在 Safari 中開啟」／「在 Chrome 中開啟」）。' },
      { icon: '🔓', text: '在新開的瀏覽器登入後，依照「iPhone / iPad」或「Android」分頁開啟定位權限。' },
      { icon: '🔄', text: '回到本頁，按下方「我開好了，重新定位」。' },
    ],
  },
  {
    id: 'windows',
    label: 'Windows 桌機',
    steps: [
      { icon: '⚙️', text: '打開「設定」→「隱私權與安全性」→「位置」，開啟「位置服務」，並允許「讓桌面應用程式存取位置」。' },
      { icon: '🔒', text: '在瀏覽器（Chrome / Edge）點網址列左側的鎖頭 →「網站設定」→「位置」，選擇「允許」。' },
      { icon: '📡', text: '桌機使用 WiFi 定位，請確認已連上 WiFi；誤差超過 1000 公尺會被擋下，建議改用手機。' },
      { icon: '🔄', text: '回到本頁，按下方「我開好了，重新定位」。' },
    ],
  },
];

/** 依失敗原因加註的重點提示。 */
export function getGpsFailureNote(kind: GpsFailureKind | null | undefined): string {
  switch (kind) {
    case 'permission_denied':
      return '這次失敗的原因是「權限被拒絕」：請先允許本網站使用定位，再重新定位。';
    case 'position_unavailable':
    case 'timeout':
      return '這次失敗的原因是「無法取得位置或逾時」：請確認系統定位已開啟，並移動到窗邊或戶外再試。';
    case 'accuracy_too_large':
      return '這次失敗的原因是「定位誤差過大」：建議改用手機，並開啟「精確位置」。';
    case 'time_invalid':
      return '這次失敗的原因是「定位時間異常」：請確認裝置日期時間為自動設定，再重新定位。';
    case 'unsupported':
      return '這個瀏覽器不支援定位，請改用 Safari、Chrome 或 Edge 開啟。';
    default:
      return '';
  }
}

export const GPS_LINE_BROWSER_NOTICE =
  '偵測到你正在使用 LINE 內建瀏覽器，定位常被限制。請改用 Safari 或 Chrome 開啟本頁。';
