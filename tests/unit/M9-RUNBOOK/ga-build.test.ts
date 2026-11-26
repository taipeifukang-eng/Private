import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 第二份正式區操作頁（水電話費請款 G46 + 採購請款改善 B1）的產生器測試。只讀檔、不連資料庫。
// 主流程（92 步）的斷言留在 build.test.ts，這裡只驗證 GA 模型，以及它沒有影響主流程。
const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..', '..');
const builder = nodeRequire(path.join(root, 'scripts', 'm9-runbook', 'build.cjs')) as {
  buildModel: (opts?: { planDir?: string; readmePath?: string; profile?: string }) => any;
  renderHtml: (model: any) => string;
  parseReadme: (text: string) => { steps: any[]; claimed: number };
  PLAN_DIR: string;
};
const planDir = builder.PLAN_DIR;
const readmePath = path.join(planDir, 'ga-post-cutover-runbook.md');
const readmeText = fs.readFileSync(readmePath, 'utf8');
const ga = builder.buildModel({ profile: 'ga' });
const main = builder.buildModel();
const gaHtml = builder.renderHtml(ga);
const mainHtml = builder.renderHtml(main);

type Block = { label: string; file: string; sql: string };
const allBlocks = (s: any): Block[] => Object.values(s.blocks as Record<string, Block[]>).flat();
const byReadme = (n: number) => ga.steps.find((s: any) => s.readmeNo === n);
const byId = (id: string) => ga.steps.find((s: any) => s.id === id);
const indexOf = (id: string) => ga.steps.findIndex((s: any) => s.id === id);

/** 去掉註解與字串，只留語句骨架，用來判斷是不是只有 SELECT／WITH。 */
function statements(sql: string): string[] {
  // 逐字元掃描：去掉註解、字串與 $tag$ 引號內容，只留語句骨架
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j; out += ' '; continue; }
    if (two === '/*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; out += ' '; continue; }
    const c = sql[i];
    if (c === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i += 1; break; }
        else i += 1;
      }
      out += "''";
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const j = sql.indexOf(m[0], i + m[0].length);
        i = j < 0 ? sql.length : j + m[0].length;
        out += "''";
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out.split(';').map((x) => x.trim()).filter(Boolean);
}
const onlySelect = (sql: string) => statements(sql).every((x) => /^(SELECT|WITH)\b/i.test(x));

