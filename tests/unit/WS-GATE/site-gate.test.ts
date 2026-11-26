import { describe, it, expect } from "vitest";
import {
  DEV_REF,
  evaluateGate,
  allowedOrigin,
  devMockEnabled,
  environmentName,
} from "../../../lib/workspace/site-gate";

const PROD = "abcdefghijklmnopqrst";
const jwt = (ref: string, role: string) =>
  `h.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.s`;
type E = Record<string, string | undefined>;
const base = (ref: string, extra: E = {}): E => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  EXPECTED_SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(ref, "anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "service_role"),
  WORKSPACE_ENABLED: "true",
  ...extra,
});
const prod = (extra: E = {}) =>
  base(PROD, { VERCEL_ENV: "production", WORKSPACE_ALLOWED_REFS: PROD, ...extra });

describe("evaluateGate", () => {
  it("kill switch", () => {
    expect(evaluateGate(prod({ WORKSPACE_ENABLED: undefined })).reason).toBe("disabled");
    expect(evaluateGate(prod({ WORKSPACE_ENABLED: "false" })).reason).toBe("disabled");
    expect(evaluateGate(prod({ WORKSPACE_ENABLED: "TRUE" })).open).toBe(false);
    expect(evaluateGate(prod()).open).toBe(true);
  });
  it("legacy alias only on DEV ref", () => {
    const dev = base(DEV_REF, { WORKSPACE_ENABLED: undefined, WORKSPACE_DEV_ENABLED: "true" });
    expect(evaluateGate(dev).open).toBe(true);
    const p = prod({ WORKSPACE_ENABLED: undefined, WORKSPACE_DEV_ENABLED: "true" });
    expect(evaluateGate(p).reason).toBe("disabled");
  });
  it("explicit false beats alias", () => {
    const e = base(DEV_REF, { WORKSPACE_ENABLED: "false", WORKSPACE_DEV_ENABLED: "true" });
    expect(evaluateGate(e).open).toBe(false);
  });
  it("env consistency", () => {
    expect(evaluateGate(prod({ EXPECTED_SUPABASE_PROJECT_REF: "other" })).reason).toBe("expected_ref_mismatch");
    expect(evaluateGate(prod({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("other", "anon") })).reason).toBe("key_mismatch");
    expect(evaluateGate(prod({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(PROD, "service_role") })).reason).toBe("key_mismatch");
    expect(evaluateGate(prod({ SUPABASE_SERVICE_ROLE_KEY: jwt(PROD, "anon") })).reason).toBe("key_mismatch");
    expect(evaluateGate(prod({ SUPABASE_SERVICE_ROLE_KEY: "garbage" })).reason).toBe("key_mismatch");
    expect(evaluateGate(prod({ NEXT_PUBLIC_SUPABASE_URL: undefined })).open).toBe(false);
    const noUrl = prod({ NEXT_PUBLIC_SUPABASE_URL: undefined, EXPECTED_SUPABASE_PROJECT_REF: "invalid", WORKSPACE_ALLOWED_REFS: "invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("invalid", "anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("invalid", "service_role") });
    expect(evaluateGate(noUrl).open).toBe(false);
    expect(evaluateGate(prod({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "a." + Buffer.from("null").toString("base64url") + ".s" })).reason).toBe("key_mismatch");
  });
  it("production allowlist", () => {
    expect(evaluateGate(prod({ WORKSPACE_ALLOWED_REFS: `x, ${PROD}` })).open).toBe(true);
    expect(evaluateGate(prod({ WORKSPACE_ALLOWED_REFS: "x" })).reason).toBe("ref_not_allowed");
    expect(evaluateGate(prod({ WORKSPACE_ALLOWED_REFS: "" })).reason).toBe("ref_not_allowed");
    expect(evaluateGate(prod({ WORKSPACE_ALLOWED_REFS: undefined })).reason).toBe("ref_not_allowed");
  });
  it("production refuses DEV ref even if allowlisted", () => {
    const e = base(DEV_REF, { VERCEL_ENV: "production", WORKSPACE_ALLOWED_REFS: DEV_REF });
    expect(evaluateGate(e).reason).toBe("dev_ref_in_production");
  });
  it("preview only DEV ref", () => {
    expect(evaluateGate(base(DEV_REF, { VERCEL_ENV: "preview" })).open).toBe(true);
    const e = base(PROD, { VERCEL_ENV: "preview", WORKSPACE_ALLOWED_REFS: PROD });
    expect(evaluateGate(e).reason).toBe("preview_not_dev_ref");
  });
  it("local only DEV ref", () => {
    expect(evaluateGate(base(DEV_REF)).open).toBe(true);
    expect(evaluateGate(base(PROD)).reason).toBe("ref_mismatch");
  });
  it("audience fails closed", () => {
    expect(evaluateGate(prod()).audience).toBe("admin_only");
    expect(evaluateGate(prod({ WORKSPACE_AUDIENCE: "all" })).audience).toBe("all");
    expect(evaluateGate(prod({ WORKSPACE_AUDIENCE: "admin_only" })).audience).toBe("admin_only");
    expect(evaluateGate(prod({ WORKSPACE_AUDIENCE: "everyone" })).audience).toBe("admin_only");
    expect(evaluateGate(prod({ WORKSPACE_AUDIENCE: "" })).audience).toBe("admin_only");
  });
  it("result carries no secrets", () => {
    const r = evaluateGate(prod());
    expect(Object.keys(r).sort()).toEqual(["audience", "deployment", "open", "reason", "urlRef"]);
    expect(r.deployment).toBe("production");
    expect(r.urlRef).toBe(PROD);
  });
});

