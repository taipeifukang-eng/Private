// 廠商、服務分類、服務區域的錯誤碼與提醒白話對照（失敗一律顯示明確原因，不再吞成「此功能尚未開放」）。
// 資料庫函式本來就回中文訊息；這裡是畫面與 API 在拿不到訊息（例如網路層錯誤）時的後備，並讓測試能斷言每個代碼都有白話。

export const VENDOR_CODE_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "請先登入",
  PERMISSION_DENIED: "沒有權限執行這個操作",
  NOT_FOUND: "找不到這筆資料，可能已被移除",
  STALE: "這筆資料剛被其他人修改，請重新載入後再操作",
  EXPECTED_REQUIRED: "缺少版本資訊，請重新載入後再操作",
  BAD_PAYLOAD: "送出的資料格式錯誤",
  BAD_FILTER: "篩選條件錯誤",
  NAME_REQUIRED: "請填寫名稱",
  VENDOR_TYPE: "廠商類型只能是公司、工作室或個人",
  STATUS: "狀態值錯誤",
  TAX_ID_REQUIRED: "公司與工作室請填寫 8 碼統一編號（個人可留空）",
  TAX_ID_FORMAT: "統一編號要是 8 碼數字",
  TAX_ID_DUPLICATE: "這個統一編號已經登錄在其他廠商，同一個統編不能重複建立",
  EMAIL_FORMAT: "Email 格式不正確",
  CONTRACT_DATES: "合約到期日不能早於合作開始日",
  CATEGORY_NOT_FOUND: "找不到勾選的服務分類，請重新整理後再試",
  CATEGORY_INACTIVE: "勾選的服務分類已停用，不能新勾選",
  REGION_NOT_FOUND: "找不到勾選的服務區域，請重新整理後再試",
  REGION_INACTIVE: "勾選的服務區域已停用，不能新勾選",
  CODE_LOCKED: "代碼建立後不能修改",
  CODE_FORMAT: "代碼只能用英文字母、數字、底線與連字號（最長 30 字）",
  CODE_DUPLICATE: "這個代碼已經被使用",
  PARENT_NOT_FOUND: "找不到上層項目",
  PARENT_CYCLE: "上層不能是自己或自己底下的項目",
  REGION_TYPE: "區域類型只能是國家、大區、縣市或行政區",
  DATE_FORMAT: "日期格式要是 YYYY-MM-DD",
  FIELD_TYPE: "欄位格式錯誤",
  FIELD_TOO_LONG: "欄位內容太長",
  FIELD_TOO_MANY: "選的項目太多",
  TOO_MANY: "一次帶的項目太多",
  BUSY: "系統忙碌中，請稍後重試",
  DUPLICATE: "資料重複，請重新整理畫面後再試",
  VENDOR_INACTIVE: "這個廠商目前不是「合作中」狀態，不能選用",
  VENDOR_NOT_FOUND: "找不到這個廠商",
};

export function vendorErrorMessage(code: string | null | undefined, fallback = "操作失敗，請稍後重試"): string {
  return (code && VENDOR_CODE_MESSAGES[code]) || fallback;
}

export type VendorWarning = {
  code: "NAME_SIMILAR" | "TAX_CHECKSUM" | "OPEN_DOCS";
  message: string;
  vendors?: Array<{ id: string; name: string; status: string }>;
  open_purchase_orders?: number;
  open_work_orders?: number;
};

/** 提醒的白話文字（畫面顯示用）；資料庫已附 message，這裡在沒有 message 時組出同樣意思。 */
export function describeWarning(w: VendorWarning): string {
  if (w.message) return w.message;
  if (w.code === "NAME_SIMILAR") return `已經有名稱相近的廠商（${(w.vendors || []).map((v) => v.name).join("、")}），請確認是否重複建立`;
  if (w.code === "TAX_CHECKSUM") return "統一編號的檢查碼不符，請確認是否輸入正確";
  return `這個廠商還有 ${w.open_purchase_orders ?? 0} 張未結採購單、${w.open_work_orders ?? 0} 張進行中工單`;
}
