'use strict';
/**
 * 單次 fixture 清理 sweeper（D15）。
 * - 依 tests/reports/<runId>/created.json 清除單次資料。
 * - 依測試標記（ZTT 員編前綴等）掃描孤兒，回報孤兒數。
 * - 長駐基準資料（VW001/VW002/ZT01–ZT05 等）永遠不刪。
 * - DB 連線只用通過守衛的 DEV service role；db 可注入（單元測試用）。
 * CLI：node tests/support/sweeper.cjs <scan|sweep|check|--reserved-months> [--phase pre|post] [--run-id <id>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { assertDevEnvironment } = require('./env-guard.cjs');
const { RUN_ID_RE, listRuns, writeCreated, defaultReportsRoot } = require('./registry.cjs');
const {
  MARKER_TARGETS,
  isDeletableTarget,
  RESERVED_MONTH_TABLES,
  RESERVED_MONTH_PATTERN,
  RESERVED_YEAR_TABLES,
  TEST_STORE_SETTING_TABLES,
  BASELINE_VALUES,
  TEST_STORE_CODES,
} = require('./sweep-targets.cjs');

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/** 值是否帶有單次測試標記，且不是長駐基準資料。 */
function isTestMarker(value) {
  // 年份 2038 為長駐基準設定（D15），不是可刪除的測試標記。
  if (typeof value !== 'string' || !value) return false;
  if (BASELINE_VALUES.includes(value)) return false;
  return (
    value.startsWith('ZTT') ||
    value.startsWith('[自動測試]') ||
    /T\d{8}-[a-z0-9]{4}/.test(value) ||
    /^2099-(0[1-9]|1[0-2])/.test(value)
  );
}

/** 登錄項目是否允許刪除：id 欄位由 fixture 自己登錄；其他欄位的每個值都必須帶標記。 */
function evaluateEntry(entry) {
  if (!entry || !IDENT_RE.test(entry.table || '') || !IDENT_RE.test(entry.column || '')) {
    return { safe: false, reason: 'table/column 名稱不合法' };
  }
  if (!Array.isArray(entry.values) || entry.values.length === 0) {
    return { safe: false, reason: 'values 為空' };
  }
  if (!isDeletableTarget(entry.table, entry.column)) {
    return { safe: false, reason: '表或欄位不在允許刪除的白名單內' };
  }
  if (entry.values.some((v) => v === 2038 || v === '2038')) {
    return { safe: false, reason: '2038 為長駐基準資料' };
  }
  if (entry.values.some((v) => typeof v === 'string' && BASELINE_VALUES.includes(v))) {
    return { safe: false, reason: '包含長駐基準資料' };
  }
  if (entry.column === 'id') {
    // id 類登錄必須是 registry.record 在該次 run 剛建立的列（帶 recordedAt），手寫項目一律拒絕。
    return entry.recordedAt ? { safe: true } : { safe: false, reason: 'id 登錄缺少 recordedAt，非該次 run 建立' };
  }
  if (entry.values.every(isTestMarker)) return { safe: true };
  return { safe: false, reason: '值不帶測試標記' };
}

function createDevDb(env) {
  // 延遲載入；env 必須已通過守衛。
  const { createClient } = require('@supabase/supabase-js');
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const PAGE_SIZE = 1000;

/** 保留範圍的表清單：2099-xx 月份表、2038 年績效表（guardForeign）與測試門市專屬設定表。 */
function reservedSpecs() {
  return [
    ...RESERVED_MONTH_TABLES.map((table) => ({ table, column: 'year_month', op: 'like', value: RESERVED_MONTH_PATTERN, guardForeign: true })),
    ...RESERVED_YEAR_TABLES.map((t) => ({ ...t, guardForeign: true })),
    ...TEST_STORE_SETTING_TABLES.map((t) => ({ ...t, op: null, guardForeign: false })),
  ];
}

function applyFilter(q, spec) {
  if (spec.op === 'like') return q.like(spec.column, spec.value);
  if (spec.op === 'eq') return q.eq(spec.column, spec.value);
  return q;
}

/** 分頁取出保留範圍內的列的 store_id（只取 store_id，不取其他欄位）。無 guardForeign 的表只取測試門市。 */
async function fetchReservedStoreIds(db, spec, testIds) {
  const ids = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = applyFilter(db.from(spec.table).select('store_id'), spec);
    if (!spec.guardForeign) q = q.in('store_id', testIds);
    const res = await q.range(from, from + PAGE_SIZE - 1);
    if (res.error) throw new Error(res.error.message);
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const r of rows) ids.push(r.store_id);
    if (rows.length < PAGE_SIZE) break;
  }
  return ids;
}

