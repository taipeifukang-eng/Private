#!/usr/bin/env node
/* eslint-disable */
/**
 * 產生 docs/vue-workspace/parity-plan/m9-sql/00c_prod_legacy_migration_coverage.readonly.sql
 *
 * 做法：依檔名順序逐支讀 supabase/migrations/*.sql，模擬「最終狀態」：
 *   建立就登記、DROP／改名就移除或換名，最後留下來的物件才進檢查清單，並記下它是哪一支 migration 建立的。
 * 可重跑：同樣的 migrations 一定產生同樣的 SQL（檔內不含時間戳）。
 *   node scripts/m9-coverage/build.cjs            寫出 SQL 檔
 *   node scripts/m9-coverage/build.cjs --stdout   只印到畫面
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const OUT_FILE = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'm9-sql', '00c_prod_legacy_migration_coverage.readonly.sql');

// ---------------------------------------------------------------- 字元層級掃描
const TAG_RE = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

/** 跳過單引號字串，回傳結尾後一格的位置。 */
function skipQuoted(s, i) {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === "'" && s[j + 1] === "'") j += 2;
    else if (s[j] === "'") return j + 1;
    else j++;
  }
  return j;
}
function skipDoubleQuoted(s, i) {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '"' && s[j + 1] === '"') j += 2;
    else if (s[j] === '"') return j + 1;
    else j++;
  }
  return j;
}

/** 把 SQL 切成語句：去掉註解，尊重單引號、雙引號、$tag$ 錢字串。回傳 [{head, bodies}]，head 內的錢字串本文換成 $$~$$。 */
function splitStatements(text) {
  const out = [];
  let head = '';
  let bodies = [];
  let i = 0;
  const n = text.length;
  const flush = () => {
    const t = head.trim();
    if (t) out.push({ head: t.replace(/\s+/g, ' '), bodies });
    head = '';
    bodies = [];
  };
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '-' && c2 === '-') {
      while (i < n && text[i] !== '\n') i++;
      head += ' ';
    } else if (c === '/' && c2 === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; }
        else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      head += ' ';
    } else if (c === "'") {
      const j = skipQuoted(text, i);
      head += text.slice(i, j);
      i = j;
    } else if (c === '"') {
      const j = skipDoubleQuoted(text, i);
      head += text.slice(i, j);
      i = j;
    } else if (c === '$' && !/[A-Za-z0-9_$]/.test(text[i - 1] || ' ')) {
      TAG_RE.lastIndex = i;
      const m = TAG_RE.exec(text);
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        if (end === -1) { head += text.slice(i); i = n; }
        else {
          bodies.push(text.slice(i + tag.length, end));
          head += '$$~$$';
          i = end + tag.length;
        }
      } else { head += c; i++; }
    } else if (c === ';') {
      flush();
      i++;
    } else { head += c; i++; }
  }
  flush();
  return out;
}

/** 單引號字串內容換成空白（長度不變），用來安心找關鍵字。 */
function maskStrings(s) {
  return s.replace(/'(?:[^']|'')*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
}

/** 在頂層（不在括號、引號內）用分隔字元切開。 */
function splitTop(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = skipQuoted(s, i);
      cur += s.slice(i, j);
      i = j - 1;
    } else if (c === '"') {
      const j = skipDoubleQuoted(s, i);
      cur += s.slice(i, j);
      i = j - 1;
    } else if (c === '(' || c === '[') { depth++; cur += c; }
    else if (c === ')' || c === ']') { depth--; cur += c; }
    else if (c === sep && depth === 0) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim());
}

