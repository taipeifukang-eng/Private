import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const doc = readFileSync(join(process.cwd(), "docs/vue-workspace/go-live/owner-checklist.md"), "utf8");

describe("老闆版上線檢查表", () => {
  it("涵蓋各階段與關鍵變數名稱", () => {
    for (const k of ["WORKSPACE_ENABLED", "WORKSPACE_AUDIENCE", "admin_only", "Redeploy", "Instant Rollback", "WORKSPACE_ALLOWED_REFS", "簽核表", "60 秒"]) {
      expect(doc).toContain(k);
    }
  });
  it("G46 與 B1 與部署一起上，不是 12/15", () => {
    expect(doc).toContain("一起上");
    expect(doc).not.toMatch(/12\/15/);
  });
  it("順序：資料庫指令（G46、B1、96）在合併之前，並說明原因與 96 前置檢查閘門", () => {
    const sqlAt = doc.indexOf("## 二、上線日 步驟 1：先跑資料庫指令");
    const mergeAt = doc.indexOf("## 三、上線日 步驟 2：合併");
    expect(sqlAt).toBeGreaterThan(0);
    expect(mergeAt).toBeGreaterThan(sqlAt);
    const sqlPart = doc.slice(sqlAt, mergeAt);
    for (const k of ["G46", "B1", "96", "只加東西、不拆東西", "前置檢查", "不要再重跑 M9 步驟 50"]) expect(sqlPart).toContain(k);
  });
  it("不含任何金鑰樣式內容", () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(doc).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
  });
});
