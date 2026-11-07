/**
 * M4 Q14–Q16：巡店離線暫存的規則（純函式，前端 IndexedDB 與單元測試共用）。
 *  - Q14：新增與編輯草稿都暫存（含照片與簽名）。
 *  - Q15：依登入帳號隔離，key 內含使用者 id，換帳號看不到他人的暫存。
 *  - Q16：保留 15 天；選「不還原」要再確認一次才刪；已送出的自動清除。
 */
export const DRAFT_TTL_DAYS = 15;
export const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;

export type OfflineDraft = {
  key: string;
  userId: string;
  type: "supervisor" | "manager";
  /** 編輯既有草稿時為巡店 id；新增時為 null。 */
  recordId: string | null;
  savedAt: number;
  /** 暫存當下伺服器上草稿的版本（新增為 0）。 */
  serverVersion: number;
  templateHash: string;
  /** 暫存當下使用的範本，換新範本時用來對應保留內容（Q9）。 */
  templates: any[];
  form: any;
};

export const draftKey = (
  userId: string,
  type: string,
  recordId: string | null | undefined,
) => `${userId}|${type}|${recordId || "new"}`;
export const isExpired = (savedAt: number, now = Date.now()) =>
  !Number.isFinite(savedAt) || now - savedAt > DRAFT_TTL_MS;
export const expiresAt = (savedAt: number) => savedAt + DRAFT_TTL_MS;
/** 這份暫存可否被這個帳號看到、還原。 */
export const draftUsable = (
  draft: OfflineDraft | null | undefined,
  userId: string,
  now = Date.now(),
): draft is OfflineDraft =>
  !!draft &&
  !!userId &&
  draft.userId === userId &&
  draft.key.startsWith(userId + "|") &&
  !isExpired(draft.savedAt, now);
/** 編輯暫存：伺服器上的草稿版本已不同（其他裝置更新過）。 */
export const serverMovedOn = (draft: OfflineDraft, serverVersion: number) =>
  draft.recordId !== null && Number(draft.serverVersion) !== Number(serverVersion);
/** 表單是否有值得暫存的內容（避免空白表單也覆寫暫存）。 */
export function hasDraftContent(form: any): boolean {
  if (!form) return false;
  return !!(
    (form.temperature !== "" && form.temperature != null) ||
    (form.notes || "").trim() ||
    form.signature ||
    form.supervisorSignature ||
    (form.staff || []).some((s: any) => s.is_manually_added || s.is_duty_supervisor) ||
    (form.scores || []).some(
      (s: any) => s.checked_items?.length || (s.notes || "").trim() || s.photos?.length,
    )
  );
}
export const OFFLINE_RETRY_MESSAGE = "已暫存在本機，連線後請再按送出";
