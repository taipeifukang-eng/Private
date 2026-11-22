'use strict';
// 量測用 preload：記錄伺服器端對 Supabase 的每一次往返（只寫路徑，不寫金鑰或查詢值之外的標頭）。
// 用法：NODE_OPTIONS="--require tests/perf/count-fetch.cjs" PERF_FETCH_LOG=<檔案> 啟動 next dev。
const fs = require('node:fs');
const log = process.env.PERF_FETCH_LOG;
const orig = globalThis.fetch;
if (log && orig) {
  globalThis.fetch = async function perfFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const t = Date.now();
    try {
      return await orig.apply(this, arguments);
    } finally {
      if (/\.supabase\.co\//.test(url)) {
        const line = { t, ms: Date.now() - t, m: (init && init.method) || (input && input.method) || 'GET', u: url.replace(/^https:\/\/[^/]+/, '').slice(0, 140) };
        try { fs.appendFileSync(log, JSON.stringify(line) + '\n'); } catch {}
      }
    }
  };
}
