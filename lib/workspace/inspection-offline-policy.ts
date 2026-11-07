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
  /** 新增巡店的暫存槽（每個新增分頁各一個），編輯時為空。 */
  slot?: string;
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
  slot?: string | null,
) => `${userId}|${type}|${recordId || (slot ? "new:" + slot : "new")}`;
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
/**
 * 還原詢問的流程（Q16）：「不還原」要再確認一次才會刪除，不能一步刪掉。
 * ask → decline → confirm-delete → confirm-delete → deleted；confirm-delete 可 back 回到 ask；ask 可 restore。
 */
export type RestoreStep = "ask" | "confirm-delete" | "restored" | "deleted";
export type RestoreAction = "decline" | "back" | "restore" | "confirm-delete";
export function restoreStep(step: RestoreStep, action: RestoreAction): RestoreStep {
  if (step === "ask") return action === "decline" ? "confirm-delete" : action === "restore" ? "restored" : step;
  if (step === "confirm-delete") return action === "back" ? "ask" : action === "confirm-delete" ? "deleted" : step;
  return step;
}
/**
 * 儲存成功後要清除的暫存 key：只有這個分頁自己的新增暫存槽、剛存的舊單號與目前單號，
 * 不含其他新增分頁的暫存槽。
 */
export function draftKeysToClear(
  userId: string,
  type: string,
  slot: string,
  previousRecordId?: string | null,
  recordId?: string | null,
): string[] {
  const keys = [draftKey(userId, type, null, slot)];
  if (previousRecordId) keys.push(draftKey(userId, type, previousRecordId));
  if (recordId) keys.push(draftKey(userId, type, recordId));
  return [...new Set(keys)];
}
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
