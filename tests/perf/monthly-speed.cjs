'use strict';
/**
 * 每月人員狀態加速（monthly-speed-spec）量測與一致性工具。只連 DEV 測試站，只讀（seed 只寫 ZT01 + 2099-07，並可 cleanup）。
 *
 *   node tests/perf/monthly-speed.cjs discover  --out cases.json        # 以 admin 挑出有資料的門市與月份
 *   node tests/perf/monthly-speed.cjs seed      --cases cases.json      # 在 ZT01 / 2099-07 建兩位測試人員（管理員 API）
 *   node tests/perf/monthly-speed.cjs snapshot  --cases cases.json --out snap.json [--base http://localhost:3022] [--log perf.log] [--reps 3]
 *   node tests/perf/monthly-speed.cjs compare   before.json after.json  # 一致性：除新增 meta 欄位外必須完全相同
 *   node tests/perf/monthly-speed.cjs cleanup   --cases cases.json      # 只刪 seed 建立的草稿人員
 */
const fs = require('node:fs');
const { request } = require('@playwright/test');
const { getAccount } = require('../support/credentials.cjs');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const BASE = opt('base', 'http://localhost:3002');
const LOG = opt('log', '');
const REPS = Number(opt('reps', '3'));
const ACCOUNTS = ['admin', 'store_manager', 'supervisor', 'ops_manager', 'ops_assistant', 'navigation', 'monthly_view', 'pharmacist'];
const SEED_MONTH = '2099-07';
const SEED_CODES = [
  ['FK9901', '效能測試甲'],
  ['FKPT991', '效能測試乙'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(key) {
  const { email, password } = getAccount(key);
  for (let i = 0; i < 6; i += 1) {
    const c = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
    const l = await c.post('/api/workspace/login', { data: { email, password } });
    if (l.ok()) return c;
    await c.dispose();
    await sleep(1500 * (i + 1));
  }
  throw new Error('login failed ' + key);
}
function logLines() {
  if (!LOG || !fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
}
async function timed(c, url) {
  const before = logLines().length;
  const t = Date.now();
  const r = await c.get(url);
  const ms = Date.now() - t;
  let body = null;
  try {
    body = await r.json();
  } catch {}
  await sleep(200);
  const trips = logLines().slice(before).map((l) => JSON.parse(l));
  return { status: r.status(), ms, body, trips: trips.length, tripPaths: trips.map((x) => x.m + ' ' + x.u.split('?')[0]) };
}
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

async function discover() {
  const admin = await api('admin');
  const out = { months: ['2026-11', '2026-10'], stores: [] };
  const seen = new Map();
  for (const month of out.months) {
    const first = await (await admin.get('/api/workspace/monthly?month=' + month)).json();
    for (const s of first.allStores) {
      const j = await (await admin.get(`/api/workspace/monthly?month=${month}&store=${s.id}`)).json();
      const n = (j.records || []).length;
      const prev = seen.get(s.id) || { id: s.id, code: s.store_code, active: s.is_active !== false, rows: {} };
      prev.rows[month] = n;
      seen.set(s.id, prev);
    }
  }
  const list = [...seen.values()];
  const withData = list
    .filter((s) => Object.values(s.rows).some((n) => n > 0))
    .sort((a, b) => Math.max(...Object.values(b.rows)) - Math.max(...Object.values(a.rows)));
  const pick = withData.slice(0, 4);
  for (const s of list.filter((x) => x.code === 'ZT01' || x.code === 'ZT02' || !x.active).slice(0, 3)) if (!pick.includes(s)) pick.push(s);
  out.stores = pick.map((s) => ({ id: s.id, code: s.code, active: s.active, rows: s.rows }));
  const zt = list.find((s) => s.code === 'ZT01');
  out.seedStoreId = zt && zt.id;
  fs.writeFileSync(opt('out', 'cases.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await admin.dispose();
}

async function seed() {
  const { randomUUID } = require('node:crypto');
  const admin = await api('admin');
  const cases = JSON.parse(fs.readFileSync(opt('cases', 'cases.json'), 'utf8'));
  const store = cases.seedStoreId;
  const init = await admin.post('/api/workspace/monthly', { data: { action: 'initialize', store, month: SEED_MONTH } });
  console.log('initialize', init.status());
  for (const [code, name] of SEED_CODES) {
    const r = await admin.post('/api/workspace/monthly/tools', {
      data: {
        op: 'manual',
        store,
        month: SEED_MONTH,
        requestId: randomUUID(),
        employee: { employee_name: name, employee_code: code, position: '專員', monthly_status: 'full_month', work_days: 31, work_hours: 0, notes: 'perf-seed' },
      },
    });
    console.log('manual', code, r.status());
  }
  await admin.dispose();
}

async function cleanup() {
  const admin = await api('admin');
  const cases = JSON.parse(fs.readFileSync(opt('cases', 'cases.json'), 'utf8'));
  const j = await (await admin.get(`/api/workspace/monthly?month=${SEED_MONTH}&store=${cases.seedStoreId}`)).json();
  for (const r of j.records || []) {
    if (!SEED_CODES.some(([c]) => c === r.employee_code)) continue;
    const d = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: cases.seedStoreId, month: SEED_MONTH, id: r.id } });
    console.log('delete', r.employee_code, d.status());
  }
  await admin.dispose();
}

async function snapshot() {
  const cases = JSON.parse(fs.readFileSync(opt('cases', 'cases.json'), 'utf8'));
  const stores = cases.stores.map((s) => ({ id: s.id, code: s.code, month: cases.months[0] }));
  for (const s of cases.stores) for (const m of cases.months.slice(1)) if (s.rows[m] > 0) stores.push({ id: s.id, code: s.code, month: m });
  stores.push({ id: cases.seedStoreId, code: 'ZT01', month: SEED_MONTH });
  const snap = { base: BASE, at: new Date().toISOString(), cases: {} };
  for (const key of ACCOUNTS) {
    const c = await api(key);
    const list = [{ code: '(default)', id: '', month: cases.months[0] }, ...stores];
    for (const s of list) {
      const rosterUrl = `/api/workspace/monthly?month=${s.month}${s.id ? '&store=' + s.id : ''}`;
      const metaUrl = `/api/workspace/monthly/tools?month=${s.month}&store=${s.id}&op=meta`;
      const runs = [];
      for (let i = 0; i < REPS; i += 1) runs.push(await timed(c, rosterUrl));
      const roster = runs[runs.length - 1];
      let meta = null;
      if (s.id) {
        const m = [];
        for (let i = 0; i < REPS; i += 1) m.push(await timed(c, metaUrl));
        meta = { ...m[m.length - 1], ms: median(m.map((x) => x.ms)) };
      }
      snap.cases[`${key}|${s.code}|${s.month}`] = {
        roster: { status: roster.status, body: roster.body, ms: median(runs.map((x) => x.ms)), trips: roster.trips, tripPaths: roster.tripPaths },
        meta: meta && { status: meta.status, body: meta.body, ms: meta.ms, trips: meta.trips },
      };
      console.log(key.padEnd(14), s.code.padEnd(10), s.month, 'roster', roster.status, median(runs.map((x) => x.ms)) + 'ms', roster.trips + ' trips', meta ? '| meta ' + meta.status + ' ' + meta.ms + 'ms ' + meta.trips + ' trips' : '');
    }
    await c.dispose();
  }
  fs.writeFileSync(opt('out', 'snap.json'), JSON.stringify(snap));
}

const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
function compare() {
  const a = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  const b = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
  let bad = 0, checked = 0, metaChecked = 0, embeddedChecked = 0;
  for (const k of Object.keys(a.cases)) {
    const x = a.cases[k], y = b.cases[k];
    if (!y) { console.log('MISSING', k); bad += 1; continue; }
    const xb = x.roster.body && typeof x.roster.body === 'object' ? { ...x.roster.body } : x.roster.body;
    if (xb && xb.meta !== undefined) delete xb.meta;
    const yb = y.roster.body && typeof y.roster.body === 'object' ? { ...y.roster.body } : y.roster.body;
    const embedded = yb && yb.meta;
    if (yb && yb.meta !== undefined) delete yb.meta;
    checked += 1;
    if (x.roster.status !== y.roster.status || JSON.stringify(sortKeys(xb)) !== JSON.stringify(sortKeys(yb))) { console.log('DIFF roster', k, x.roster.status, y.roster.status); bad += 1; }
    if (x.meta) {
      metaChecked += 1;
      if (x.meta.status !== y.meta.status || JSON.stringify(sortKeys(x.meta.body)) !== JSON.stringify(sortKeys(y.meta.body))) { console.log('DIFF tools meta', k); bad += 1; }
      if (x.meta.status === 200 && y.roster.status === 200 && yb.storeActive !== false) {
        embeddedChecked += 1;
        if (JSON.stringify(sortKeys(x.meta.body)) !== JSON.stringify(sortKeys(embedded))) { console.log('DIFF embedded meta vs old op=meta', k); bad += 1; }
      }
    }
  }
  console.log(`checked ${checked} roster responses, ${metaChecked} tools-meta responses, ${embeddedChecked} embedded-meta comparisons, ${bad} differences`);
  process.exit(bad ? 1 : 0);
}

({ discover, seed, snapshot, compare, cleanup }[cmd] || (() => { console.log('unknown command'); process.exit(2); }))().catch((e) => { console.error(e); process.exit(1); });