/** 從 s[pos]（必須是 "("）找出對應的 ")" 位置。 */
function matchParen(s, pos) {
  let depth = 0;
  for (let i = pos; i < s.length; i++) {
    const c = s[i];
    if (c === "'") i = skipQuoted(s, i) - 1;
    else if (c === '"') i = skipDoubleQuoted(s, i) - 1;
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ---------------------------------------------------------------- 名稱
const ID = '(?:"(?:[^"]|"")+"|[A-Za-z_\\u0080-\\uffff][\\w$\\u0080-\\uffff]*)';
const QN = `${ID}(?:\\s*\\.\\s*${ID})?`;
const normId = (t) => (t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t.toLowerCase());
function parseQN(t, defSchema = 'public') {
  const parts = t.match(new RegExp(ID, 'g')).map(normId);
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: defSchema, name: parts[0] };
}
const quoteIfNeeded = (id) => (/^[a-z_][a-z0-9_$]*$/.test(id) ? id : '"' + id.replace(/"/g, '""') + '"');

const TYPE_START = new Set(['character', 'double', 'timestamp', 'time', 'bit', 'national', 'interval']);
const MODES = new Set(['in', 'out', 'inout', 'variadic']);

/** 把 ("p" "uuid", x text DEFAULT 1) 的參數清單轉成 to_regprocedure 用的型別串（OUT 參數不算）。 */
function parseArgTypes(argStr) {
  const types = [];
  for (let raw of splitTop(argStr)) {
    if (!raw) continue;
    const m = /(\sDEFAULT\s|\s=\s|\s:=\s)/i.exec(maskStrings(raw));
    if (m) raw = raw.slice(0, m.index);
    raw = raw.replace(/\([^()]*\)/g, ''); // 型別長度，如 varchar(20)、numeric(10,2)
    let tokens = raw.trim().match(/"(?:[^"]|"")+"(?:\s*\.\s*"(?:[^"]|"")+")?|[^\s]+/g) || [];
    if (!tokens.length) continue;
    if (MODES.has(tokens[0].toLowerCase())) {
      if (tokens[0].toLowerCase() === 'out') continue;
      tokens = tokens.slice(1);
    }
    let typeToks;
    if (tokens.length === 1) typeToks = tokens;
    else if (TYPE_START.has(tokens[0].toLowerCase().replace(/"/g, ''))) typeToks = tokens;
    else typeToks = tokens.slice(1);
    let type = typeToks.join(' ');
    type = type.replace(new RegExp(ID, 'g'), (t) => quoteIfNeeded(normId(t)));
    type = type.replace(/\s*\.\s*/g, '.').replace(/\s+\[/g, '[').replace(/\s+/g, ' ').trim();
    types.push(type);
  }
  return types;
}

function parseFunctionRef(rest) {
  const m = new RegExp(`^(${QN})\\s*\\(`).exec(rest);
  if (!m) return null;
  const open = m[0].length - 1;
  const close = matchParen(rest, open);
  if (close < 0) return null;
  const { schema, name } = parseQN(m[1]);
  const types = parseArgTypes(rest.slice(open + 1, close));
  return { schema, name: `${quoteIfNeeded(name)}(${types.join(',')})`, end: close + 1 };
}

// ---------------------------------------------------------------- 狀態
class Registry {
  constructor() {
    this.items = new Map(); // key -> {type, schema, parent, name, mig}
    this.graveyard = new Map(); // key -> {entry, droppedBy}
    this.cur = 0;
    this.curName = '';
    this.warnings = [];
  }
  key(type, schema, parent, name) {
    return type === 'index' || type === 'sequence' || type === 'type' ? `${type}|${schema}|${name}` : `${type}|${schema}|${parent || ''}|${name}`;
  }
  add(type, schema, parent, name, { keepExisting = true } = {}) {
    const k = this.key(type, schema, parent, name);
    if (this.items.has(k) && keepExisting) return false;
    const g = this.graveyard.get(k);
    let mig = this.cur;
    // 同一支 migration 內「先砍再建」視為同一個物件，沿用原本的建立者
    if (g && g.droppedBy === this.cur && type !== 'column') mig = g.entry.mig;
    this.graveyard.delete(k);
    this.items.set(k, { type, schema, parent: parent || null, name, mig });
    return true;
  }
  remove(type, schema, parent, name) {
    const k = this.key(type, schema, parent, name);
    const e = this.items.get(k);
    if (e) { this.items.delete(k); this.graveyard.set(k, { entry: e, droppedBy: this.cur }); }
    return !!e;
  }
  dropTable(schema, name) {
    this.remove('table', schema, null, name);
    for (const [k, e] of [...this.items]) {
      if (e.parent === name && e.schema === schema) this.items.delete(k);
    }
  }
  renameTable(schema, from, to) {
    const e = this.items.get(this.key('table', schema, null, from));
    for (const [k, c] of [...this.items]) {
      if (c.parent === from && c.schema === schema) {
        this.items.delete(k);
        this.items.set(this.key(c.type, schema, to, c.name), { ...c, parent: to });
      }
    }
    if (e) {
      this.items.delete(this.key('table', schema, null, from));
      this.items.set(this.key('table', schema, null, to), { ...e, name: to, mig: this.cur });
    } else this.add('table', schema, null, to);
  }
  renameColumn(schema, table, from, to) {
    this.items.delete(this.key('column', schema, table, from));
    this.items.set(this.key('column', schema, table, to), { type: 'column', schema, parent: table, name: to, mig: this.cur });
  }
  warn(msg) { this.warnings.push(`${this.curName}: ${msg}`); }
}

// ---------------------------------------------------------------- 語句處理
function parseValuesTuples(s) {
  const tuples = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '(') {
      const close = matchParen(s, i);
      if (close < 0) break;
      tuples.push(splitTop(s.slice(i + 1, close)));
      i = close + 1;
    } else i++;
  }
  return tuples;
}
const unquoteLit = (t) => (/^'(?:[^']|'')*'$/.test(t) ? t.slice(1, -1).replace(/''/g, "'") : null);

function handleInsertWithValues(reg, st, tableRe, colName, type) {
  const m = tableRe.exec(st);
  if (!m) return;
  const cols = splitTop(m[1]).map((c) => normId(c.trim()));
  const idx = cols.indexOf(colName);
  let rest = st.slice(m[0].length);
  if (!/^VALUES\b/i.test(rest)) {
    reg.warn(`${type} INSERT 不是 VALUES 形式，略過：${st.slice(0, 80)}`);
    return;
  }
  rest = rest.replace(/^VALUES\s*/i, '');
  const conflict = /\bON\s+CONFLICT\b/i.exec(maskStrings(rest));
  if (conflict) rest = rest.slice(0, conflict.index);
  if (idx < 0) { reg.warn(`${type} INSERT 沒有 ${colName} 欄`); return; }
  for (const t of parseValuesTuples(rest)) {
    const v = unquoteLit(t[idx] || '');
    if (v) reg.add(type, 'public', null, v);
    else reg.warn(`${type} INSERT 值不是字串常數：${(t[idx] || '').slice(0, 40)}`);
  }
}

function splitFunctionList(s) {
  return splitTop(s.replace(/\s+(CASCADE|RESTRICT)\s*$/i, ''));
}

function handleStatement(reg, stmt, depth = 0) {
  const st = stmt.head;
  let m;

  // DO 區塊：逐段拆開處理
  if (/^DO\b/i.test(st)) {
    for (const body of stmt.bodies) handleDoBody(reg, body, depth);
    return;
  }

  // CREATE TABLE
  m = new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(${QN})\\s*(\\(|\\bAS\\b|\\bPARTITION\\b)`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[2]);
    const exists = reg.items.has(reg.key('table', schema, null, name));
    if (m[1] && exists) return;
    reg.add('table', schema, null, name, { keepExisting: false });
    if (m[3] === '(') {
      const open = m[0].length - 1;
      const close = matchParen(st, open);
      for (const el of splitTop(st.slice(open + 1, close))) {
        if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)\b/i.test(el)) continue;
        const cm = new RegExp(`^(${ID})`).exec(el);
        if (cm) reg.add('column', schema, name, normId(cm[1]));
      }
    }
    return;
  }
  if (/^CREATE\s+(TEMP|TEMPORARY)\s/i.test(st)) return;

  // ALTER TABLE
  m = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QN})\\s*\\*?\\s+([\\s\\S]*)$`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[1]);
    for (const act of splitTop(m[2])) {
      let a;
      if ((a = new RegExp(`^RENAME\\s+COLUMN\\s+(${ID})\\s+TO\\s+(${ID})`, 'i').exec(act))) {
        reg.renameColumn(schema, name, normId(a[1]), normId(a[2]));
      } else if ((a = new RegExp(`^RENAME\\s+TO\\s+(${ID})`, 'i').exec(act))) {
        reg.renameTable(schema, name, normId(a[1]));
      } else if (/^RENAME\s+CONSTRAINT\b/i.test(act)) {
        /* 約束名稱不檢查 */
      } else if ((a = new RegExp(`^RENAME\\s+(${ID})\\s+TO\\s+(${ID})`, 'i').exec(act))) {
        reg.renameColumn(schema, name, normId(a[1]), normId(a[2]));
      } else if (/^SET\s+SCHEMA\b/i.test(act)) {
        reg.warn(`SET SCHEMA 未處理：${name}`);
      } else if ((a = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(act))) {
        if (/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(act)) continue;
        const cm = new RegExp(`^(${ID})`).exec(act.slice(a[0].length));
        if (cm) reg.add('column', schema, name, normId(cm[1]));
      } else if ((a = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${ID})`, 'i').exec(act))) {
        if (/^DROP\s+(CONSTRAINT|NOT|DEFAULT|IDENTITY|EXPRESSION)\b/i.test(act)) continue;
        reg.remove('column', schema, name, normId(a[1]));
      }
    }
    return;
  }

  // DROP TABLE
  m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(st);
  if (m) {
    for (const t of splitTop(m[1])) { const { schema, name } = parseQN(t); reg.dropTable(schema, name); }
    return;
  }

  // TRIGGER
  m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(${ID})\\s+[\\s\\S]*?\\bON\\s+(${QN})`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[2]);
    reg.add('trigger', schema, name, normId(m[1]));
    return;
  }
  m = new RegExp(`^DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?(${ID})\\s+ON\\s+(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[2]); reg.remove('trigger', schema, name, normId(m[1])); return; }
  m = new RegExp(`^ALTER\\s+TRIGGER\\s+(${ID})\\s+ON\\s+(${QN})\\s+RENAME\\s+TO\\s+(${ID})`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[2]);
    reg.remove('trigger', schema, name, normId(m[1]));
    reg.add('trigger', schema, name, normId(m[3]), { keepExisting: false });
    return;
  }

  // POLICY
  m = new RegExp(`^CREATE\\s+POLICY\\s+(${ID})\\s+ON\\s+(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[2]); reg.add('policy', schema, name, normId(m[1])); return; }
  m = new RegExp(`^DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?(${ID})\\s+ON\\s+(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[2]); reg.remove('policy', schema, name, normId(m[1])); return; }
  m = new RegExp(`^ALTER\\s+POLICY\\s+(${ID})\\s+ON\\s+(${QN})\\s+RENAME\\s+TO\\s+(${ID})`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[2]);
    reg.remove('policy', schema, name, normId(m[1]));
    reg.add('policy', schema, name, normId(m[3]), { keepExisting: false });
    return;
  }

  // INDEX
  m = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${ID})\\s+ON\\s+(?:ONLY\\s+)?(${QN})`, 'i').exec(st);
  if (m && normId(m[1]) !== 'on') {
    const { schema, name } = parseQN(m[2]);
    reg.add('index', schema, name, normId(m[1]));
    return;
  }
  m = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(st);
  if (m) {
    for (const t of splitTop(m[1])) {
      const { schema, name } = parseQN(t);
      reg.remove('index', schema, null, name);
    }
    return;
  }
  m = new RegExp(`^ALTER\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?(${QN})\\s+RENAME\\s+TO\\s+(${ID})`, 'i').exec(st);
  if (m) {
    const { schema, name } = parseQN(m[1]);
    const e = reg.items.get(reg.key('index', schema, null, name));
    reg.remove('index', schema, null, name);
    reg.items.set(reg.key('index', schema, null, normId(m[2])), { type: 'index', schema, parent: e ? e.parent : null, name: normId(m[2]), mig: reg.cur });
    return;
  }

  // FUNCTION / PROCEDURE
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\s\S]*)$/i.exec(st);
  if (m) {
    const f = parseFunctionRef(m[1]);
    if (f) reg.add('function', f.schema, null, f.name);
    else reg.warn(`函式簽章解析失敗：${st.slice(0, 80)}`);
    return;
  }
  m = /^DROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(st);
  if (m) {
    for (const part of splitFunctionList(m[1])) {
      const f = parseFunctionRef(part);
      if (f) reg.remove('function', f.schema, null, f.name);
      else reg.warn(`DROP FUNCTION 解析失敗：${part.slice(0, 80)}`);
    }
    return;
  }
  m = /^ALTER\s+(?:FUNCTION|PROCEDURE)\s+([\s\S]*)$/i.exec(st);
  if (m) {
    const f = parseFunctionRef(m[1]);
    if (!f) return;
    const tail = m[1].slice(f.end).trim();
    let r;
    if ((r = new RegExp(`^RENAME\\s+TO\\s+(${ID})`, 'i').exec(tail))) {
      const argsPart = f.name.slice(f.name.indexOf('('));
      reg.remove('function', f.schema, null, f.name);
      reg.add('function', f.schema, null, quoteIfNeeded(normId(r[1])) + argsPart, { keepExisting: false });
    } else if (/^SET\s+SCHEMA\b/i.test(tail)) reg.warn(`函式 SET SCHEMA 未處理：${f.name}`);
    return;
  }

  // SEQUENCE / TYPE / EXTENSION
  m = new RegExp(`^CREATE\\s+SEQUENCE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[1]); reg.add('sequence', schema, null, name); return; }
  m = new RegExp(`^DROP\\s+SEQUENCE\\s+(?:IF\\s+EXISTS\\s+)?(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[1]); reg.remove('sequence', schema, null, name); return; }
  m = new RegExp(`^CREATE\\s+TYPE\\s+(${QN})\\s+AS\\s+ENUM`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[1]); reg.add('type', schema, null, name); return; }
  m = new RegExp(`^DROP\\s+TYPE\\s+(?:IF\\s+EXISTS\\s+)?(${QN})`, 'i').exec(st);
  if (m) { const { schema, name } = parseQN(m[1]); reg.remove('type', schema, null, name); return; }
  m = new RegExp(`^CREATE\\s+EXTENSION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${ID})`, 'i').exec(st);
  if (m) { reg.add('extension', '', null, normId(m[1])); return; }
  m = new RegExp(`^DROP\\s+EXTENSION\\s+(?:IF\\s+EXISTS\\s+)?(${ID})`, 'i').exec(st);
  if (m) { reg.remove('extension', '', null, normId(m[1])); return; }

  // 權限碼、儲存空間
  if (/^INSERT\s+INTO\s+(?:public\.|"public"\.)?"?permissions"?\s*\(/i.test(st)) {
    handleInsertWithValues(reg, st, /^INSERT\s+INTO\s+(?:public\.|"public"\.)?"?permissions"?\s*\(([^)]*)\)\s*/i, 'code', 'permission');
    return;
  }
  if (/^INSERT\s+INTO\s+storage\.buckets\s*\(/i.test(st)) {
    handleInsertWithValues(reg, st, /^INSERT\s+INTO\s+storage\.buckets\s*\(([^)]*)\)\s*/i, 'id', 'bucket');
    return;
  }
  if (/^DELETE\s+FROM\s+(?:public\.)?permissions\b/i.test(st)) {
    reg.warn(`DELETE FROM permissions 未處理：${st.slice(0, 80)}`);
  }
}

