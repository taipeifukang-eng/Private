// 工作台入口閘門：純函式，不依賴 Next。所有「是否開放」的判斷集中在這裡。
// 注意：訊息與回傳值不得帶出任何環境變數的值。

export const DEV_REF = "mjpdfpxqttbhzeimmtqr";

export type GateEnv = Record<string, string | undefined>;
export type GateAudience = "admin_only" | "all";
export type GateDeployment = "production" | "preview" | "local";
export type GateReason =
  | "ok"
  | "disabled"
  | "ref_mismatch"
  | "expected_ref_mismatch"
  | "key_mismatch"
  | "ref_not_allowed"
  | "dev_ref_in_production"
  | "preview_not_dev_ref";

export interface GateResult {
  open: boolean;
  reason: GateReason;
  audience: GateAudience;
  urlRef: string;
  deployment: GateDeployment;
}

export function urlRefOf(env: GateEnv): string {
  try {
    return new URL(env.NEXT_PUBLIC_SUPABASE_URL || "http://invalid").hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function deploymentOf(env: GateEnv): GateDeployment {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "local";
}

export function audienceOf(env: GateEnv): GateAudience {
  return env.WORKSPACE_AUDIENCE === "all" ? "all" : "admin_only";
}

/** 開關：WORKSPACE_ENABLED 優先；舊別名 WORKSPACE_DEV_ENABLED 只在連到 DEV 資料庫時有效。 */
export function killSwitchOn(env: GateEnv): boolean {
  if (env.WORKSPACE_ENABLED !== undefined) return env.WORKSPACE_ENABLED === "true";
  return env.WORKSPACE_DEV_ENABLED === "true" && urlRefOf(env) === DEV_REF;
}

function jwtClaims(token: string | undefined): { ref?: unknown; role?: unknown } | null {
  try {
    return JSON.parse(Buffer.from((token || "").split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
}

export function allowedRefs(env: GateEnv): string[] {
  return (env.WORKSPACE_ALLOWED_REFS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function evaluateGate(env: GateEnv): GateResult {
  const urlRef = urlRefOf(env);
  const deployment = deploymentOf(env);
  const audience = audienceOf(env);
  const result = (open: boolean, reason: GateReason): GateResult => ({
    open,
    reason,
    audience,
    urlRef,
    deployment,
  });

  if (!killSwitchOn(env)) return result(false, "disabled");
  if (!urlRef || env.EXPECTED_SUPABASE_PROJECT_REF !== urlRef)
    return result(false, "expected_ref_mismatch");
  for (const [name, role] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service_role"],
  ] as const) {
    const claims = jwtClaims(env[name]);
    if (!claims || claims.ref !== urlRef || claims.role !== role)
      return result(false, "key_mismatch");
  }
  if (deployment === "production") {
    if (urlRef === DEV_REF) return result(false, "dev_ref_in_production");
    if (!allowedRefs(env).includes(urlRef)) return result(false, "ref_not_allowed");
  } else if (urlRef !== DEV_REF) {
    return result(false, deployment === "preview" ? "preview_not_dev_ref" : "ref_mismatch");
  }
  return result(true, "ok");
}

type HeaderLike = { get(name: string): string | null } | Record<string, string | undefined>;
function header(headers: HeaderLike | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function")
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  return (headers as Record<string, string | undefined>)[name];
}

/** 允許的 Origin：WORKSPACE_ORIGIN（逗號清單）＋請求自己的網域；本機預設值只在 VERCEL_ENV 為空時給。 */
export function allowedOrigin(env: GateEnv, headers?: HeaderLike): string[] {
  const list = (env.WORKSPACE_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const host = (header(headers, "x-forwarded-host") || header(headers, "host") || "")
    .split(",")[0]
    .trim();
  if (host) {
    const proto = (header(headers, "x-forwarded-proto") || "").split(",")[0].trim();
    const scheme = proto || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
    list.push(`${scheme}://${host}`);
  }
  if (deploymentOf(env) === "preview" && env.VERCEL_URL) list.push(`https://${env.VERCEL_URL}`);
  if (deploymentOf(env) === "local") list.push("http://localhost:5173", "http://localhost:3002");
  return Array.from(new Set(list));
}

/** 模擬服務（行事曆／信件／OpenAI）：只在 WORKSPACE_DEV_ENABLED 且連 DEV 資料庫時開，不受正式開關影響。 */
export function devMockEnabled(env: GateEnv): boolean {
  return env.WORKSPACE_DEV_ENABLED === "true" && urlRefOf(env) === DEV_REF;
}

/** 環境名稱，給 session 回傳用。 */
export function environmentName(env: GateEnv): "DEV" | "PROD" {
  return urlRefOf(env) === DEV_REF ? "DEV" : "PROD";
}
