'use strict';
/**
 * 把差異確認頁的答案套用到白名單。
 *   node scripts/allowlist-review/apply.cjs <answers.json> [--date YYYY-MM-DD] [--dry-run]
 *        [--allowlist <path>] [--plain <path>] [--out-dir <dir>]
 * approve -> approvedBy 設為 "user (<date> 差異確認頁)"；revert／discuss／未選 -> 不改白名單。
 * 只改 approvedBy 為 null 且沒有 decision 的條目；其他一律跳過並警告。
 * 另產出 decisions-<date>.md（要改回、要再討論、未決定、各組備註、整體備註）。
 */
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.cjs');

const CHOICES = ['approve', 'revert', 'discuss'];

/** 接受 ArtifactData 讀回的外層包裝 {id,data:{...}}，也接受直接的 doc 內容。 */
function unwrapAnswers(json) {
  let o = json;
  for (let i = 0; i < 3 && o && typeof o === 'object' && !('answers' in o) && o.data && typeof o.data === 'object'; i++) o = o.data;
  if (!o || typeof o !== 'object' || typeof o.answers !== 'object' || o.answers === null) throw new Error('答案檔格式不對：找不到 answers');
  return o;
}

function applyAnswers({ list, doc, date }) {
  const stamp = `user (${date} 差異確認頁)`;
  const byId = new Map(list.map((e) => [e.id, e]));
  const approved = [], reverted = [], discussed = [], warnings = [];
  const entryIds = Array.isArray(doc.entryIds) ? doc.entryIds : list.filter(L.isPending).map((e) => e.id);
  const choiceOf = {};
  const pendingAtStart = new Set(list.filter(L.isPending).map((e) => e.id));
  for (const [id, a] of Object.entries(doc.answers)) {
    const choice = a && typeof a.choice === 'string' ? a.choice : '';
    if (choice && !CHOICES.includes(choice)) { warnings.push(`${id}：不認得的選項 "${choice}"，視為未決定`); continue; }
    const e = byId.get(id);
    if (!e) { warnings.push(`${id}：白名單裡找不到這個 id，已略過`); continue; }
    if (!choice) continue;
    if (!L.isPending(e)) {
      warnings.push(e.decision === 'fix' ? `${id}：已排定要修（decision: fix），不改` : `${id}：已核可（${e.approvedBy}），不改`);
      continue;
    }
    choiceOf[id] = choice;
    if (choice === 'approve') { e.approvedBy = stamp; approved.push(id); }
    else if (choice === 'revert') reverted.push(id);
    else discussed.push(id);
  }
  const undecided = entryIds.filter((id) => pendingAtStart.has(id) && !choiceOf[id]);
  return { approved, reverted, discussed, undecided, warnings, choiceOf };
}

function mdEscape(s) { return String(s == null ? '' : s).replace(/\r?\n/g, ' ').trim(); }

function renderDecisions({ date, result, doc, original, plain }) {
  const byId = new Map(original.map((e) => [e.id, e]));
  const topicTitle = new Map(plain.topics.map((t) => [t.key, t.title]));
  const title = (id) => (plain.items[id] && plain.items[id].title) || (byId.get(id) ? byId.get(id).description.slice(0, 40) : id);
  const note = (id) => mdEscape(doc.answers[id] && doc.answers[id].note);
  const lines = [`# 差異確認結果 ${date}`, ''];
  lines.push(`- 同意：${result.approved.length} 項（已寫入白名單 approvedBy）`);
  lines.push(`- 要改回跟舊版一樣：${result.reverted.length} 項`);
  lines.push(`- 要再討論：${result.discussed.length} 項`);
  lines.push(`- 未決定：${result.undecided.length} 項`, '');
  const section = (heading, ids, withNote) => {
    lines.push(`## ${heading}`, '');
    if (!ids.length) { lines.push('（無）', ''); return; }
    for (const id of ids) {
      const n = note(id);
      lines.push(`- **${mdEscape(title(id))}**（\`${id}\`）${withNote && n ? `：${n}` : ''}`);
      if (!withNote && n) lines.push(`  - 備註：${n}`);
    }
    lines.push('');
  };
  section('要改回跟舊版一樣', result.reverted, true);
  section('要再討論', result.discussed, true);
  section('未決定', result.undecided, false);
  lines.push('## 各組備註', '');
  const gn = Object.entries(doc.groupNotes || {}).filter(([, v]) => String(v || '').trim());
  if (!gn.length) lines.push('（無）');
  for (const [k, v] of gn) lines.push(`- ${topicTitle.get(k) || k}：${mdEscape(v)}`);
  lines.push('', '## 整體備註', '', String(doc.general || '').trim() || '（無）', '');
  if (result.warnings.length) {
    lines.push('## 套用時的警告', '');
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const { positional, flags } = L.parseArgs(process.argv.slice(2), ['--date', '--allowlist', '--plain', '--out-dir']);
  if (!positional[0]) throw new Error('用法：apply.cjs <answers.json> [--date YYYY-MM-DD] [--dry-run] [--allowlist <path>] [--plain <path>] [--out-dir <dir>]');
  const date = flags.date || L.todayLocal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date 格式要是 YYYY-MM-DD：${date}`);
  const dry = !!flags['dry-run'];
  const allowFile = flags.allowlist || L.DEFAULT_ALLOWLIST;
  const text = L.readText(allowFile);
  const fmt = L.detectFormat(text);
  const list = JSON.parse(text);
  const original = JSON.parse(text);
  const preErrors = L.validateAllowlist(list);
  if (preErrors.length) throw new Error(`套用前白名單就不合法，未寫入：\n- ${preErrors.join('\n- ')}`);
  const doc = unwrapAnswers(L.readJson(positional[0]));
  const plain = L.loadPlain(flags.plain || L.DEFAULT_PLAIN);

  const result = applyAnswers({ list, doc, date });
  const errors = L.validateAllowlist(list);
  if (errors.length) throw new Error(`套用後白名單不合法，未寫入：\n- ${errors.join('\n- ')}`);

  const outDir = flags['out-dir'] || L.REVIEW_DIR;
  const mdPath = path.join(outDir, `decisions-${date}.md`);
  const changed = result.approved.length > 0;
  if (!dry) {
    if (changed) fs.writeFileSync(allowFile, L.serialize(list, fmt), 'utf8');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(mdPath, renderDecisions({ date, result, doc, original, plain }), 'utf8');
  }
  process.stdout.write(JSON.stringify({
    dryRun: dry, date, allowlist: allowFile, written: !dry && changed, decisionsFile: dry ? null : mdPath,
    approved: result.approved.length, reverted: result.reverted.length, discussed: result.discussed.length, undecided: result.undecided.length,
    warnings: result.warnings,
  }, null, 2) + '\n');
}

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(`錯誤：${e.message}\n`); process.exit(1); }
}
module.exports = { unwrapAnswers, applyAnswers, renderDecisions };