describe('GA 操作頁：總表與步驟', () => {
  it('總表解析出 13 步，序號連續，合計與實際一致', () => {
    const p = builder.parseReadme(readmeText);
    expect(p.steps.length).toBe(13);
    expect(p.claimed).toBe(13);
    expect(p.steps.map((s: any) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('頁面步驟 = 總表 13 步 + 12 個額外步驟，每個總表步驟出現一次且順序不變', () => {
    expect(ga.meta.readmeStepCount).toBe(13);
    expect(ga.meta.readmeStepsIncluded).toBe(13);
    expect(ga.meta.stepCount).toBe(25);
    expect(ga.meta.estMinutes).toBe(184);
    expect(ga.meta.excludedReadmeSteps).toEqual([]);
    const nos = ga.steps.filter((s: any) => s.readmeNo).map((s: any) => s.readmeNo);
    expect(nos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(ga.steps.map((s: any) => s.no)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('順序：前置確認 → G46（預覽、黃金快照、01-04）→ G46 後比對 → 廠商／補填／驗收／授權 → B1（預覽、01-05）→ 重跑預覽、黃金比對 → 96（前置檢查、96）→ SQL 做完的下一步提醒 → 收尾', () => {
    const ids = ga.steps.map((s: any) => s.id);
    const order = ['x-ga-gate', 's01', 'x-ga-golden-before', 's02', 's03', 's04', 's05', 'x-ga-golden-g46', 'x-ga-vendors', 'x-ga-payees', 'x-ga-acceptance', 'x-ga-grants', 's06', 's07', 's08', 's09', 's10', 's11', 'x-ga-b1-recheck', 'x-ga-golden-b1', 'x-ga-buyer', 's12', 's13', 'x-ga-after-sql', 'x-ga-closing'];
    expect(ids).toEqual(order);
  });

  it('每個總表步驟的檔案都存在，且指向 G46 或 B1 資料夾', () => {
    for (const s of ga.steps.filter((x: any) => x.readmeNo)) {
      for (const b of s.blocks.main as Block[]) {
        expect(fs.existsSync(path.join(planDir, b.file)), b.file).toBe(true);
        expect(b.file).toMatch(/^(ga-utility-payment-sql|ga-improve-b1-sql|m9-sql\/96_inspection_gps_exempt_save)/);
      }
    }
  });

  it('01 至 04（G46）與 01 至 05（B1）都附 verify 與 rollback；兩個 00 預覽沒有', () => {
    for (const n of [2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      const s = byReadme(n);
      expect(s.blocks.verify.length, 'verify ' + n).toBeGreaterThan(0);
      expect(s.blocks.rollback.length, 'rollback ' + n).toBe(1);
      expect(s.blocks.verify[0].file).toMatch(/\.verify\.sql$/);
      expect(s.blocks.rollback[0].file).toMatch(/\.rollback\.sql$/);
    }
    for (const n of [1, 6, 12]) expect(byReadme(n).blocks.rollback.length).toBe(0);
    expect(byReadme(13).blocks.verify[0].file).toBe('m9-sql/96_inspection_gps_exempt_save.verify.sql');
    expect(byReadme(13).blocks.rollback[0].file).toBe('m9-sql/96_inspection_gps_exempt_save.rollback.sql');
  });

  it('不含 G46 選用的 05 補填（老闆決定不跑）', () => {
    for (const s of ga.steps) for (const b of allBlocks(s)) expect(b.file).not.toMatch(/05-backfill-payee/);
  });
});

describe('GA 操作頁：SQL 逐字、備份、只讀', () => {
  it('來自檔案的 SQL 區塊（非產生的備份）與檔案內容逐字相同', () => {
    for (const s of ga.steps) {
      for (const b of allBlocks(s)) {
        if (!b.file || !b.file.endsWith('.sql')) continue;
        if (/^備份/.test(b.label)) continue; // 函式備份是依檔內名單產生的查詢
        const disk = fs.readFileSync(path.join(planDir, b.file), 'utf8');
        expect(b.sql, b.file).toBe(disk);
      }
    }
  });

  it('G46 第 1 份（總表第 2 步）有備份：四張表與 9 支函式全文', () => {
    const s = byReadme(2);
    expect(s.blocks.backup.length).toBe(2);
    const t = s.blocks.backup[0].sql;
    for (const tbl of ['ga_utility_bills', 'ga_payment_requests', 'ga_workflow_settings', 'ga_service_categories']) {
      expect(t).toContain('public.' + tbl);
      expect(t).toContain('zz_bak_gaup_');
    }
    const f = s.blocks.backup[1].sql;
    for (const fn of ['ga_utility_bill_before_write', 'ga_ub_json', 'ga_ws_ub_save', 'ga_ws_ub_list', 'ga_pay_request_json', 'ga_ws_pay_request_list', 'ga_ws_pay_request_update', 'ga_ws_pay_request_action', 'ga_ws_pay_export']) {
      expect(f).toContain(fn);
    }
    expect(onlySelect(f)).toBe(true);
    expect(s.backupText).toContain('備份 SQL');
  });

  it('B1 第 1 份（總表第 7 步）有備份：既有表與函式全文，函式名單取自預覽檔', () => {
    const s = byReadme(7);
    expect(s.blocks.backup.length).toBe(2);
    expect(s.blocks.backup[0].sql).toContain('zz_bak_gaib1_');
    expect(s.blocks.backup[0].sql).toContain('public.ga_payment_requests');
    expect(s.blocks.backup[0].sql).toContain('public.ga_purchase_orders');
    expect(s.blocks.backup[1].sql).toContain('public.ga_pay_apply_lines(uuid,uuid,jsonb)');
    expect(s.blocks.backup[1].sql).toContain('to_regprocedure');
    expect(onlySelect(s.blocks.backup[1].sql)).toBe(true);
  });

  it('B1 函式備份 SQL：完整收進含 uuid[] 的簽名，單引號成對，不被第一個 ] 截斷', () => {
    const sql: string = byReadme(7).blocks.backup[1].sql;
    const m = sql.match(/unnest\(ARRAY\[([\s\S]*?)\]\) AS x\(sig\)/);
    expect(m).not.toBeNull();
    const list = m![1];
    expect(list).toContain("'public.ga_pay_po_amounts(uuid[])'");
    expect(list.length).toBeGreaterThan(list.indexOf("'public.ga_pay_po_amounts(uuid[])'") + "'public.ga_pay_po_amounts(uuid[])'".length);
    expect(list.replace(/\s+/g, '')).toMatch(/'public\.ga_pay_po_amounts\(uuid\[\]\)','/);
    expect((sql.match(/'/g) ?? []).length % 2).toBe(0);
    const sigs = list.match(/'[^']*'/g) ?? [];
    expect(sigs.length).toBeGreaterThan(1);
    expect(list.replace(/'[^']*'/g, '').replace(/[\s,]/g, '')).toBe('');
  });

  it('其他套用步驟不重複附備份（沿用第 2、7 步的備份）', () => {
    for (const n of [3, 4, 5, 8, 9, 10, 11, 12]) expect(byReadme(n).blocks.backup.length, String(n)).toBe(0);
  });

  it('96（總表第 13 步）有函式全文備份（只有 SELECT）', () => {
    const s = byReadme(13);
    expect(s.blocks.backup.length).toBe(1);
    expect(s.blocks.backup[0].sql).toContain("p.proname = 'workspace_save_inspection'");
    expect(s.blocks.backup[0].sql).toContain('pg_get_functiondef');
    expect(onlySelect(s.blocks.backup[0].sql)).toBe(true);
    expect(s.backupText).toContain('備份 SQL');
  });

  it('預覽、黃金快照、重跑預覽、所有 verify 區塊都只有 SELECT／WITH', () => {
    for (const s of ga.steps) {
      if (s.kind === 'readonly') for (const b of s.blocks.main as Block[]) expect(onlySelect(b.sql), s.id + ' ' + b.label).toBe(true);
      for (const b of s.blocks.verify as Block[]) expect(onlySelect(b.sql), s.id + ' ' + b.label).toBe(true);
    }
  });

  it('黃金快照有 3 段，B1 第 2 份（總表第 8 步）的檢查區附上黃金比對', () => {
    for (const id of ['x-ga-golden-before', 'x-ga-golden-g46', 'x-ga-golden-b1']) expect(byId(id).blocks.main.length).toBe(3);
    const v = byReadme(8).blocks.verify as Block[];
    expect(v.length).toBe(4);
    expect(v.filter((b) => /黃金快照/.test(b.label)).length).toBe(3);
    expect(byReadme(8).stops.some((x: any) => /黃金比對/.test(x.title))).toBe(true);
  });

  it('不含 DEV 專用檔名與標記（種子、測試角色、清除腳本、QA 標記）', () => {
    for (const s of ga.steps) {
      for (const b of allBlocks(s)) {
        expect(b.file, s.id).not.toMatch(/dev_seed|cleanup-ga-utility-payment-dev/);
        expect(b.sql, s.id + ' ' + b.label).not.toMatch(/QA-GAUP-|QA-GAIB1-|vue_workspace_gaup_|ga_dev_cleanup/);
      }
    }
  });

  it('所有 BEGIN 開頭又沒有 COMMIT 的檔，要附上另外的 COMMIT／ROLLBACK 區塊', () => {
    for (const s of ga.steps) {
      const need = (s.blocks.main as Block[]).some((b) => /^\s*BEGIN\s*;/im.test(b.sql) && !/^\s*COMMIT\s*;/im.test(b.sql));
      if (need) expect(s.blocks.commit.length, s.id).toBe(2);
    }
  });
});

describe('GA 操作頁：96 巡店定位例外寫入', () => {
  it('前置檢查是唯讀，檢查欄位、權限碼、函式、兩個 trigger（含新版本）與步驟 50，且第一列是總判斷', () => {
    const s = byReadme(12);
    expect(s.kind).toBe('readonly');
    const sql = s.blocks.main[0].sql as string;
    expect(onlySelect(sql)).toBe(true);
    for (const k of ['gps_exempt', 'inspection.gps_exempt', 'can_use_inspection_gps_exempt', 'trg_inspection_masters_require_gps', 'trg_inspection_masters_gps_exempt_guard', 'workspace_save_inspection', "'ok'"]) expect(sql).toContain(k);
    expect(s.stops.some((x: any) => /ok/.test(x.title) && /合併/.test(x.title))).toBe(true);
  });

  it('96 主檔只替換 workspace_save_inspection，順序在 B1 之後，不碰 G46／B1 的檔', () => {
    const s = byReadme(13);
    expect(s.blocks.main.length).toBe(1);
    expect(s.blocks.main[0].file).toBe('m9-sql/96_inspection_gps_exempt_save.sql');
    expect(indexOf('s12')).toBeGreaterThan(indexOf('s11'));
    expect(indexOf('s13')).toBe(indexOf('s12') + 1);
    expect(s.cautions.join(' | ')).toMatch(/不要再重跑 M9 步驟 50/);
  });

  it('頁面與總表都寫明順序：先跑 SQL、再合併 PR；96 之後不重跑步驟 50', () => {
    expect(ga.meta.intro).toMatch(/先跑這一頁的 SQL/);
    expect(ga.meta.intro).toContain('合併');
    expect(readmeText).toContain('先跑這份 SQL，再合併 PR');
    expect(readmeText).toContain('不要再重跑 M9 步驟 50');
    expect(byId('x-ga-gate').manualText).toMatch(/先做 SQL|SQL（G46、B1、96）全部做完/);
  });
});

describe('GA 操作頁：停止點與說明', () => {
  it('G46 預覽有停止點（A 區 MISSING、D 區 SHAPE_MISMATCH）；B1 預覽要求第一列是 ok', () => {
    const a = byReadme(1);
    expect(a.stops.some((x: any) => /MISSING/.test(x.title) && /SHAPE_MISMATCH/.test(x.title))).toBe(true);
    const b = byReadme(6);
    expect(b.stops.some((x: any) => /ok/.test(x.title))).toBe(true);
  });

  it('前置確認列出 m9 第 44、45、48、50 至 61、68 至 75 步與 has_permission', () => {
    const g = byId('x-ga-gate');
    expect(g.kind).toBe('manual');
    expect(g.manualText).toMatch(/44、45、48/);
    expect(g.manualText).toMatch(/50 至 61/);
    expect(g.manualText).toMatch(/68 至 75/);
    expect(g.manualText).toMatch(/has_permission/);
  });

  it('授權步驟是老闆決定，沒有 SQL；驗收步驟是手動', () => {
    expect(byId('x-ga-grants').blocks.main.length).toBe(0);
    expect(byId('x-ga-grants').what).toMatch(/老闆決定/);
    expect(byId('x-ga-acceptance').kind).toBe('manual');
    expect(byId('x-ga-acceptance').manualText).toMatch(/缺附件/);
  });

  it('收尾列出不可送上正式區的東西與頁面回舊版需 workspace_page_fallbacks', () => {
    const c = byId('x-ga-closing');
    expect(c.manualText).toContain('workspace_page_fallbacks');
    expect(c.manualText).toContain('dev_seed');
    expect(c.manualText).toContain('vue_workspace_gaup_');
    expect(c.manualText).toContain('QA-GAUP-');
    expect(c.manualText).toContain('QA-GAIB1-');
  });

  it('總表文件寫明時間點是和新版部署一起（不是 12/15），撤回順序，且不含 DEV 專用檔的實際檔名', () => {
    expect(readmeText).toContain('和這次新版部署一起上正式區');
    expect(readmeText).toContain('B1：05、04、03、02、01');
    expect(readmeText).toContain('G46：04、03、02、01');
    const t = ga.steps.find((s: any) => s.id === 's01');
    expect(t.what).not.toMatch(/12\/15/);
  });
});

describe('GA 操作頁：頁面與對主流程的影響', () => {
  it('GA 頁有自己的標題與自己的進度檔，不和主流程共用', () => {
    expect(gaHtml).toContain('<title>水電與採購請款上線操作</title>');
    expect(gaHtml).toContain('runbook/progress-ga-post-cutover');
    expect(gaHtml).not.toContain('runbook/progress-2026-12-07');
    expect(gaHtml).not.toMatch(/https?:\/\/(?!localhost)/);
  });

  it('主流程頁沒變：標題、進度檔、步驟數；且沒有任何 GA 步驟混進去', () => {
    expect(mainHtml).toContain('<title>正式區上線操作</title>');
    expect(mainHtml).toContain('runbook/progress-2026-12-07');
    expect(main.meta.readmeStepCount).toBe(92);
    expect(main.meta.excludedReadmeSteps).toEqual([89, 90, 91, 92]);
    expect(main.steps.filter((s: any) => String(s.id).startsWith('x-ga')).length).toBe(0);
    for (const s of main.steps) for (const b of allBlocks(s)) expect(b.file).not.toMatch(/ga-utility-payment-sql|ga-improve-b1-sql/);
  });

  it('頁面不含密碼、連線字串、金鑰', () => {
    expect(gaHtml).not.toMatch(/postgres(ql)?:\/\//i);
    expect(gaHtml).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it('總表檔案不存在時，GA 產生器要失敗', () => {
    expect(() => builder.buildModel({ profile: 'ga', readmePath: path.join(planDir, 'no-such-ga-readme.md') })).toThrow();
  });
});
