import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyHomeHref, sessionNotOpen, showAdminOnlyBanner, siteNoticeFor } from "../../../vue-workspace/src/site-state";

const read = (p: string) => readFileSync(p, "utf8");

describe("WP6 新版尚未開放／暫時關閉判斷", () => {
  it("503 為暫時關閉，403 NOT_OPEN_YET 為尚未開放，其餘為 null", () => {
    expect(siteNoticeFor(503, { error: "新版暫時關閉" })).toBe("closed");
    expect(siteNoticeFor(503, { error: "新版工作台設定不符，暫時無法使用" })).toBe("closed");
    expect(siteNoticeFor(503, {})).toBeNull();
    expect(siteNoticeFor(503, { error: "檔案上傳失敗，請稍後重試" })).toBeNull();
    expect(siteNoticeFor(403, { error: "NOT_OPEN_YET" })).toBe("not-open");
    expect(siteNoticeFor(403, { error: "沒有權限" })).toBeNull();
    expect(siteNoticeFor(401, { error: "NOT_OPEN_YET" })).toBeNull();
    expect(siteNoticeFor(500, null)).toBeNull();
  });
  it("session open:false 才算尚未開放", () => {
    expect(sessionNotOpen({ open: false })).toBe(true);
    expect(sessionNotOpen({ open: true })).toBe(false);
    expect(sessionNotOpen({})).toBe(false);
    expect(sessionNotOpen(null)).toBe(false);
  });
  it("只有 admin_only 且是管理員才顯示橫幅", () => {
    expect(showAdminOnlyBanner({ audience: "admin_only" }, true)).toBe(true);
    expect(showAdminOnlyBanner({ audience: "admin_only" }, false)).toBe(false);
    expect(showAdminOnlyBanner({ audience: "all" }, true)).toBe(false);
    expect(showAdminOnlyBanner(undefined, true)).toBe(false);
  });
  it("舊版首頁連結：整合模式同網域，獨立預覽指向 3002", () => {
    expect(legacyHomeHref(true)).toBe("/");
    expect(legacyHomeHref(undefined)).toBe("/");
    expect(legacyHomeHref(false)).toBe("http://localhost:3002/");
  });
  it("App.vue 與 api.ts 已接線，且不再寫死測試區標籤", () => {
    const app = read("vue-workspace/src/App.vue");
    const api = read("vue-workspace/src/api.ts");
    expect(api).toContain("siteNoticeFor");
    expect(app).toContain("<SiteNotice");
    expect(app).toContain("admin-only-banner");
    expect(app).toContain("目前僅管理員可用");
    expect(app).not.toMatch(/<span class="environment">測試區<\/span>/);
    expect(read("vue-workspace/src/components/SiteNotice.vue")).toContain("前往舊版首頁");
  });
});
