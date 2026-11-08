// M5 W22 登入與公開頁規則（純函式，無相依；Next 端、Vue 工作台與 Vitest 共用）。
// Q15：保留公開註冊；新註冊者沒有任何角色，登入後顯示「帳號待管理員開通」。
// Q16：密碼最短 6 字元，照舊。
// 忘記密碼一律顯示同一句話，不透露信箱是否已註冊。
// 登入後回原頁只允許站內路徑。信件一律 mock（見 mailMockActive）。

/** Q16：註冊與重設密碼最短長度，與舊版、後台設定一致。 */
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt 實際上限，避免被截斷而讓人誤以為長密碼有效
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 100;

export const FORGOT_PASSWORD_NOTICE =
  "若此信箱已註冊，會收到重設密碼的信件。請檢查收件匣與垃圾郵件資料夾，連結有效時間有限。";
export const PENDING_ACTIVATION_TITLE = "帳號待管理員開通";
export const PENDING_ACTIVATION_TEXT =
  "您的帳號已建立，但目前還沒有被指派任何角色，所以暫時看不到功能。請聯絡管理員為您開通；開通後重新整理或重新登入即可使用。";

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const isValidEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value.trim());

const BAD_CHARS = /[\u0000-\u001f\u007f\\]/;
/**
 * 站內路徑檢查：只允許以單一 / 開頭的路徑。
 * 擋掉：//host、/\host、含 scheme 的網址、控制字元、過長字串，以及編碼後才變成 //host 的寫法。
 */
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (BAD_CHARS.test(value)) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || BAD_CHARS.test(decoded)) return null;
  return value;
}
const AUTH_LOOP_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/auth/callback"];
/** 登入後回原頁：站內路徑，且不能回到登入／註冊等公開頁（避免迴圈）。不合法回 null（呼叫端改去首頁）。 */
export function safeRedirectPath(raw: unknown): string | null {
  const value = safeInternalPath(raw);
  if (!value) return null;
  const path = value.split(/[?#]/)[0].replace(/\/+$/, "");
  return AUTH_LOOP_PATHS.includes(path) ? null : value;
}

export type RegisterInput = { fullName: string; email: string; password: string; confirmPassword?: string };
/** 註冊欄位驗證；欄位與驗證照舊（姓名必填、密碼至少 6 字元、兩次一致），訊息為中文。 */
export function validateRegister(input: Partial<RegisterInput>): string | null {
  const name = String(input.fullName ?? "").trim();
  if (!name) return "請輸入姓名";
  if (name.length > MAX_NAME_LENGTH) return `姓名最多 ${MAX_NAME_LENGTH} 個字`;
  if (!isValidEmail(input.email)) return "請輸入有效的電子郵件";
  return validateNewPassword(input.password, input.confirmPassword, "register");
}
/**
 * 新密碼驗證（註冊與重設共用）。confirm 為 undefined 時不比對。
 * 提示文字沿用舊版各頁的原句（註冊「密碼不一致」「密碼至少需要 6 個字元」；重設「兩次輸入的密碼不一致」「密碼長度至少需要 6 個字元」）。
 */
export function validateNewPassword(password: unknown, confirm?: unknown, kind: "register" | "reset" = "reset"): string | null {
  const tooShort = typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm !== undefined && password !== confirm;
  const shortText = kind === "register" ? `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元` : `密碼長度至少需要 ${MIN_PASSWORD_LENGTH} 個字元`;
  const mismatchText = kind === "register" ? "密碼不一致" : "兩次輸入的密碼不一致";
  // 檢查順序照舊版：註冊頁先比對兩次是否一致、再看長度；重設頁先看長度、再比對。
  if (kind === "register") {
    if (mismatch) return mismatchText;
    if (tooShort) return shortText;
  } else {
    if (tooShort) return shortText;
    if (mismatch) return mismatchText;
  }
  if ((password as string).length > MAX_PASSWORD_LENGTH) return `密碼最多 ${MAX_PASSWORD_LENGTH} 個字元`;
  return null;
}

/** 重設頁的密碼強度提示（照舊版公式，只提示、不強制）。 */
export function passwordStrength(password: string): { score: number; label: "" | "弱" | "中等" | "強" } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  return { score, label: score <= 2 ? "弱" : score <= 4 ? "中等" : "強" };
}

/** Supabase 英文錯誤轉中文白話；未知錯誤一律用通用句，不輸出原文。 */
export function friendlyAuthError(message: unknown, kind: "register" | "reset"): string {
  const m = String(message ?? "").toLowerCase();
  if (/rate limit|too many|security purposes|after \d+ second/.test(m)) return "操作太頻繁，請稍後再試";
  if (/already (been )?registered|already exists|duplicate/.test(m))
    return "此信箱已經註冊，請直接登入；忘記密碼可使用「忘記密碼」重設";
  if (/signup.*disabled|signups not allowed/.test(m)) return "目前未開放註冊，請聯絡管理員";
  if (/password.*(at least|short|weak)|weak password/.test(m)) return `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`;
  if (/invalid.*email|email.*invalid|unable to validate email/.test(m)) return "請輸入有效的電子郵件";
  if (/same.*password|different from the old/.test(m)) return "新密碼不能與目前的密碼相同";
  if (/expired|invalid.*(token|code|link)|session.*(missing|not found)|not authenticated|jwt/.test(m))
    return "重設連結已失效，請重新申請";
  return kind === "register" ? "註冊失敗，請稍後再試" : "重設密碼失敗，請稍後再試";
}

/** 重設連結失敗時，/auth/callback 帶回 /reset-password?error=… 的固定文字；畫面只認有帶 error，不顯示網址上的任意文字。 */
export const RESET_LINK_ERROR_TEXT = "重設連結已失效或已使用過，請重新申請";
export const RESET_LINK_MISSING_TEXT = "請先從郵件中點擊重設連結";

/**
 * 沒有任何生效角色、也不是管理員 = 帳號待管理員開通（與使用者管理的待開通標籤同一定義，Q15）。
 * activeRoleCount 以 resolveAccess 的結果為準：指派啟用、未到期，不看 roles.is_active。
 */
export const isPendingAccount = (access: { activeRoleCount: number; isAdmin: boolean }) =>
  access.activeRoleCount === 0 && !access.isAdmin;

/** 重設信連結的網站網址。缺設定直接報錯，不再退回寄出無法開啟的 localhost 連結。 */
export function resetRedirectUrl(siteUrl: string | undefined | null): string {
  const base = String(siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(base)) throw new Error("SITE_URL_MISSING");
  return `${base}/auth/callback?next=/reset-password`;
}

/**
 * 信件 mock（D17）：只有明確開啟旗標、且信箱是保留網域 example.test 時，
 * 註冊與忘記密碼改走不寄信的路徑。任何一個條件不成立都走真實流程。
 */
export const MAIL_MOCK_DOMAIN = "@example.test";
export const mailMockActive = (flag: string | undefined, email: string) =>
  flag === "true" && email.trim().toLowerCase().endsWith(MAIL_MOCK_DOMAIN);