const DO_KEYWORD = /\b(CREATE|ALTER|DROP|INSERT\s+INTO|EXECUTE)\b/i;
const DO_PREFIX = /^(?:BEGIN|ELSE|ELSIF\b.*\bTHEN|IF\b.*\bTHEN|EXCEPTION|WHEN\b.*\bTHEN|DECLARE\b.*\bBEGIN|LOOP)$/i;

function handleDoBody(reg, body, depth) {
  if (depth > 4) return;
  for (const s of splitStatements(body)) {
    const masked = maskStrings(s.head);
    const km = DO_KEYWORD.exec(masked);
    if (!km) continue;
    // 只接受「控制字 + 關鍵字」開頭，避免 RAISE 訊息或 SELECT 內文誤判
    const before = masked.slice(0, km.index).trim();
    if (before && !DO_PREFIX.test(before)) continue;
    if (/^EXECUTE$/i.test(km[0])) {
      const rest = s.head.slice(km.index + km[0].length).trim();
      if (s.bodies.length && /^\$\$~\$\$/.test(rest)) {
        for (const inner of splitStatements(s.bodies[0])) handleStatement(reg, inner, depth + 1);
      } else {
        reg.warn(`動態 SQL 略過：${s.head.slice(km.index, km.index + 70)}`);
      }
      continue;
    }
    handleStatement(reg, { head: s.head.slice(km.index), bodies: s.bodies }, depth + 1);
  }
}

