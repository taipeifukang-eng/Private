'use strict';
/** 差異確認頁工具的共用函式（只用 Node 內建模組）。 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ALLOWLIST = path.join(ROOT, 'tests', 'parity', 'allowlist.json');
const REVIEW_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'allowlist-review');
const DEFAULT_PLAIN = path.join(REVIEW_DIR, 'plain.json');
const MECHANISMS = ['api-read', 'write-readback', 'ui-extract', 'navigation'];

function parseArgs(argv, valueFlags = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (valueFlags.includes(a)) {
        if (i + 1 >= argv.length) throw new Error(`${a} 需要一個值`);
        flags[a.slice(2)] = argv[++i];
      } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

/** 讀 plain.json；檔案不存在視為空。 */
function loadPlain(file) {
  if (!fs.existsSync(file)) return { topics: [], items: {} };
  const j = readJson(file);
  return { topics: Array.isArray(j.topics) ? j.topics : [], items: j.items && typeof j.items === 'object' ? j.items : {} };
}

const isPending = (e) => !!e && e.approvedBy === null && e.decision === undefined;
const isFix = (e) => !!e && e.decision === 'fix';

/** 與 tests/support/parity.ts 的 validateAllowlist 等價的必要檢查。 */
function validateAllowlist(list) {
  const errors = [];
  if (!Array.isArray(list)) return ['allowlist 必須是陣列'];
  const ids = new Set();
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  list.forEach((e, i) => {
    const tag = `allowlist[${i}]${e && e.id ? `(${e.id})` : ''}`;
    if (!e || typeof e !== 'object') { errors.push(`${tag} 不是物件`); return; }
    for (const f of ['id', 'page', 'description', 'reason']) if (!nonEmpty(e[f])) errors.push(`${tag} 缺少 ${f}`);
    if (!('approvedBy' in e)) errors.push(`${tag} 缺少 approvedBy（未核可請填 null）`);
    else if (e.approvedBy !== null && !nonEmpty(e.approvedBy)) errors.push(`${tag} approvedBy 必須是非空字串或 null`);
    if (e.deferredTo !== undefined && !nonEmpty(e.deferredTo)) errors.push(`${tag} deferredTo 必須是非空字串（工作項 ID）`);
    if (e.decision !== undefined && e.decision !== 'fix') errors.push(`${tag} decision 目前只接受 "fix"`);
    if (e.fixIn !== undefined && !nonEmpty(e.fixIn)) errors.push(`${tag} fixIn 必須是非空字串（工作項 ID）`);
    if (e.decision === 'fix') {
      if (!nonEmpty(e.fixIn)) errors.push(`${tag} decision 為 fix 時 fixIn 必須是非空字串`);
      if (e.approvedBy !== null) errors.push(`${tag} decision 為 fix 時 approvedBy 必須為 null（必須修正的差異不可標為已核可）`);
    }
    if (e.id) {
      if (ids.has(e.id)) errors.push(`${tag} id 重複`);
      ids.add(e.id);
    }
    if (e.match !== undefined) {
      if (typeof e.match !== 'object' || e.match === null) errors.push(`${tag} match 必須是物件`);
      else {
        if (e.match.mechanism && !MECHANISMS.includes(e.match.mechanism)) errors.push(`${tag} match.mechanism 不合法`);
        if (e.match.roles && !Array.isArray(e.match.roles)) errors.push(`${tag} match.roles 必須是陣列`);
        if (!e.match.kind && !e.match.key && !e.match.entry) errors.push(`${tag} match 至少要有 kind / key / entry 其中之一，避免範圍過大`);
      }
    }
  });
  return errors;
}

/** 偵測原檔縮排與換行，序列化時保持一致，結尾一律換行。 */
function detectFormat(text) {
  const m = /^\[\r?\n([ \t]+)\S/.exec(text);
  const indent = m ? m[1] : 2;
  const crlf = /\r\n/.test(text);
  return { indent: typeof indent === 'string' && /^\t+$/.test(indent) ? '\t' : typeof indent === 'string' ? indent.length : indent, crlf };
}

function serialize(list, fmt) {
  let out = JSON.stringify(list, null, fmt.indent);
  if (fmt.crlf) out = out.replace(/\n/g, '\r\n');
  return out + (fmt.crlf ? '\r\n' : '\n');
}

module.exports = {
  ROOT, DEFAULT_ALLOWLIST, DEFAULT_PLAIN, REVIEW_DIR,
  parseArgs, todayLocal, readText, readJson, loadPlain, isPending, isFix, validateAllowlist, detectFormat, serialize,
};
