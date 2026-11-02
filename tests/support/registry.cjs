'use strict';
/**
 * 單次 fixture 登錄表：tests/reports/<runId>/created.json
 * 每個 seed / setup 建立單次資料時呼叫 record()，teardown 或 sweeper 依此清除。
 * 檔案內容只存表名、欄位、值（標記或 id），不得存任何祕密。
 */
const fs = require('node:fs');
const path = require('node:path');
const { isDeletableTarget } = require('./sweep-targets.cjs');

const RUN_ID_RE = /^T\d{8}-[a-z0-9]{4}$/;
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 產生 runId：T<yyyymmdd>-<4碼>。 */
function newRunId(date = new Date(), random = Math.random) {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  let suffix = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 4; i += 1) suffix += alphabet[Math.floor(random() * alphabet.length)];
  return `T${ymd}-${suffix}`;
}

function defaultReportsRoot() {
  return path.resolve(__dirname, '..', 'reports');
}

function createdFile(reportsRoot, runId) {
  return path.join(reportsRoot, runId, 'created.json');
}

function readCreated(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // 檔案不存在或損毀時視為空
  }
  return null;
}

function writeCreated(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * @param {{runId: string, reportsRoot?: string}} opts
 */
function createRegistry({ runId, reportsRoot = defaultReportsRoot() }) {
  if (!RUN_ID_RE.test(runId)) throw new Error(`runId 格式不正確：${runId}`);
  const file = createdFile(reportsRoot, runId);

  function load() {
    return readCreated(file) || { runId, createdAt: new Date().toISOString(), entries: [] };
  }

  return {
    runId,
    file,
    /**
     * 登錄一筆單次資料。values 為要清除的值（欄位值，例如 id 或帶標記的員編）。
     * @param {{table: string, column?: string, values: Array<string|number>, note?: string}} entry
     */
    record(entry) {
      if (!IDENT_RE.test(entry.table || '')) throw new Error('table 名稱不合法');
      const column = entry.column || 'id';
      if (!IDENT_RE.test(column)) throw new Error('column 名稱不合法');
      if (!isDeletableTarget(entry.table, column)) throw new Error(`${entry.table}.${column} 不在允許刪除的白名單內`);
      if (!Array.isArray(entry.values) || entry.values.length === 0) throw new Error('values 不可為空');
      const data = load();
      data.entries.push({
        table: entry.table,
        column,
        values: entry.values,
        note: entry.note || '',
        recordedAt: new Date().toISOString(),
        status: 'pending',
      });
      writeCreated(file, data);
    },
    read: load,
    save(data) {
      writeCreated(file, data);
    },
  };
}

/** 列出 reportsRoot 下所有有 created.json 的 run。 */
function listRuns(reportsRoot = defaultReportsRoot()) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(reportsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const runs = [];
  for (const d of dirs) {
    if (!RUN_ID_RE.test(d.name)) continue;
    const file = createdFile(reportsRoot, d.name);
    const data = readCreated(file);
    if (data) runs.push({ runId: d.name, file, data });
  }
  return runs;
}

module.exports = {
  RUN_ID_RE,
  newRunId,
  defaultReportsRoot,
  createRegistry,
  listRuns,
  readCreated,
  writeCreated,
};
