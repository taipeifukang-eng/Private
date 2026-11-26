import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEV_REF } from "../../../lib/workspace/site-gate";
import {
  LEGACY_HREF_KIND,
  kindForLegacyHref,
  newHrefForKind,
  resolveMenuTargets,
} from "../../../lib/workspace/legacy-menu";
import { WORKSPACE_NAV_KINDS } from "../../../lib/workspace/page-kinds";
import { legacyRouteFor } from "../../../lib/workspace/legacy-routes";

const jwt = (ref: string, role: string) => `h.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.s`;
const env = (extra: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
  EXPECTED_SUPABASE_PROJECT_REF: DEV_REF,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(DEV_REF, "anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt(DEV_REF, "service_role"),
  WORKSPACE_ENABLED: "true",
  WORKSPACE_AUDIENCE: "all",
  ...extra,
});
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("resolveMenuTargets", () => {
  it("閘門關閉（沒設開關）：沒有任何新版連結、enabled=false", () => {
    const r = resolveMenuTargets({ isAdmin: true, env: env({ WORKSPACE_ENABLED: undefined }) });
    expect(r).toEqual({ enabled: false, links: {} });
  });
  it("開關是 false：全部維持舊版", () => {
    expect(resolveMenuTargets({ isAdmin: true, env: env({ WORKSPACE_ENABLED: "false" }) }).enabled).toBe(false);
  });
  it("設定不符（ref 對不上）：視為關閉", () => {
    const r = resolveMenuTargets({ isAdmin: true, env: env({ EXPECTED_SUPABASE_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }) });
    expect(r.enabled).toBe(false);
  });
  it("admin_only：管理員有連結、非管理員完全沒有（含按鈕）", () => {
    const e = env({ WORKSPACE_AUDIENCE: "admin_only" });
    const admin = resolveMenuTargets({ isAdmin: true, env: e });
    expect(admin.enabled).toBe(true);
    expect(admin.links["/my-tasks"]).toBe("/workspace/index.html#/open/my-tasks");
    expect(resolveMenuTargets({ isAdmin: false, env: e })).toEqual({ enabled: false, links: {} });
  });
  it("audience 沒設或無效值：視為 admin_only（非管理員沒連結）", () => {
    expect(resolveMenuTargets({ isAdmin: false, env: env({ WORKSPACE_AUDIENCE: undefined }) }).enabled).toBe(false);
    expect(resolveMenuTargets({ isAdmin: false, env: env({ WORKSPACE_AUDIENCE: "bogus" }) }).enabled).toBe(false);
  });
  it("all：一般使用者也有連結", () => {
    const r = resolveMenuTargets({ isAdmin: false, env: env() });
    expect(r.enabled).toBe(true);
    expect(Object.keys(r.links).length).toBe(Object.keys(LEGACY_HREF_KIND).length);
  });
  it("備援命中：該頁維持舊版，其他頁不受影響", () => {
    const r = resolveMenuTargets({ isAdmin: false, env: env(), fallbackKinds: new Set(["monthly"]) });
    expect(r.links["/monthly-status"]).toBeUndefined();
    expect(r.links["/my-tasks"]).toBeDefined();
  });
  it("多對一：/admin/promotion-management 只對應 movement-management", () => {
    expect(kindForLegacyHref("/admin/promotion-management")).toBe("movement-management");
    const r = resolveMenuTargets({ isAdmin: true, env: env() });
    expect(r.links["/admin/promotion-management"]).toBe(newHrefForKind("movement-management"));
    const r2 = resolveMenuTargets({ isAdmin: true, env: env(), fallbackKinds: ["movement-management"] });
    expect(r2.links["/admin/promotion-management"]).toBeUndefined();
  });
  it("未知路徑沒有 kind：不會有連結", () => {
    expect(kindForLegacyHref("/not-a-menu")).toBeNull();
    expect(resolveMenuTargets({ isAdmin: true, env: env() }).links["/not-a-menu"]).toBeUndefined();
  });
});

describe("對照表正確性", () => {
  it("每個 kind 都是導覽 kind，且舊版路由與選單路徑一致", () => {
    for (const [href, kind] of Object.entries(LEGACY_HREF_KIND)) {
      expect((WORKSPACE_NAV_KINDS as readonly string[]).includes(kind), kind).toBe(true);
      expect(legacyRouteFor(kind), `${href} -> ${kind}`).toBe(href);
    }
  });
  it("每個路徑都真的出現在舊 Navbar 原始碼", () => {
    const nav = read("components/Navbar.tsx");
    for (const href of Object.keys(LEGACY_HREF_KIND)) expect(nav, href).toContain(href);
  });
});

describe("接線（原始碼）", () => {
  it("layout 用 loadMenuTargets，不再有寫死的 DEV ref 或 workspacePreviewEnabled", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("loadMenuTargets");
    expect(layout).toContain("force-dynamic");
    expect(layout).not.toContain(DEV_REF);
    expect(layout).not.toContain("workspacePreviewEnabled");
  });
  it("Navbar：新版連結用一般 <a>，按鈕只看 workspaceEnabled", () => {
    const nav = read("components/Navbar.tsx");
    expect(nav).toContain("workspaceLinks");
    expect(nav).toMatch(/<a href=\{target\}/);
    expect(nav).toContain("{workspaceEnabled && (");
    expect(nav).not.toContain(DEV_REF);
  });
  it("閘門關閉時載入器不碰資料庫（先檢查閘門再建立 adminClient）", () => {
    const s = read("lib/workspace/legacy-menu-server.ts");
    const fn = s.slice(s.indexOf("export async function loadMenuTargets"));
    expect(fn.indexOf("if (!gate.open) return closed")).toBeGreaterThan(-1);
    expect(fn.indexOf("if (!gate.open) return closed")).toBeLessThan(fn.indexOf("adminClient()"));
    expect(fn).toContain("catch");
  });
  it("Vue 深連結接受導覽 kind", () => {
    const app = read("vue-workspace/src/App.vue");
    expect(app).toContain("...WORKSPACE_NAV_KINDS");
    expect(app).toContain("const OPEN_LINK_KINDS");
  });
});
