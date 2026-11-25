import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const doc = readFileSync(join(root, "docs/vue-workspace/go-live/vercel-env.md"), "utf8");
const example = readFileSync(join(root, ".env.example"), "utf8");

const gateNames = [
  "WORKSPACE_ENABLED",
  "WORKSPACE_ALLOWED_REFS",
  "WORKSPACE_AUDIENCE",
  "WORKSPACE_USE_EXISTING_SESSION",
  "WORKSPACE_ORIGIN",
  "WORKSPACE_PUBLIC_REDIRECT_ENABLED",
  "EXPECTED_SUPABASE_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
];
const mockNames = ["WORKSPACE_DEV_ENABLED", "WORKSPACE_CALENDAR_MOCK", "WORKSPACE_AUTH_MAIL_MOCK", "WORKSPACE_OPENAI_MOCK"];

describe("Vercel 環境變數文件", () => {
  it("文件涵蓋所有閘門與必要變數名稱", () => {
    for (const n of [...gateNames, ...mockNames]) expect(doc).toContain(n);
  });
  it(".env.example 只有名稱、沒有值", () => {
    for (const line of example.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      expect(line).toMatch(/^[A-Z0-9_]+=$/);
    }
  });
  it(".env.example 列出必要名稱，且模擬開關只以註解出現", () => {
    for (const n of gateNames) expect(example).toMatch(new RegExp(`^${n}=$`, "m"));
    for (const n of mockNames) expect(example).not.toMatch(new RegExp(`^${n}=`, "m"));
  });
  it("文件說明範圍、Redeploy 與不要設 NODE_ENV", () => {
    for (const w of ["Redeploy", "Production", "Preview", "NODE_ENV", "All Environments"]) expect(doc).toContain(w);
  });
  it("文件不含看起來像金鑰的字串", () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(doc).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
  });
});
