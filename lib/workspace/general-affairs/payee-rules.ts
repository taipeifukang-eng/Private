// G4 同仁代墊與同仁匯款帳戶規則（純函式，無資料庫相依；API、Vue 頁面與單元測試共用）。
// 與資料庫函式 ga_ib1_payout_account_save、ga_ws_payout_account_*、ga_ws_pay_employee_options、ga_ws_pay_my_reimbursements 逐條對齊：
// 帳戶欄位格式、只露末四碼的遮蔽、誰看得到完整帳戶（廠商帳務檢視者與同仁本人）、同仁挑選與「我的代墊款」的回傳欄位。
export const PAYOUT_ACCOUNT_RE = /^[0-9 -]{6,30}$/;
const text = (v: unknown) => String(v ?? "").trim();

export type PayoutAccount = { bank_name: string; bank_branch: string | null; bank_account: string; bank_account_name: string };

/** 同仁匯款帳戶：銀行名稱、帳號、戶名必填，分行選填；帳號只能是數字、空白與連字號（6 到 30 碼）。沒帶的欄位（修改時）不動。 */
export function validatePayoutAccountPayload(raw: Record<string, any>, creating = true): Partial<PayoutAccount> {
  for (const k of Object.keys(raw)) if (!["bank_name", "bank_branch", "bank_account", "bank_account_name"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const out: Partial<PayoutAccount> = {};
  const need = (k: keyof PayoutAccount, label: string, max: number) => {
    if (!creating && !(k in raw)) return;
    const s = text(raw[k]);
    if (!s) throw new Error(`請填寫${label}`);
    if (s.length > max) throw new Error(`${label}不可超過 ${max} 個字`);
    (out as Record<string, unknown>)[k] = s;
  };
  need("bank_name", "銀行名稱", 60);
  need("bank_account", "帳號", 40);
  need("bank_account_name", "戶名", 60);
  if (out.bank_account !== undefined && !PAYOUT_ACCOUNT_RE.test(out.bank_account)) throw new Error("帳號只能是數字（可含空白與連字號），長度 6 到 30 碼");
  if (creating || "bank_branch" in raw) {
    const b = text(raw.bank_branch);
    if (b.length > 60) throw new Error("分行不可超過 60 個字");
    out.bank_branch = b || null;
  }
  return out;
}

/** 帳號末四碼（只留數字）。 */
export function accountLast4(account: unknown): string | null {
  const d = String(account ?? "").replace(/[^0-9]/g, "");
  return d ? d.slice(-4) : null;
}

/** 誰能看到同仁的完整匯款帳戶：請款管理加廠商帳務檢視，或同仁本人；其他人只看到末四碼。 */
export function canSeePayoutAccount(viewer: { id: string; canManagePay: boolean; vendorView: boolean }, ownerProfileId: string): boolean {
  return viewer.id === ownerProfileId || (viewer.canManagePay && viewer.vendorView);
}

/** 對外顯示的帳戶：沒有權限時整個帳戶回空，附 masked 與末四碼。 */
export function maskPayoutAccount(account: Partial<PayoutAccount> | null | undefined, visible: boolean) {
  const last4 = accountLast4(account?.bank_account);
  if (visible) return { account: account ?? null, masked: false, last4 };
  return { account: null, masked: true, last4 };
}

/** 「我的代墊款」清單的欄位：只有這些，不含廠商帳戶、統編與草稿。 */
export const MY_REIMBURSEMENT_FIELDS = ["amount_total", "created_at", "id", "paid_date", "pr_no", "source", "status", "vendor_name"] as const;
export function pickMyReimbursement(row: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const k of MY_REIMBURSEMENT_FIELDS) out[k] = row[k] ?? null;
  return out;
}
