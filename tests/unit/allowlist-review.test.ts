import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { validateAllowlist as validateTs } from '../support/parity';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..');
const dir = path.join(root, 'scripts', 'allowlist-review');
const lib = require(path.join(dir, 'lib.cjs'));

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allowlist-review-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

type Opts = { indent?: string | number; crlf?: boolean; list?: unknown[] };

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id, page: 'p', description: `說明 ${id}`, reason: `原因 ${id}`, approvedBy: null, ...extra,
});
const fixture = () => [
  entry('pend-a'),
  entry('pend-b', { match: { kind: 'only-native', key: 'x' } }),
  entry('pend-c'),
  entry('done-1', { approvedBy: 'user (2026-11-02)' }),
  entry('fix-1', { decision: 'fix', fixIn: 'W25' }),
];
const dump = (list: unknown, o: Opts) => {
  let t = JSON.stringify(list, null, o.indent ?? 2);
  if (o.crlf) t = t.replace(/\n/g, '\r\n');
  return t + (o.crlf ? '\r\n' : '\n');
};

function setup(name: string, opts: Opts = {}) {
  const d = fs.mkdtempSync(path.join(tmp, `${name}-`));
  const allow = path.join(d, 'allowlist.json');
  fs.writeFileSync(allow, dump(opts.list || fixture(), opts));
  const plain = path.join(d, 'plain.json');
  fs.writeFileSync(plain, JSON.stringify({
    topics: [{ key: 't1', title: '主題一' }],
    items: { 'pend-a': { topic: 't1', title: '白話A', legacy: '舊', now: '新', impact: '影響', why: '原因' } },
  }));
  return { d, allow, plain };
}

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(dir, script), ...args], { encoding: 'utf8' });
}
function writeAnswers(d: string, doc: unknown, name = 'answers.json') {
  const f = path.join(d, name);
  fs.writeFileSync(f, JSON.stringify(doc));
  return f;
}
const DATE = '2026-12-01';
const stamp = `user (${DATE} 差異確認頁)`;
const applyArgs = (ans: string, s: { d: string; allow: string; plain: string }, extra: string[] = []) =>
  [ans, '--date', DATE, '--allowlist', s.allow, '--plain', s.plain, '--out-dir', s.d, ...extra];

describe('apply.cjs', () => {
  it('approve 寫入 approvedBy；revert／discuss／未選不動', () => {
    const s = setup('basic');
    const ans = writeAnswers(s.d, {
      answers: { 'pend-a': { choice: 'approve', note: '' }, 'pend-b': { choice: 'revert', note: '改回' }, 'pend-c': { choice: 'discuss', note: '' } },
      entryIds: ['pend-a', 'pend-b', 'pend-c'],
    });
    expect(run('apply.cjs', applyArgs(ans, s)).status).toBe(0);
    const list = JSON.parse(fs.readFileSync(s.allow, 'utf8'));
    const by = Object.fromEntries(list.map((e: { id: string }) => [e.id, e]));
    expect(by['pend-a'].approvedBy).toBe(stamp);
    expect(by['pend-b'].approvedBy).toBeNull();
    expect(by['pend-c'].approvedBy).toBeNull();
    const md = fs.readFileSync(path.join(s.d, `decisions-${DATE}.md`), 'utf8');
    expect(md).toContain('pend-b');
    expect(md).toContain('改回');
    expect(md).toContain('pend-c');
  });

  it('未選的項目列在未決定，各組與整體備註寫進 decisions', () => {
    const s = setup('undecided');
    const ans = writeAnswers(s.d, {
      answers: { 'pend-a': { choice: '', note: '' } }, entryIds: ['pend-a', 'pend-b'],
      groupNotes: { t1: '組備註內容' }, general: '整體備註內容',
    });
    expect(run('apply.cjs', applyArgs(ans, s)).status).toBe(0);
    const md = fs.readFileSync(path.join(s.d, `decisions-${DATE}.md`), 'utf8');
    const undecided = md.split('## 未決定')[1].split('## 各組備註')[0];
    expect(undecided).toContain('pend-a');
    expect(undecided).toContain('pend-b');
    expect(md).toContain('主題一：組備註內容');
    expect(md).toContain('整體備註內容');
  });

  it('已核可與 decision fix 的條目不被改，並列出警告', () => {
    const s = setup('skip');
    const before = fs.readFileSync(s.allow, 'utf8');
    const ans = writeAnswers(s.d, { answers: { 'done-1': { choice: 'approve' }, 'fix-1': { choice: 'approve' }, ghost: { choice: 'approve' } } });
    const r = run('apply.cjs', applyArgs(ans, s));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.warnings).toHaveLength(3);
    expect(out.approved).toBe(0);
    expect(fs.readFileSync(s.allow, 'utf8')).toBe(before);
  });

  it.each([false, true])('外層 {id,data} 包裝與直接內容兩種格式都接受（包裝=%s）', (wrap) => {
    const s = setup(`wrap${wrap}`);
    const doc = { answers: { 'pend-a': { choice: 'approve' } } };
    const ans = writeAnswers(s.d, wrap ? { id: 'review-x', data: doc } : doc);
    expect(run('apply.cjs', applyArgs(ans, s)).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(s.allow, 'utf8'))[0].approvedBy).toBe(stamp);
  });

  it('--dry-run 不寫白名單也不產出 decisions', () => {
    const s = setup('dry');
    const before = fs.readFileSync(s.allow, 'utf8');
    const ans = writeAnswers(s.d, { answers: { 'pend-a': { choice: 'approve' } } });
    const r = run('apply.cjs', applyArgs(ans, s, ['--dry-run']));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).approved).toBe(1);
    expect(fs.readFileSync(s.allow, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(s.d, `decisions-${DATE}.md`))).toBe(false);
  });

  it.each([
    ['2 空白 LF', { indent: 2 }],
    ['4 空白 LF', { indent: 4 }],
    ['tab LF', { indent: '\t' }],
    ['2 空白 CRLF', { indent: 2, crlf: true }],
  ] as [string, Opts][])('保持原本輸出格式（%s）', (_n, o) => {
    const s = setup('fmt', o);
    const ans = writeAnswers(s.d, { answers: { 'pend-a': { choice: 'approve' } } });
    expect(run('apply.cjs', applyArgs(ans, s)).status).toBe(0);
    const after = fs.readFileSync(s.allow, 'utf8');
    // 只有 pend-a 的 approvedBy 不同：把它還原後，應與原本逐字相同
    const list = JSON.parse(after);
    expect(list[0].approvedBy).toBe(stamp);
    list[0].approvedBy = null;
    expect(dump(list, o)).toBe(dump(fixture(), o));
    expect(after.endsWith(o.crlf ? '\r\n' : '\n')).toBe(true);
    expect(after.endsWith('\n\n')).toBe(false);
    // 縮排確實沿用
    const first = after.split(/\r?\n/)[1];
    expect(first.startsWith(typeof o.indent === 'string' ? o.indent : ' '.repeat(o.indent as number))).toBe(true);
  });

  it('白名單不合法時不寫入並報錯', () => {
    const bad = fixture();
    (bad[0] as Record<string, unknown>).description = '';
    const s = setup('bad', { list: bad });
    const before = fs.readFileSync(s.allow, 'utf8');
    const ans = writeAnswers(s.d, { answers: { 'pend-b': { choice: 'approve' } } });
    const r = run('apply.cjs', applyArgs(ans, s));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('不合法');
    expect(fs.readFileSync(s.allow, 'utf8')).toBe(before);
  });
});

