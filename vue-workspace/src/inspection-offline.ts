import {
  draftKey,
  draftUsable,
  isExpired,
  type OfflineDraft,
} from "../../lib/workspace/inspection-offline-policy";

// M4 Q14–Q16：巡店離線暫存（IndexedDB，容量足夠放照片與簽名）。
// 任何錯誤都不丟出：瀏覽器不支援或被封鎖時，退化成沒有暫存，不影響填寫。
/** 目前開著的「新增」分頁正在使用的暫存槽（帳號|類型|槽），其他新增分頁不會還原或刪除它們。 */
export const claimedSlots = new Set<string>();
export const DRAFT_DB = "workspace-inspection-drafts";
const STORE = "drafts";
let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
      const request = indexedDB.open(DRAFT_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    opened.catch(() => (opened = null));
  }
  return opened;
}
function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}
export async function offlineAvailable() {
  try {
    await db();
    return true;
  } catch {
    return false;
  }
}
/** 寫入（以 JSON 轉成純資料，避免 Vue 響應式物件無法複製）。 */
export async function putDraft(draft: OfflineDraft): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(JSON.parse(JSON.stringify(draft))));
    return true;
  } catch {
    return false;
  }
}
/** 只回傳屬於這個帳號、未過期的暫存；過期的順手刪掉。 */
export async function getDraft(
  userId: string,
  type: string,
  recordId: string | null | undefined,
  slot?: string | null,
): Promise<OfflineDraft | null> {
  try {
    const key = draftKey(userId, type, recordId, slot);
    const draft = await run<OfflineDraft | undefined>("readonly", (s) => s.get(key));
    if (!draft) return null;
    if (isExpired(draft.savedAt)) {
      await removeDraft(userId, type, recordId, slot);
      return null;
    }
    return draftUsable(draft, userId) ? draft : null;
  } catch {
    return null;
  }
}
export async function removeDraftByKey(key: string) {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {
    /* 沒有暫存可刪 */
  }
}
export async function removeDraft(
  userId: string,
  type: string,
  recordId: string | null | undefined,
  slot?: string | null,
) {
  try {
    await run("readwrite", (s) => s.delete(draftKey(userId, type, recordId, slot)));
  } catch {
    /* 沒有暫存可刪 */
  }
}
/** 這個帳號、這個類型所有「新增」暫存（每個新增分頁各一份，含舊版共用槽），新的在前。 */
export async function listNewDrafts(userId: string, type: string): Promise<OfflineDraft[]> {
  try {
    const all = await run<OfflineDraft[]>("readonly", (s) => s.getAll());
    return all
      .filter((d) => draftUsable(d, userId) && d.recordId === null && d.type === type)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}
/** 進頁時清掉所有過期（超過 15 天）的暫存，不分帳號。 */
export async function purgeExpiredDrafts(): Promise<number> {
  try {
    const all = await run<OfflineDraft[]>("readonly", (s) => s.getAll());
    const old = all.filter((d) => isExpired(d.savedAt));
    for (const d of old) await run("readwrite", (s) => s.delete(d.key));
    return old.length;
  } catch {
    return 0;
  }
}
