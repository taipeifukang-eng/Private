import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// 正式區「逐步操作頁」產生器的單元測試。只讀檔、不連資料庫。
const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..', '..');
const builder = nodeRequire(path.join(root, 'scripts', 'm9-runbook', 'build.cjs')) as {
  buildModel: (opts?: { planDir?: string; readmePath?: string }) => any;
  renderHtml: (model: any) => string;
  parseReadme: (text: string) => { steps: any[]; claimed: number };
  needsCommit: (sql: string) => boolean;
  EXCLUDED_README_STEPS: Record<number, string>;
  PLAN_DIR: string;
};
const planDir = builder.PLAN_DIR;
const readmeText = fs.readFileSync(path.join(planDir, 'm9-sql', 'README.md'), 'utf8');

const model = builder.buildModel();
const html = builder.renderHtml(model);

type Block = { label: string; file: string; sql: string };
const allBlocks = (s: any): Block[] => Object.values(s.blocks as Record<string, Block[]>).flat();

/** 去掉註解與字串內容，只留語句骨架，用來判斷「是不是只有 SELECT／WITH」。 */
function statements(sql: string): string[] {
  // 逐字元掃描：去掉註解、字串與 $$ 引號內容，只留語句骨架
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
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        i = j < 0 ? sql.length : j + tag.length;
        out += "''";
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out.split(';').map((x) => x.trim()).filter(Boolean);
}
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|DO|PERFORM|EXECUTE)\b/i;
function isReadOnly(sql: string): boolean {
  const list = statements(sql);
  return list.length > 0 && list.every((st) => /^(SELECT|WITH)\b/i.test(st) && !FORBIDDEN.test(st));
}

describe('M9 正式區逐步操作頁：步驟數', () => {
  it('README 總表解析出的步驟數與「合計 N 步」一致，序號連續', () => {
    const parsed = builder.parseReadme(readmeText.slice(readmeText.indexOf('## 全部正式區執行順序總表')));
    expect(parsed.steps.length).toBe(parsed.claimed);
    expect(parsed.claimed).toBe(85);
    expect(model.meta.readmeStepCount).toBe(85);
    parsed.steps.forEach((s: any, i: number) => expect(s.no).toBe(i + 1));
  });

  it('頁面步驟 = 總表 85 步扣掉 4 個不執行的步驟，再加上額外步驟；總表每步最多出現一次且順序不變', () => {
    expect(model.meta.excludedReadmeSteps).toEqual([82, 83, 84, 85]);
    expect(model.meta.readmeStepsIncluded).toBe(85 - 4);
    expect(model.meta.stepCount).toBe(model.meta.readmeStepsIncluded + model.meta.extraStepIds.length);
    expect(model.steps.length).toBe(model.meta.stepCount);
    const nos = model.steps.filter((s: any) => s.readmeNo).map((s: any) => s.readmeNo);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos).toEqual([...nos].sort((a: number, b: number) => a - b));
    expect(nos).not.toContain(82);
    expect(nos).not.toContain(83);
    expect(nos).not.toContain(84);
    expect(nos).not.toContain(85);
    // 顯示序號連續
    model.steps.forEach((s: any, i: number) => expect(s.no).toBe(i + 1));
    // 頁面上寫的總步驟數就是模型步驟數
    expect(html).toContain(`${model.meta.stepCount} 步`);
  });

  it('額外步驟包含 R4 判斷、pg_cron 兩步、授權占位、切換開新版、回舊版確認', () => {
    expect(model.meta.extraStepIds).toEqual(['x-r4', 'x-cron-enable', 'x-cron-schedule', 'x-auth', 'x-cutover', 'x-fallback']);
  });
});