describe('validateAllowlist 與 tests/support/parity.ts 等價', () => {
  const cases: unknown[] = [
    fixture(),
    'x',
    [entry('a'), entry('a')],
    [{ id: 'a', page: 'p', description: 'd', reason: 'r' }],
    [entry('a', { approvedBy: '' })],
    [entry('a', { decision: 'fix' })],
    [entry('a', { decision: 'fix', fixIn: 'W1', approvedBy: 'user' })],
    [entry('a', { decision: 'other' })],
    [entry('a', { match: { mechanism: 'bogus', key: 'k' } })],
    [entry('a', { match: {} })],
    [entry('a', { match: { kind: 'k', roles: 'x' } })],
    [null],
  ];
  it.each(cases.map((c, i) => [i, c] as [number, unknown]))('案例 %s', (_i, c) => {
    expect(lib.validateAllowlist(c)).toEqual(validateTs(c));
  });
  it('真實白名單兩邊都合法', () => {
    const real = JSON.parse(fs.readFileSync(path.join(root, 'tests/parity/allowlist.json'), 'utf8'));
    expect(lib.validateAllowlist(real)).toEqual([]);
    expect(validateTs(real)).toEqual([]);
  });
});

describe('extract.cjs', () => {
  it('列出待確認、要修與缺白話稿的 id', () => {
    const { allow, plain } = setup('extract');
    const r = run('extract.cjs', ['--allowlist', allow, '--plain', plain]);
    expect(r.status).toBe(0);
    const o = JSON.parse(r.stdout);
    const ids = (a: { id: string }[]) => a.map((e) => e.id);
    expect(ids(o.pending)).toEqual(['pend-a', 'pend-b', 'pend-c']);
    expect(ids(o.fix)).toEqual(['fix-1']);
    expect(ids(o.missingPlain)).toEqual(['pend-b', 'pend-c', 'fix-1']);
  });
});

describe('build.cjs', () => {
  it('HTML 含所有待確認 id、不含已核可 id，並轉義 </script>', () => {
    const list = fixture();
    (list[2] as Record<string, unknown>).description = '含 </script><script>alert(1)</script> 的說明';
    const { d, allow, plain } = setup('build', { list });
    const out = path.join(d, 'out.html');
    const r = run('build.cjs', [out, '--doc', 'review-test', '--allowlist', allow, '--plain', plain]);
    expect(r.status).toBe(0);
    const html = fs.readFileSync(out, 'utf8');
    for (const id of ['pend-a', 'pend-b', 'pend-c', 'fix-1']) expect(html).toContain(id);
    expect(html).not.toContain('done-1');
    expect(html).toContain('<title>差異確認頁</title>');
    expect(html).toContain('review-test');
    const m = /<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('<');
    const data = JSON.parse(m![1]);
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(['pend-a', 'pend-b', 'pend-c']);
    expect(data.items[2].description).toContain('</script><script>alert(1)</script>');
    expect(data.fixed.map((i: { id: string }) => i.id)).toEqual(['fix-1']);
    // 整份 HTML 只有兩個 script 區塊（資料＋程式），沒有被注入的第三個
    expect((html.match(/<script/g) || []).length).toBe(2);
  });

  it('預設 docId 為 review-<今天日期>', () => {
    const { d, allow, plain } = setup('docid');
    const r = run('build.cjs', [path.join(d, 'o.html'), '--allowlist', allow, '--plain', plain]);
    expect(JSON.parse(r.stdout).docId).toBe(`review-${lib.todayLocal()}`);
  });
});
