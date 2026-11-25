#!/usr/bin/env node
/* 正式區唯讀冒煙檢查：只送 GET，不寫入任何資料。
 * 用法：node scripts/workspace-prod-smoke.cjs --base-url https://<host> [--expect-open=true|false] [--expect-closed] [--allow-http-localhost]
 * 登入 cookie 只從環境變數 WORKSPACE_SMOKE_COOKIE 讀取（不接受命令列參數、不會印出）。
 * 輸出只有狀態碼與資料形狀，不輸出回應內容。 */
"use strict";
const http = require("http");
const https = require("https");

// 唯一的對外請求入口：只允許 GET。
function get(baseUrl, path, cookie) {
  const url = new URL(path, baseUrl);
  const lib = url.protocol === "https:" ? https : http;
  const headers = { accept: "*/*", "user-agent": "workspace-smoke/1" };
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function parseArgs(argv) {
  const o = { baseUrl: "", expectOpen: true, expectClosed: false, allowHttpLocalhost: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") o.baseUrl = argv[++i] || "";
    else if (a.startsWith("--base-url=")) o.baseUrl = a.slice(11);
    else if (a === "--expect-closed") o.expectClosed = true;
    else if (a === "--allow-http-localhost") o.allowHttpLocalhost = true;
    else if (a.startsWith("--expect-open=")) o.expectOpen = a.slice(14) !== "false";
    else throw new Error("未知參數：" + a);
  }
  return o;
}

function validateBase(o) {
  let u;
  try { u = new URL(o.baseUrl); } catch { return "請用 --base-url 指定完整網址"; }
  if (u.protocol === "https:") return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "http:" && local && o.allowHttpLocalhost) return null;
  return "只接受 https 網址（本機測試請加 --allow-http-localhost）";
}

const API_PATHS = ["/api/workspace/home", "/api/workspace/dashboard", "/api/workspace/stores"];

function findAsset(html) {
  const m = /(?:src|href)="((?:\.\/|\/workspace\/)assets\/[^"]+)"/.exec(html);
  if (!m) return null;
  return m[1].startsWith("./") ? "/workspace/" + m[1].slice(2) : m[1];
}

async function run(o, cookie, log = () => {}) {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); log((ok ? "PASS " : "FAIL ") + name + " (" + detail + ")"); };
  const safe = async (p, c) => { try { return await get(o.baseUrl, p, c); } catch (e) { return { status: 0, headers: {}, body: "", error: e.message }; } };

  const idx = await safe("/workspace/index.html");
  check("入口頁 200 且 no-store", idx.status === 200 && /no-store/i.test(String(idx.headers["cache-control"] || "")), "status=" + idx.status);

  const asset = findAsset(idx.body);
  if (!asset) check("找到靜態資源連結", false, "index.html 內沒有 assets 連結");
  else {
    const a = await safe(asset);
    check("靜態資源 200 且 immutable", a.status === 200 && /immutable/i.test(String(a.headers["cache-control"] || "")), "status=" + a.status);
  }

  const legacy = await safe("/");
  check("舊版首頁 200", legacy.status === 200, "status=" + legacy.status);

  if (!cookie) {
    check("有提供登入 cookie", false, "未設定 WORKSPACE_SMOKE_COOKIE，略過登入後檢查");
  } else if (o.expectClosed) {
    for (const p of ["/api/workspace/session", ...API_PATHS]) {
      const r = await safe(p, cookie);
      check("關閉模式 " + p + " 為 503", r.status === 503, "status=" + r.status);
    }
  } else {
    const s = await safe("/api/workspace/session", cookie);
    let json = null;
    try { json = JSON.parse(s.body); } catch { /* 只看形狀 */ }
    const hasState = !!json && typeof json === "object" && !!json.siteState;
    check("session 200 且有 siteState", s.status === 200 && hasState, "status=" + s.status + " siteState=" + hasState);
    check("session open 符合預期(" + o.expectOpen + ")", !!json && json.open === o.expectOpen, "open=" + (json ? String(json.open) : "n/a"));
    for (const p of API_PATHS) {
      const r = await safe(p, cookie);
      const okStatus = (r.status >= 200 && r.status < 300) || (!o.expectOpen && r.status === 403);
      check("唯讀端點 " + p, okStatus, "status=" + r.status);
    }
  }

  for (const p of ["/api/workspace/session", ...API_PATHS]) {
    const r = await safe(p);
    const expected = o.expectClosed ? 503 : 401;
    check("無 cookie " + p + " 回 " + expected, r.status === expected, "status=" + r.status);
  }
  return results;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  const bad = validateBase(o);
  if (bad) { console.error(bad); return 2; }
  const cookie = process.env.WORKSPACE_SMOKE_COOKIE || "";
  const results = await run(o, cookie, (l) => console.log(l));
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? "失敗 " + failed + " 項" : "全部通過（" + results.length + " 項）");
  return failed ? 1 : 0;
}

module.exports = { get, parseArgs, validateBase, findAsset, run };
if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