/** 以 stores.store_code 解析測試門市 id。 */
async function resolveTestStoreIds(db) {
  const res = await db.from('stores').select('id, store_code').in('store_code', TEST_STORE_CODES);
  if (res.error) throw new Error(res.error.message);
  return (Array.isArray(res.data) ? res.data : []).map((r) => r.id).filter(Boolean);
}

/**
 * 保留月份 2099-xx 的處理。
 * - 任何表出現非測試門市（含 store_id 為空）的列：整體不刪除，列入 foreign 讓呼叫端以退出碼 3 中止。
 * - 否則（且非 dryRun）刪除測試門市的列；dryRun 只回報筆數。
 * @returns {{tables: any[], foreign: {table:string, rows:number}[], deleted: number, errors: string[]}}
 */
async function sweepReservedMonths(db, { dryRun = false } = {}) {
  const out = { tables: [], foreign: [], deleted: 0, errors: [] };
  let testIds;
  try {
    testIds = await resolveTestStoreIds(db);
  } catch (error) {
    out.errors.push(`stores: ${String(error.message || error).slice(0, 200)}`);
    return out;
  }
  const testSet = new Set(testIds);
  const specs = reservedSpecs();
  for (const spec of specs) {
    const table = spec.table;
    const row = { table, testRows: 0, foreignRows: 0, deleted: 0 };
    try {
      const ids = await fetchReservedStoreIds(db, spec, testIds);
      row.testRows = ids.filter((id) => testSet.has(id)).length;
      row.foreignRows = ids.length - row.testRows;
      if (row.foreignRows > 0) out.foreign.push({ table, rows: row.foreignRows });
    } catch (error) {
      row.error = String(error.message || error).slice(0, 200);
      out.errors.push(`${table}: ${row.error}`);
    }
    out.tables.push(row);
  }
  if (out.foreign.length > 0 || out.errors.length > 0 || dryRun || testIds.length === 0) return out;
  for (const row of out.tables) {
    if (row.testRows === 0) continue;
    try {
      const spec = specs.find((x) => x.table === row.table);
      const del = await applyFilter(db.from(row.table).delete(), spec)
        .in('store_id', testIds)
        .select('store_id');
      if (del.error) throw new Error(del.error.message);
      row.deleted = Array.isArray(del.data) ? del.data.length : 0;
      out.deleted += row.deleted;
    } catch (error) {
      row.error = String(error.message || error).slice(0, 200);
      out.errors.push(`${row.table}: ${row.error}`);
    }
  }
  return out;
}

function baselineList() {
  return `(${BASELINE_VALUES.map((v) => `"${v}"`).join(',')})`;
}

/**
 * @param {{
 *  db?: any, root?: string, reportsRoot?: string, mode?: 'scan'|'sweep'|'check',
 *  phase?: 'pre'|'post', currentRunId?: string
 * }} opts
 */