// ---------------------------------------------------------------- 主流程
function processMigrations(dir = MIG_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const reg = new Registry();
  files.forEach((f, idx) => {
    reg.cur = idx;
    reg.curName = f;
    reg.graveyard.clear();
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const stmt of splitStatements(text)) {
      try { handleStatement(reg, stmt); } catch (e) { reg.warn(`處理失敗：${e.message}：${stmt.head.slice(0, 80)}`); }
    }
  });
  return { files: files.map((f) => f.replace(/\.sql$/, '')), registry: reg };
}

const TYPE_ORDER = ['extension', 'type', 'sequence', 'table', 'column', 'function', 'trigger', 'policy', 'index', 'bucket', 'permission'];

function collectItems({ files, registry }) {
  const label = (e) => `${e.schema}.${e.parent || ''}.${e.name}`;
  const items = [...registry.items.values()];
  items.sort((a, b) => a.mig - b.mig || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0));
  const used = new Set(items.map((e) => e.mig));
  const unchecked = files.filter((_, i) => !used.has(i));
  return { items, unchecked };
}

const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function renderSql({ files, items, unchecked }) {
  const used = [...new Set(items.map((e) => e.mig))].sort((a, b) => a - b);
  const remap = new Map(used.map((m, i) => [m, i + 1]));
  const byType = {};
  for (const e of items) byType[e.type] = (byType[e.type] || 0) + 1;
  const cnt = (t) => byType[t] || 0;
  const header = `-- M9 上線前唯讀檢查 00c：舊版 supabase/migrations 每一支 migration 建立的東西，正式區到底有沒有？
-- 為什麼要跑：00b 只查了 239 個「新版依賴」的物件，結果就缺了 9 項（督導管理 4 張表與 3 個函式、QR 作廢觸發器、pg_cron），
--   證明舊版 supabase/migrations 有些從沒在正式區套用過。這份把「所有」migration 建立、而且目前仍該存在的物件逐一查一遍，
--   並依 migration 彙總，一眼看出「整支沒套用」還是「只缺一部分」。
--
-- 怎麼用（老闆照做即可）：
--   1. 打開正式區 Supabase 的 SQL Editor，新開一個查詢。
--   2. 把這個檔案整份貼上，按 Run。
--   3. 結果只有一列一格（欄位名 result，內容是一段 JSON）。點開那一格，整段複製，貼回給我。
--   4. 這份只有查詢，不會建立、修改、刪除任何東西，可以隨時重複執行。
--
-- 怎麼看結果：
--   generated_at            執行時間
--   total_checked           總共檢查幾個物件
--   present_count           正式區已經有的數量
--   missing                 正式區「沒有」的清單；每筆有 type（資料表 table／欄位 column／函式 function／觸發器 trigger／RLS 政策 policy／
--                           索引 index／儲存空間 bucket／權限碼 permission／序列 sequence／型別 type／擴充 extension）、
--                           name（物件名稱；欄位寫成 schema.表.欄；觸發器與政策寫成「名稱 on 表」；函式含參數型別）、migration（哪一支 migration 建立它）
--   missing_by_migration    依 migration 彙總，只列「有缺東西」的：missing_count 缺幾個、total 該支共檢查幾個、
--                           status = all_missing 代表整支 migration 看起來完全沒套用；status = partial 代表只缺一部分（可能被手動改過或只套用一半）
--   migrations_checked      有物件可檢查的 migration 支數
--   migrations_all_missing  其中「整支沒套用」的支數
--   migrations_partial      其中「只缺一部分」的支數
--   unchecked_migrations    這幾支 migration 沒有任何可檢查的物件（只改資料、權限授與或函式內容），這份查不出它們有沒有套用
--   missing 是空的 []，代表舊版 migration 建立的東西正式區都齊了。
--
-- 判斷規則（以最終狀態為準）：
--   依檔名順序模擬每一支 migration：後來被刪除的表、欄位、函式、觸發器、政策、索引不檢查；改名的以新名稱檢查（算在改名那支）；
--   同一支 migration 內「先刪再重建」視為同一個物件，仍算在最初建立它的那支。
--   同一個物件被多支 migration 重複建立或覆寫（例如 CREATE OR REPLACE FUNCTION），只算在最初建立它的那支。
--   只檢查「存在」，不比對函式內容、政策條件、欄位型別與預設值：換句話說「舊版後續把函式改寫成新內容」這件事這份查不出來。
--   權限碼只看 permissions 表有沒有這個 code，不看 is_active；也不檢查 role_permissions 授與。
--   dev_schema_baseline 與 20260724 開頭的 production_*_compatibility 是替 DEV 補正式區既有物件寫的，
--   若它們被列為缺，多半代表該物件在正式區用別的方式建立或根本不存在，請對照 00b 與步驟清單判讀，不必當成「漏套用」。
--
-- 檢查範圍（共 ${items.length} 項，來自 ${used.length} 支 migration）：
--   資料表 ${cnt('table')}、欄位 ${cnt('column')}、函式 ${cnt('function')}（含參數簽章）、觸發器 ${cnt('trigger')}、RLS 政策 ${cnt('policy')}、索引 ${cnt('index')}、
--   儲存空間 ${cnt('bucket')}、權限碼 ${cnt('permission')}、序列 ${cnt('sequence')}、型別 ${cnt('type')}、擴充 ${cnt('extension')}。
-- 本檔由 scripts/m9-coverage/build.cjs 自動產生，請勿手改；migration 有變動時重跑：node scripts/m9-coverage/build.cjs
-- 只用 SELECT／WITH 與 to_regprocedure、pg_catalog、pg_policies、pg_indexes、information_schema、storage.buckets、public.permissions 查詢。
`;

  const migsVals = used.map((m) => `  (${remap.get(m)}, ${sq(files[m])})`).join(',\n');
  const itemVals = items.map((e) => {
    const p = e.parent ? sq(e.parent) : 'NULL';
    return `  (${sq(e.type)}, ${sq(e.schema)}, ${p}, ${sq(e.name)}, ${remap.get(e.mig)})`;
  }).join(',\n');
  const uncheckedJson = JSON.stringify(unchecked);

  return `${header}WITH migs(mi, mname) AS (VALUES
${migsVals}
),
items(t, s, p, n, mi) AS (VALUES
${itemVals}
),
chk AS (
  SELECT i.t, i.s, i.p, i.n, g.mname,
    CASE i.t
      WHEN 'table' THEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = i.s AND c.relname = i.n AND c.relkind IN ('r', 'p'))
      WHEN 'column' THEN EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = i.s AND c.table_name = i.p AND c.column_name = i.n)
      WHEN 'function' THEN to_regprocedure(i.s || '.' || i.n) IS NOT NULL
      WHEN 'trigger' THEN EXISTS (SELECT 1 FROM pg_trigger g2 JOIN pg_class c ON c.oid = g2.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE g2.tgname = i.n AND c.relname = i.p AND ns.nspname = i.s AND NOT g2.tgisinternal)
      WHEN 'policy' THEN EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = i.s AND pp.tablename = i.p AND pp.policyname = i.n)
      WHEN 'index' THEN EXISTS (SELECT 1 FROM pg_indexes ix WHERE ix.schemaname = i.s AND ix.indexname = i.n)
      WHEN 'bucket' THEN EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = i.n)
      WHEN 'permission' THEN EXISTS (SELECT 1 FROM public.permissions pm WHERE pm.code = i.n)
      WHEN 'sequence' THEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = i.s AND c.relname = i.n AND c.relkind = 'S')
      WHEN 'type' THEN EXISTS (SELECT 1 FROM pg_type ty JOIN pg_namespace ns ON ns.oid = ty.typnamespace WHERE ns.nspname = i.s AND ty.typname = i.n)
      WHEN 'extension' THEN EXISTS (SELECT 1 FROM pg_extension ex WHERE ex.extname = i.n)
      ELSE false
    END AS ok,
    CASE i.t
      WHEN 'column' THEN i.s || '.' || i.p || '.' || i.n
      WHEN 'trigger' THEN i.n || ' on ' || i.s || '.' || i.p
      WHEN 'policy' THEN i.n || ' on ' || i.s || '.' || i.p
      WHEN 'bucket' THEN i.n
      WHEN 'permission' THEN i.n
      WHEN 'extension' THEN i.n
      ELSE i.s || '.' || i.n
    END AS disp
  FROM items i JOIN migs g ON g.mi = i.mi
),
by_mig AS (
  SELECT mname, count(*) FILTER (WHERE NOT ok) AS missing_count, count(*) AS total
  FROM chk GROUP BY mname
)
SELECT jsonb_build_object(
         'generated_at', to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
         'total_checked', (SELECT count(*) FROM chk),
         'present_count', (SELECT count(*) FROM chk WHERE ok),
         'missing', coalesce((SELECT jsonb_agg(jsonb_build_object('type', t, 'name', disp, 'migration', mname) ORDER BY mname, t, disp) FROM chk WHERE NOT ok), '[]'::jsonb),
         'missing_by_migration', coalesce((SELECT jsonb_agg(jsonb_build_object('migration', mname, 'missing_count', missing_count, 'total', total, 'status', CASE WHEN missing_count = total THEN 'all_missing' ELSE 'partial' END) ORDER BY mname) FROM by_mig WHERE missing_count > 0), '[]'::jsonb),
         'migrations_checked', (SELECT count(*) FROM by_mig),
         'migrations_all_missing', (SELECT count(*) FROM by_mig WHERE missing_count = total),
         'migrations_partial', (SELECT count(*) FROM by_mig WHERE missing_count > 0 AND missing_count < total),
         'unchecked_migrations', ${sq(uncheckedJson)}::jsonb
       ) AS result;
`;
}

function build(dir = MIG_DIR) {
  const res = processMigrations(dir);
  const { items, unchecked } = collectItems(res);
  const sql = renderSql({ files: res.files, items, unchecked });
  return { sql, items, unchecked, files: res.files, warnings: res.registry.warnings };
}

module.exports = { splitStatements, splitTop, parseArgTypes, parseFunctionRef, Registry, handleStatement, processMigrations, collectItems, renderSql, build, MIG_DIR, OUT_FILE };

if (require.main === module) {
  const { sql, items, unchecked, warnings } = build();
  if (process.argv.includes('--stdout')) process.stdout.write(sql);
  else {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, sql, 'utf8');
  }
  const by = {};
  for (const e of items) by[e.type] = (by[e.type] || 0) + 1;
  console.error(`檢查項目 ${items.length}：${JSON.stringify(by)}`);
  console.error(`沒有可檢查物件的 migration ${unchecked.length} 支：${unchecked.join(', ')}`);
  for (const w of warnings) console.error('警告 ' + w);
}
