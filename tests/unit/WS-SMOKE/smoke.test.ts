import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const smoke = require("../../../scripts/workspace-prod-smoke.cjs");

type Mode = "open" | "closed" | "notopen";
let mode: Mode = "open";
let server: http.Server;
let base = "";
const methods: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    methods.push(req.method || "");
    const url = req.url || "";
    const authed = (req.headers.cookie || "") === "sb=ok";
    const json = (s: number, b: unknown) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (url === "/workspace/index.html") {
      res.writeHead(200, { "cache-control": "no-store", "content-type": "text/html" });
      return res.end('<script src="./assets/index-abc.js"></script>');
    }
    if (url === "/workspace/assets/index-abc.js") {
      res.writeHead(200, { "cache-control": "public, max-age=31536000, immutable" });
      return res.end("x");
    }
    if (url === "/login") {
      res.writeHead(200);
      return res.end("login");
    }
    if (url === "/") {
      res.writeHead(200);
      return res.end("legacy");
    }
    if (url.startsWith("/api/workspace/")) {
      if (mode === "closed") return json(503, { error: "closed" });
      if (!authed) return json(401, { error: "no" });
      if (url === "/api/workspace/session") return json(200, { open: mode === "open", siteState: { enabled: true, audience: "admin_only" } });
      return mode === "open" ? json(200, {}) : json(403, {});
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const opts = (extra = {}) => ({ baseUrl: base, expectOpen: true, expectClosed: false, allowHttpLocalhost: true, ...extra });
const failures = (r: Array<{ ok: boolean }>) => r.filter((x) => !x.ok);

describe("workspace-prod-smoke", () => {
  it("開放狀態全部通過", async () => {
    mode = "open";
    expect(failures(await smoke.run(opts(), "sb=ok"))).toEqual([]);
  });
  it("非管理員在 admin_only 下：open=false 且 403 被接受", async () => {
    mode = "notopen";
    expect(failures(await smoke.run(opts({ expectOpen: false }), "sb=ok"))).toEqual([]);
  });
  it("預期 open 與實際不符會失敗", async () => {
    mode = "notopen";
    expect(failures(await smoke.run(opts({ expectOpen: true }), "sb=ok")).length).toBeGreaterThan(0);
  });
  it("--expect-closed 模式要求 API 回 503", async () => {
    mode = "closed";
    expect(failures(await smoke.run(opts({ expectClosed: true }), "sb=ok"))).toEqual([]);
    mode = "open";
    expect(failures(await smoke.run(opts({ expectClosed: true }), "sb=ok")).length).toBeGreaterThan(0);
  });
  it("沒給 cookie 時不會通過", async () => {
    mode = "open";
    expect(failures(await smoke.run(opts(), "")).length).toBeGreaterThan(0);
  });
  it("只送過 GET", () => {
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
  it("非 https 被拒絕，除非 localhost 且加旗標", () => {
    expect(smoke.validateBase({ baseUrl: "http://example.com", allowHttpLocalhost: true })).toBeTruthy();
    expect(smoke.validateBase({ baseUrl: "http://localhost:3002", allowHttpLocalhost: false })).toBeTruthy();
    expect(smoke.validateBase({ baseUrl: "http://localhost:3002", allowHttpLocalhost: true })).toBeNull();
    expect(smoke.validateBase({ baseUrl: "https://example.com", allowHttpLocalhost: false })).toBeNull();
  });
  it("原始碼只用 GET、cookie 不出現在命令列參數與輸出", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../scripts/workspace-prod-smoke.cjs"), "utf8");
    const used = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(used).toEqual(["GET"]);
    expect(src).toContain("process.env.WORKSPACE_SMOKE_COOKIE");
    expect(src).not.toMatch(/--cookie/);
    expect(src).not.toMatch(/log\([^)]*cookie/i);
  });
});