async function runSweeper(opts = {}) {
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const reportsRoot = opts.reportsRoot || defaultReportsRoot();
  const mode = opts.mode || 'scan';
  const result = {
    mode,
    phase: opts.phase || null,
    registry: { runsScanned: 0, entriesPending: 0, deleted: 0, refused: 0, failed: 0 },
    markers: [],
    reservedMonths: [],
    reservedMonthsForeign: [],
    reservedMonthsDeleted: 0,
    orphanCount: 0,
    errors: [],
  };

  const runs = listRuns(reportsRoot);
  result.registry.runsScanned = runs.length;
  const pendingRuns = runs
    .map((r) => ({ ...r, pending: r.data.entries.filter((e) => e.status === 'pending' || e.status === 'failed') }))
    .filter((r) => r.pending.length > 0);
  result.registry.entriesPending = pendingRuns.reduce((n, r) => n + r.pending.length, 0);

  // 沒有任何需要 DB 的工作（scan 模式且無登錄）仍需要掃描標記，因此一律連線，但先過守衛。
  const db = opts.db || createDevDb(assertDevEnvironment({ root }).env);

  // 1) 登錄表
  for (const run of pendingRuns) {
    let changed = false;
    for (const entry of run.pending) {
      const verdict = evaluateEntry(entry);
      if (!verdict.safe) {
        result.registry.refused += 1;
        if (mode === 'sweep') {
          entry.status = 'refused';
          entry.reason = verdict.reason;
          changed = true;
        }
        continue;
      }
      if (mode !== 'sweep') continue;
      try {
        const res = await db.from(entry.table).delete().in(entry.column, entry.values).select(entry.column);
        if (res.error) throw new Error(res.error.message);
        result.registry.deleted += Array.isArray(res.data) ? res.data.length : 0;
        entry.status = 'cleaned';
        entry.cleanedAt = new Date().toISOString();
      } catch (error) {
        entry.status = 'failed';
        entry.reason = String(error.message || error).slice(0, 200);
        result.registry.failed += 1;
        result.errors.push(`${entry.table}: ${entry.reason}`);
      }
      changed = true;
    }
    if (changed) writeCreated(run.file, run.data);
  }

  // 2) 標記掃描
  for (const target of MARKER_TARGETS) {
    const row = { table: target.table, column: target.column, action: target.action, matched: 0, deleted: 0 };
    try {
      const q = db
        .from(target.table)
        .select(target.column, { count: 'exact', head: true })
        .like(target.column, target.pattern)
        .not(target.column, 'in', baselineList());
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      row.matched = res.count || 0;
      if (mode === 'sweep' && target.action === 'delete' && row.matched > 0 && target.cascade === 'task-template') {
        // 任務範本：先刪 logs、協作者、指派（assignments 沒有 cascade），最後刪範本；只動標題帶測試標記的範本。
        const found = await db.from('templates').select('id').like(target.column, target.pattern);
        if (found.error) throw new Error(found.error.message);
        const tids = (found.data || []).map((r) => r.id);
        const aids = [];
        for (let i = 0; i < tids.length; i += 100) {
          const a = await db.from('assignments').select('id').in('template_id', tids.slice(i, i + 100));
          if (a.error) throw new Error(a.error.message);
          aids.push(...(a.data || []).map((r) => r.id));
        }
        for (let i = 0; i < aids.length; i += 100) {
          const part = aids.slice(i, i + 100);
          for (const t of ['logs', 'assignment_collaborators']) {
            const d = await db.from(t).delete().in('assignment_id', part);
            if (d.error) throw new Error(d.error.message);
          }
          const d = await db.from('assignments').delete().in('id', part);
          if (d.error) throw new Error(d.error.message);
        }
        let n = 0;
        for (let i = 0; i < tids.length; i += 100) {
          const d = await db.from('templates').delete().in('id', tids.slice(i, i + 100)).select('id');
          if (d.error) throw new Error(d.error.message);
          n += (d.data || []).length;
        }
        row.deleted = n;
      } else if (mode === 'sweep' && target.action === 'delete' && row.matched > 0 && target.cascade === 'calendar-event') {
        // 年度行事曆公司行事：異動紀錄的 event_id 是 restrict，先刪紀錄與 Google 連結，再刪標題帶測試標記的行事。
        const found = await db.from('organization_calendar_events').select('id').like(target.column, target.pattern);
        if (found.error) throw new Error(found.error.message);
        const ids = (found.data || []).map((r) => r.id);
        let n = 0;
        for (let i = 0; i < ids.length; i += 100) {
          const part = ids.slice(i, i + 100);
          const a = await db.from('organization_calendar_event_audit').delete().in('event_id', part);
          if (a.error) throw new Error(a.error.message);
          const l = await db.from('organization_calendar_google_event_links').delete().in('source_key', part.map((id) => 'company:' + id));
          if (l.error) throw new Error(l.error.message);
          const d = await db.from('organization_calendar_events').delete().in('id', part).select('id');
          if (d.error) throw new Error(d.error.message);
          n += (d.data || []).length;
        }
        row.deleted = n;
      } else if (mode === 'sweep' && target.action === 'delete' && row.matched > 0) {
        const del = await db
          .from(target.table)
          .delete()
          .like(target.column, target.pattern)
          .not(target.column, 'in', baselineList())
          .select(target.column);
        if (del.error) throw new Error(del.error.message);
        row.deleted = Array.isArray(del.data) ? del.data.length : 0;
      }
    } catch (error) {
      row.error = String(error.message || error).slice(0, 200);
      result.errors.push(`${target.table}: ${row.error}`);
    }
    result.markers.push(row);
  }

  // 3) 保留月份 2099-xx：sweep 時清除測試門市的列；非測試門市的列只回報
  const reserved = await sweepReservedMonths(db, { dryRun: mode !== 'sweep' });
  result.reservedMonths = reserved.tables;
  result.reservedMonthsForeign = reserved.foreign;
  result.reservedMonthsDeleted = reserved.deleted;
  result.errors.push(...reserved.errors);

  const stillPending = result.registry.entriesPending - result.registry.deleted;
  const registryOrphans = mode === 'sweep' ? result.registry.refused + result.registry.failed : stillPending;
  const markerOrphans = result.markers.reduce((n, m) => n + Math.max(0, m.matched - m.deleted), 0);
  result.orphanCount = registryOrphans + markerOrphans;
  result.reservedMonthsNonEmpty = reserved.foreign.length > 0;
  return result;
}