describe('M9 正式區逐步操作頁：SQL 逐字嵌入', () => {
  it('每個來自檔案的 SQL 區塊都與檔案內容逐字相同', () => {
    let fileBlocks = 0;
    for (const step of model.steps) {
      for (const b of allBlocks(step)) {
        if (!b.file) continue;
        const abs = path.join(planDir, b.file);
        expect(fs.existsSync(abs), `${step.id} 的檔案不存在：${b.file}`).toBe(true);
        if (b.file.endsWith('.sql')) {
          expect(b.sql, `${step.id} ${b.file}`).toBe(fs.readFileSync(abs, 'utf8'));
          fileBlocks += 1;
        }
      }
    }
    expect(fileBlocks).toBeGreaterThan(150);
  });

  it('輸出 HTML 內嵌的資料與模型一致（SQL 沒被轉義弄壞）', () => {
    const m = html.match(/<script id="rb-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const embedded = JSON.parse(m![1]);
    expect(embedded.steps.length).toBe(model.steps.length);
    embedded.steps.forEach((s: any, i: number) => {
      const orig = model.steps[i];
      expect(s.id).toBe(orig.id);
      expect(allBlocks(s).map((b) => b.sql)).toEqual(allBlocks(orig).map((b) => b.sql));
    });
  });

  it('總表步驟對應的檔案不存在時，產生器要失敗', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-runbook-'));
    try {
      fs.cpSync(planDir, tmp, { recursive: true });
      fs.rmSync(path.join(tmp, 'm9-sql', '55_improvements_bonus.sql'));
      expect(() => builder.buildModel({ planDir: tmp })).toThrow(/不存在/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('總表「合計 N 步」和實際步數不符時，產生器要失敗', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-runbook-'));
    try {
      fs.cpSync(planDir, tmp, { recursive: true });
      const p = path.join(tmp, 'm9-sql', 'README.md');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('合計 **85 步**', '合計 **84 步**'));
      expect(() => builder.buildModel({ planDir: tmp })).toThrow(/合計/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('M9 正式區逐步操作頁：唯讀步驟', () => {
  const readonlySteps = model.steps.filter((s: any) => s.kind === 'readonly');

  it('總表標示唯讀的步驟（21 步）主 SQL 都只有 SELECT／WITH', () => {
    const fromReadme = model.steps.filter((s: any) => s.natureReadme === '唯讀');
    expect(fromReadme.length).toBe(21);
    for (const s of fromReadme) {
      expect(s.blocks.main.length, s.id).toBeGreaterThan(0);
      for (const b of s.blocks.main) expect(isReadOnly(b.sql), `${s.id} ${b.label}`).toBe(true);
      expect(s.blocks.backup.length, s.id).toBe(0);
      expect(s.blocks.commit.length, s.id).toBe(0);
    }
  });

  it('R4 判斷步驟與 pg_cron 檢查 SQL 也是唯讀', () => {
    const r4 = model.steps.find((s: any) => s.id === 'x-r4');
    expect(r4.kind).toBe('readonly');
    for (const b of r4.blocks.main) expect(isReadOnly(b.sql)).toBe(true);
    for (const id of ['x-cron-enable', 'x-cron-schedule']) {
      const s = model.steps.find((x: any) => x.id === id);
      expect(isReadOnly(s.blocks.verify[0].sql), id).toBe(true);
    }
  });

  it('所有 .verify.sql 與 .preview.sql 區塊也只有 SELECT／WITH（80 預覽第二部分的刻意還原除外）', () => {
    for (const s of model.steps) {
      for (const b of [...s.blocks.verify, ...s.blocks.preview] as Block[]) {
        if (!b.file) continue;
        if (b.file.endsWith('80_movement_batch_monthly_roster.preview.sql')) continue; // DO 區塊一律 RAISE EXCEPTION 還原
        expect(isReadOnly(b.sql), `${s.id} ${b.file}`).toBe(true);
      }
    }
    const s80 = model.steps.find((s: any) => s.readmeNo === 30);
    const pv = s80.blocks.preview[0].sql as string;
    expect(pv).toMatch(/RAISE EXCEPTION/);
  });

  it('唯讀步驟至少 20 步（21 步 + R4）', () => {
    expect(readonlySteps.length).toBeGreaterThanOrEqual(22);
  });
});

describe('M9 正式區逐步操作頁：老闆決定', () => {
  const files = new Set<string>();
  for (const s of model.steps) for (const b of allBlocks(s)) if (b.file) files.add(b.file);

  it('R3：m3 兩份補授權（B_grant）不在任何步驟裡；A 預覽可以在', () => {
    expect([...files].some((f) => /grant_task_manage_B_grant/.test(f))).toBe(false);
    expect([...files].some((f) => /grant_task_view_archived_B_grant/.test(f))).toBe(false);
    expect([...files].some((f) => /grant_task_(manage|view_archived)_C_rollback/.test(f))).toBe(false);
    for (const s of model.steps) {
      for (const b of allBlocks(s)) {
        expect(/INSERT INTO\s+(public\.)?role_permissions/i.test(b.sql) && /task\.(manage|view_archived)/.test(b.sql), `${s.id} ${b.label}`).toBe(false);
      }
    }
  });

  it('R4：m4 的 w17_B／w18_B（含撤回）不在任何步驟裡', () => {
    expect([...files].some((f) => /w17_B_apply|w18_B_apply|w17_C_rollback|w18_C_rollback/.test(f))).toBe(false);
  });

  it('R4：判斷步驟在階段 0 的最後，SQL 檢查備份表與函式內容特徵', () => {
    const stage0 = model.stages[0];
    expect(stage0.stepIds[stage0.stepIds.length - 1]).toBe('x-r4');
    const r4 = model.steps.find((s: any) => s.id === 'x-r4');
    const sql = r4.blocks.main[0].sql as string;
    expect(sql).toContain('m4_w17_backup');
    expect(sql).toContain('m4_w18_backup');
    expect(sql).toContain('Asia/Taipei');
    expect(sql).toContain('grade_thresholds');
    expect(r4.stops.length).toBeGreaterThan(0);
    expect(r4.expect).toMatch(/結果 A/);
    expect(r4.expect).toMatch(/結果 B/);
    // R4 判斷必須排在 55、90 之前
    const idx = (id: string) => model.steps.findIndex((s: any) => s.id === id);
    expect(idx('x-r4')).toBeLessThan(idx('s24'));
    expect(idx('x-r4')).toBeLessThan(idx('s25'));
  });

  it('R1：15 號步驟（員工管理）先預覽再主檔，預覽有醒目停止點', () => {
    const s = model.steps.find((x: any) => x.readmeNo === 27);
    expect(s.blocks.preview[0].file).toBe('m9-sql/15_employee_management.preview.sql');
    expect(s.blocks.main[0].file).toBe('m9-sql/15_employee_management.sql');
    expect(s.stops.some((x: any) => x.where === 'preview' && /不合規員編/.test(x.title))).toBe(true);
  });

  it('R2：pg_cron 排程是台北 00:05 = UTC 16:05（5 16 * * *），呼叫 workspace_apply_due_promotions，並放在 30 號之後', () => {
    const sch = model.steps.find((s: any) => s.id === 'x-cron-schedule');
    const sql = sch.blocks.main[0].sql as string;
    expect(sql).toContain("'5 16 * * *'");
    expect(sql).toContain('workspace_apply_due_promotions');
    expect(sch.blocks.verify[0].sql).toMatch(/cron\.job/);
    expect(sch.blocks.rollback[0].sql).toMatch(/cron\.unschedule/);
    const idx = (id: string) => model.steps.findIndex((s: any) => s.id === id);
    expect(idx('x-cron-enable')).toBeGreaterThan(idx('s30'));
    expect(idx('x-cron-schedule')).toBe(idx('x-cron-enable') + 1);
  });

  it('授權占位步驟：在全部資料表與函式步驟之後、切換開新版之前', () => {
    const idx = (id: string) => model.steps.findIndex((s: any) => s.id === id);
    const auth = idx('x-auth');
    const cutover = idx('x-cutover');
    expect(auth).toBeGreaterThan(-1);
    // 所有總表步驟（資料表與函式）都在占位步驟之前
    const lastReadme = Math.max(...model.steps.map((s: any, i: number) => (s.readmeNo ? i : -1)));
    expect(auth).toBeGreaterThan(lastReadme);
    expect(auth).toBeGreaterThan(idx('x-cron-schedule'));
    // 緊接在切換開新版之前
    expect(cutover).toBe(auth + 1);
    expect(model.steps[auth].placeholder).toBe(true);
    expect(model.steps[auth].what).toMatch(/待權限勾選頁產生後補上|勾選頁/);
    expect(model.steps[auth].title).toMatch(/待權限勾選頁產生後補上/);
  });

  it('最後兩步是「切換開新版」與「回舊版開關確認」，回舊版確認引用 15 號步驟的 verify 檔', () => {
    const n = model.steps.length;
    expect(model.steps[n - 2].title).toBe('切換開新版');
    expect(model.steps[n - 1].title).toBe('回舊版開關確認');
    expect(model.steps[n - 1].blocks.verify.some((b: Block) => b.file === 'm9-sql/20261123150000_m9_page_fallbacks.verify.sql')).toBe(true);
  });

  it('BEGIN 開頭又沒有 COMMIT 的檔，要附上另外的 COMMIT／ROLLBACK 區塊', () => {
    expect(builder.needsCommit('-- x\nBEGIN;\nSELECT 1;\n')).toBe(true);
    expect(builder.needsCommit('BEGIN;\nSELECT 1;\nCOMMIT;\n')).toBe(false);
    for (const s of model.steps) {
      const need = s.blocks.main.some((b: Block) => builder.needsCommit(b.sql));
      expect(s.blocks.commit.length > 0, s.id).toBe(need);
    }
    const withCommit = model.steps.filter((s: any) => s.blocks.commit.length > 0).map((s: any) => s.readmeNo);
    expect(withCommit).toContain(18);
    expect(withCommit).toContain(81);
  });

  it('套用順序：55 → 90 → 50、20 → 60、65 與 80 都在 API 切換之前', () => {
    const pos = (no: number) => model.steps.findIndex((s: any) => s.readmeNo === no);
    // 總表序號：24 = 55、25 = 90、26 = 50；22 = 20、23 = 60
    expect(model.steps[pos(24)].blocks.main[0].file).toMatch(/55_improvements_bonus\.sql$/);
    expect(model.steps[pos(25)].blocks.main[0].file).toMatch(/90_inspection_settings_grade_snapshot\.sql$/);
    expect(model.steps[pos(26)].blocks.main[0].file).toMatch(/50_inspection_write_core\.sql$/);
    expect(pos(24)).toBeLessThan(pos(25));
    expect(pos(25)).toBeLessThan(pos(26));
    expect(pos(22)).toBeLessThan(pos(23));
    expect(pos(29)).toBeLessThan(pos(30));
  });
});

describe('M9 正式區逐步操作頁：頁面內容', () => {
  it('有 <title>「正式區上線操作」，不使用外部腳本、字型或連結', () => {
    expect(html).toContain('<title>正式區上線操作</title>');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).not.toMatch(/@import/);
  });

  it('支援深色模式（:root 色票、prefers-color-scheme、[data-theme]）並設定 body 背景', () => {
    expect(html).toMatch(/:root\s*\{/);
    expect(html).toMatch(/prefers-color-scheme:\s*dark/);
    expect(html).toMatch(/:root\[data-theme="dark"\]/);
    expect(html).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/);
  });

  it('進度存在 collection runbook、doc progress-2026-12-07，沒有 db 時退回本機', () => {
    expect(html).toContain("runbook/progress-2026-12-07");
    expect(html).toContain("window.claude.use('db')");
    expect(html).toContain('localStorage');
    expect(html).toContain('10000');
  });

  it('頁面不含密碼、連線字串、金鑰或 project ref', () => {
    expect(html).not.toMatch(/postgres(ql)?:\/\//i);
    expect(html).not.toMatch(/[a-z0-9]{20}\.supabase\.(co|in)/i);
    expect(html).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}\./); // JWT
    expect(html).not.toMatch(/service_role_key|SERVICE_ROLE_KEY|anon_key|ANON_KEY/);
    expect(html).not.toMatch(/(password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}/i);
    expect(html).not.toMatch(/sb_(secret|publishable)_/);
    expect(html).not.toMatch(/\bproject[_ -]?ref\b\s*[:=]/i);
  });

  it('每一步都有白話標題、做什麼、類型標籤，並有停止點清單', () => {
    for (const s of model.steps) {
      expect(s.title.length, s.id).toBeGreaterThan(2);
      expect(s.what.length, s.id).toBeGreaterThan(5);
      expect(['唯讀', '新增', '新增＋會改既有資料', '會改既有資料', '手動操作（後台）', '手動操作', '待補（占位）']).toContain(s.kindLabel);
      expect(s.minutes, s.id).toBeGreaterThan(0);
    }
    expect(model.stopList.length).toBeGreaterThanOrEqual(8);
    expect(model.stopList.some((x: any) => /R1/.test(x.title))).toBe(true);
    expect(model.stopList.some((x: any) => /R4/.test(x.title))).toBe(true);
    expect(model.meta.estMinutes).toBeGreaterThan(60);
  });
});

describe('M9 正式區逐步操作頁：審查補強', () => {
  it('文字裡引用的步驟序號是頁面上實際顯示的序號，不留未解析的標記', () => {
    const all = JSON.stringify(model.steps.map((s: any) => ({ ...s, blocks: undefined })));
    expect(all).not.toMatch(/\{\{\d+\}\}/);
    expect(all).not.toMatch(/\d+ 號步驟/);
    const s15 = model.steps.find((s: any) => s.readmeNo === 15);
    const fb = model.steps[model.steps.length - 1];
    expect(fb.what).toContain(`第 ${s15.no} 步`);
  });

  it('BEGIN 開頭的撤回檔（81 號）也提醒要另外 COMMIT', () => {
    const s = model.steps.find((x: any) => x.readmeNo === 81);
    expect(s.rollbackText).toMatch(/COMMIT;/);
  });

  it('36 號（自費診所截圖桶）先記下既有桶現況，且那段 SQL 只有 SELECT', () => {
    const s = model.steps.find((x: any) => x.readmeNo === 36);
    expect(s.blocks.backup.length).toBe(1);
    expect(isReadOnly(s.blocks.backup[0].sql)).toBe(true);
  });

  it('db 進度儲存：沒有 db 退回本機、一次一筆寫入、逾時等原寫入結束', () => {
    expect(html).toContain('cloud.inflight = true');
    expect(html).toContain('await p;');
    expect(html).toContain('scheduleRetry');
  });
});
