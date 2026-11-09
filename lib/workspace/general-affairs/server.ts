// 總務 workspace API 共用：錯誤對應、RPC 結果解析、路由包裝。
// 所有寫入都走伺服端，用「使用者自己的登入身分」呼叫（RLS 與資料庫函式用 auth.uid() 判斷權限，與舊版一致）。
import { NextRequest } from "next/server";
import { checkOrigin, context, respond, WorkspaceError, type Context } from "../server";

export class GaError extends WorkspaceError {
  constructor(
    status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(status, message);
  }
}

export function gaFailed(error: unknown) {
  if (error instanceof GaError) return respond({ error: error.message, ...error.extra }, error.status);
  if (error instanceof WorkspaceError) return respond({ error: error.message }, error.status);
  return respond({ error: "服務暫時無法使用，請重試" }, 500);
}

const HAS_CJK = /[㐀-鿿]/;

/** PostgREST／Postgres 錯誤 -> 白話訊息。資料庫函式與觸發器自己丟的中文訊息可以原樣顯示；其餘英文內部訊息一律不外露。 */
export function dbError(error: any): GaError {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "23505") return new GaError(409, "代碼或資料重複，已有相同的資料（含已停用的）");
  if (code === "23503") return new GaError(409, "這筆資料仍被其他資料使用，不能這樣處理");
  if (code === "P0409") return new GaError(409, message || "資料已被其他人修改，請重新載入", { code: "STALE" });
  if (code === "42501") return new GaError(403, "沒有權限執行這個操作");
  if (code === "22P02" || code === "22007") return new GaError(400, "資料格式錯誤");
  if (code === "23514") return new GaError(400, HAS_CJK.test(message) ? message : "資料不符合規則，請檢查欄位");
  if (code === "P0001" && HAS_CJK.test(message)) return new GaError(400, message);
  if (HAS_CJK.test(message)) return new GaError(400, message);
  return new GaError(503, "資料讀取或寫入失敗，請稍後重試");
}

export async function must<T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const res = await query;
  if (res.error) throw dbError(res.error);
  return res.data;
}

/** 資料庫函式回傳 {ok,status,data,error,...}：ok 取 data，否則丟出帶狀態碼的錯誤（其餘欄位如 usage 一併回傳）。 */
export async function rpc(ctx: Context, name: string, args: Record<string, unknown>) {
  const { data, error } = await (ctx.auth as any).rpc(name, args);
  if (error) throw dbError(error);
  if (!data || data.ok !== true) {
    const { ok: _ok, status, error: message, ...extra } = (data || {}) as Record<string, unknown>;
    throw new GaError(Number(status) || 500, String(message || "操作失敗"), extra);
  }
  return data as { ok: true; status: number; data: any; [k: string]: any };
}

export async function body(request: NextRequest) {
  const text = await request.text();
  if (text.length > 1_000_000) throw new GaError(413, "送出的內容太大");
  if (!text.trim()) return {} as Record<string, any>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, any>;
  } catch {
    throw new GaError(400, "送出的內容格式錯誤");
  }
}

export function bad(message: string): never {
  throw new GaError(400, message);
}
/** 把舊版驗證函式丟出的 Error（中文訊息）轉成 400。 */
export function validated<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GaError || e instanceof WorkspaceError) throw e;
    throw new GaError(400, e instanceof Error && e.message ? e.message : "資料格式錯誤");
  }
}

export type Handler = (ctx: Context, request: NextRequest, segments: string[]) => Promise<Response>;

export async function runGa(request: NextRequest, segments: string[], dispatch: Handler) {
  try {
    if (request.method !== "GET") checkOrigin(request);
    const ctx = await context({ profile: false });
    return await dispatch(ctx, request, segments);
  } catch (error) {
    return gaFailed(error);
  }
}

export { respond };
export type { Context };