/** 手動清除保留月份 2099-xx 的測試門市資料；有非測試門市資料時不刪除並以退出碼 3 結束。 */
async function mainReservedMonths() {
  try {
    const db = createDevDb(assertDevEnvironment({ root: path.resolve(__dirname, '..', '..') }).env);
    const r = await sweepReservedMonths(db);
    console.log(JSON.stringify(r, null, 2));
    if (r.errors.length) process.exit(1);
    if (r.foreign.length) {
      console.error('保留月份出現非測試門市資料，已中止且未刪除：');
      for (const f of r.foreign) console.error(`  ${f.table}: ${f.rows} 筆`);
      process.exit(3);
    }
  } catch (error) {
    console.error('Sweeper failed');
    console.error(`Reason: ${String(error.message || error).slice(0, 300)}`);
    process.exit(error.exitCode || 1);
  }
}

async function main(argv) {
  if (argv.includes('--reserved-months')) return mainReservedMonths();
  const mode = ['scan', 'sweep', 'check'].includes(argv[0]) ? argv[0] : 'scan';
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runId = flag('--run-id');
  if (runId && !RUN_ID_RE.test(runId)) {
    console.error('Sweeper failed\nReason: runId 格式不正確');
    process.exit(1);
  }
  try {
    const result = await runSweeper({ mode, phase: flag('--phase') });
    if (runId) {
      const dir = path.join(defaultReportsRoot(), runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `sweeper-${result.phase || mode}.json`), JSON.stringify(result, null, 2));
    }
    console.log(JSON.stringify(result, null, 2));
    if (mode === 'check' && result.reservedMonthsNonEmpty) process.exit(3);
  } catch (error) {
    console.error('Sweeper failed');
    console.error(`Reason: ${String(error.message || error).slice(0, 300)}`);
    process.exit(error.exitCode || 1);
  }
}

module.exports = { isTestMarker, evaluateEntry, runSweeper, sweepReservedMonths };

if (require.main === module) main(process.argv.slice(2));
