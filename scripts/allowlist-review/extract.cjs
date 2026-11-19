'use strict';
/**
 * 列出待確認與已排定要修的白名單條目，以及尚無白話稿的 id。輸出 JSON 到 stdout。
 *   node scripts/allowlist-review/extract.cjs [--allowlist <path>] [--plain <path>]
 */
const L = require('./lib.cjs');

function main() {
  const { flags } = L.parseArgs(process.argv.slice(2), ['--allowlist', '--plain']);
  const list = L.readJson(flags.allowlist || L.DEFAULT_ALLOWLIST);
  const plain = L.loadPlain(flags.plain || L.DEFAULT_PLAIN);
  const slim = (e) => ({ id: e.id, page: e.page, description: e.description, reason: e.reason, ...(e.fixIn ? { fixIn: e.fixIn } : {}) });
  const pending = list.filter(L.isPending);
  const fix = list.filter(L.isFix);
  const missingPlain = [...pending, ...fix].filter((e) => !plain.items[e.id]).map(slim);
  process.stdout.write(JSON.stringify({
    counts: { total: list.length, pending: pending.length, fix: fix.length, missingPlain: missingPlain.length },
    pending: pending.map(slim),
    fix: fix.map(slim),
    missingPlain,
  }, null, 2) + '\n');
}

try { main(); } catch (e) { process.stderr.write(`錯誤：${e.message}\n`); process.exit(1); }