describe("allowedOrigin", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  it("local defaults only without VERCEL_ENV", () => {
    expect(allowedOrigin({})).toEqual(["http://localhost:5173", "http://localhost:3002"]);
    expect(allowedOrigin({ VERCEL_ENV: "production" })).toEqual([]);
    expect(allowedOrigin({ VERCEL_ENV: "preview" })).toEqual([]);
  });
  it("WORKSPACE_ORIGIN list plus own origin", () => {
    const o = allowedOrigin(
      { VERCEL_ENV: "production", WORKSPACE_ORIGIN: "https://a.com/, https://b.com" },
      h({ "x-forwarded-host": "a.com", "x-forwarded-proto": "https" }),
    );
    expect(o).toEqual(["https://a.com", "https://b.com"]);
  });
  it("own origin from host header and plain-object headers", () => {
    expect(allowedOrigin({ VERCEL_ENV: "production" }, { host: "x.com" })).toEqual(["https://x.com"]);
    expect(allowedOrigin({}, { host: "localhost:3002" })).toContain("http://localhost:3002");
  });
  it("preview adds VERCEL_URL", () => {
    const o = allowedOrigin(
      { VERCEL_ENV: "preview", VERCEL_URL: "p-1.vercel.app" },
      h({ "x-forwarded-host": "p-1.vercel.app" }),
    );
    expect(o).toEqual(["https://p-1.vercel.app"]);
    expect(allowedOrigin({ VERCEL_ENV: "production", VERCEL_URL: "p.vercel.app" })).toEqual([]);
  });
});

describe("mocks and environment name", () => {
  it("mock tied to WORKSPACE_DEV_ENABLED + DEV ref only", () => {
    expect(devMockEnabled(base(DEV_REF, { WORKSPACE_DEV_ENABLED: "true" }))).toBe(true);
    expect(devMockEnabled(base(DEV_REF))).toBe(false);
    expect(devMockEnabled(base(PROD, { WORKSPACE_DEV_ENABLED: "true" }))).toBe(false);
    expect(devMockEnabled(prod())).toBe(false);
    expect(devMockEnabled(base(DEV_REF, { WORKSPACE_DEV_ENABLED: "true", VERCEL_ENV: "production" }))).toBe(false);
    expect(devMockEnabled(base(DEV_REF, { WORKSPACE_DEV_ENABLED: "true", VERCEL_ENV: "preview" }))).toBe(true);
  });
  it("environmentName", () => {
    expect(environmentName(base(DEV_REF))).toBe("DEV");
    expect(environmentName(prod())).toBe("PROD");
  });
});
