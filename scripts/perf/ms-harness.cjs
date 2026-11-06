'use strict';
/**
 * 每月人員狀態加速：測試／量測共用 harness。
 *
 * 把 app/store/actions.ts（以及它 import 的 lib/*.ts）以 TypeScript transpile 後載入，
 * 並把 `@/lib/supabase/server` 換成「指向 DEV、會計算往返次數」的 client。
 * 因此可以在不開 Next.js 的情況下，直接呼叫「真正的」server action，
 * 且能載入任一 git 版本（例如改前的 b8727bef）與工作樹版本，用同一組帳號做逐項比對。
 *
 * 只連 DEV（ref 守衛在 dev-env.cjs）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { ROOT } = require('./dev-env.cjs');

const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const ts = rootRequire('typescript');
const { createClient: createSupabaseClient } = rootRequire('@supabase/supabase-js');

const sourceCache = new Map();
function readSource(ref, relPath) {
  const key = `${ref}::${relPath}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  let text = null;
  if (ref === 'worktree') {
    const f = path.join(ROOT, relPath);
    text = fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null;
  } else {
    try {
      text = execFileSync('git', ['show', `${ref}:${relPath.split(path.sep).join('/')}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      text = null;
    }
  }
  sourceCache.set(key, text);
  return text;
}

function resolveProjectFile(ref, base) {
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}.js`, path.posix.join(base, 'index.ts')]) {
    if (readSource(ref, cand) != null) return cand;
  }
  return null;
}

const transpiled = new Map();
function transpile(ref, relPath) {
  const key = `${ref}::${relPath}`;
  if (transpiled.has(key)) return transpiled.get(key);
  const src = readSource(ref, relPath);
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: relPath,
  }).outputText;
  transpiled.set(key, out);
  return out;
}

/** 以 ref 載入專案 TS 模組；ctx.user / ctx.admin 供 mock 的 supabase server 使用。 */
function loadProjectModule(ref, entryRelPath, ctx) {
  const cache = new Map();
  const mocks = {
    '@/lib/supabase/server': {
      createClient: () => ctx.user,
      createAdminClient: () => ctx.admin,
    },
    'next/cache': { revalidatePath() {}, revalidateTag() {} },
    'next/headers': { cookies: () => ({ get: () => undefined, set() {} }) },
  };

  function load(relPath) {
    if (cache.has(relPath)) return cache.get(relPath).exports;
    const mod = { exports: {} };
    cache.set(relPath, mod);
    const code = transpile(ref, relPath);
    const dir = path.posix.dirname(relPath);
    const req = (spec) => {
      if (mocks[spec]) return mocks[spec];
      if (spec.startsWith('@/')) {
        const file = resolveProjectFile(ref, spec.slice(2));
        if (!file) throw new Error(`[harness] ${ref} 找不到模組 ${spec}`);
        return load(file);
      }
      if (spec.startsWith('.')) {
        const file = resolveProjectFile(ref, path.posix.normalize(path.posix.join(dir, spec)));
        if (!file) throw new Error(`[harness] ${ref} 找不到模組 ${spec}`);
        return load(file);
      }
      return rootRequire(spec);
    };
    new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
    return mod.exports;
  }
  return load(entryRelPath);
}

/** 計算 HTTP 往返次數的 fetch wrapper */
function makeCounter() {
  const c = { total: 0, byKind: {}, log: [] };
  c.reset = () => {
    c.total = 0;
    c.byKind = {};
    c.log = [];
  };
  c.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    const kind = u.pathname.startsWith('/auth/') ? 'auth' : u.pathname.startsWith('/rest/v1/rpc/') ? 'rpc' : 'rest';
    c.total += 1;
    c.byKind[kind] = (c.byKind[kind] || 0) + 1;
    c.log.push(`${(init && init.method) || 'GET'} ${u.pathname.replace('/rest/v1/', '')}`);
    return fetch(input, init);
  };
  return c;
}

function makeServiceClient(env, counter) {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: counter ? { fetch: counter.fetch } : undefined,
  });
}

async function makeUserClient(env, session, counter) {
  const c = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: counter ? { fetch: counter.fetch } : undefined,
  });
  const r = await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (r.error) throw new Error(`setSession 失敗：${r.error.message}`);
  return c;
}

/** 攔截 client.rpc(name)，依 map 改呼叫別的函式；其餘成員原樣轉發 */
function renameRpc(client, map) {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'rpc') return (name, ...rest) => target.rpc(map[name] || name, ...rest);
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** 對一個帳號載入指定版本的 actions，回傳可呼叫物件與計數器 */
async function openActions(env, session, ref, opts = {}) {
  const counter = makeCounter();
  let user = await makeUserClient(env, session, counter);
  // DEV 的 has_permission 與正式區不同：「改前」參考值改呼叫 DEV 上的暫時函式 perf_has_permission_prod（內容 = 正式區定義）
  if (opts.rpcRename) user = renameRpc(user, opts.rpcRename);
  const ctx = { user, admin: makeServiceClient(env, counter) };
  const actions = loadProjectModule(ref, 'app/store/actions.ts', ctx);
  counter.reset();
  return { actions, counter, ctx };
}

module.exports = { loadProjectModule, makeCounter, makeServiceClient, makeUserClient, openActions, readSource };
