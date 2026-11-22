import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W17 單元層（結構）：Q17 資料庫函式用台灣日期、Q19 逾期保護、Q18 權限、列表急迫標示與完整巡店連結、正式區 SQL 草稿。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const detailApi = read('app/api/workspace/improvement-detail/route.ts');
const listApi = read('app/api/workspace/improvements/route.ts');
const access = read('lib/workspace/improvements.ts');
const list = read('vue-workspace/src/pages/Improvements.vue');
const detail = read('vue-workspace/src/pages/ImprovementDetail.vue');
const devSql = read('supabase/workspace-dev/20261108100000_m4_w17_improvement_taipei_overdue.sql');

describe('M4 F：改善照片中文上傳按鈕', () => {
  const upload = read('vue-workspace/src/components/ImprovementPhotoUpload.vue');
  const capture = read('vue-workspace/src/components/InspectionPhotoCapture.vue');
  it('回報頁改用中文按鈕元件，不再直接放原生 file input', () => {
    expect(detail).toContain('<ImprovementPhotoUpload');
    expect(detail).not.toContain('type="file"');
    expect(upload).toContain('<span>選擇照片</span>');
    expect(upload).toContain('aria-label="上傳改善照片"');
  });
  it('可多選、只收 JPEG／PNG／WebP、不帶 capture、最多 5 張、縮圖可刪除，風格共用拍照樣式', () => {
    expect(upload).toContain('multiple');
    expect(upload).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(upload).not.toContain('capture=');
    expect(upload).toContain('const MAX = 5;');
    expect(upload).toContain('class="photo-remove"');
    expect(upload).toContain('photo-capture-button');
    expect(upload).toContain('photo-capture-input');
  });
  it('巡店拍照元件維持後鏡頭 capture="environment"', () => {
    expect(capture).toContain('capture="environment"');
    expect(capture).toContain('accept="image/*"');
  });
});

describe('Q17 台灣日期（資料庫函式）', () => {
  it('DEV 函式用 Asia/Taipei 日期算 days_taken，並有逾期保護；公式不變', () => {
    expect(devSql).toContain("(NEW.improved_at AT TIME ZONE 'Asia/Taipei')::date");
    expect(devSql).toContain('v_report_date > NEW.deadline');
    expect(devSql).toContain('ROUND((v_deduction * COALESCE(v_bonus_percent, 0) / 100.0)::numeric, 1)');
    expect(devSql).toContain("OLD.status IS DISTINCT FROM 'improved'");
  });
  it('有 rollback、apply 腳本與正式區草稿（預覽、BEGIN、備份、rollback、README）', () => {
    for (const f of [
      'supabase/workspace-dev/20261108100000_m4_w17_improvement_taipei_overdue.rollback.sql',
      'scripts/apply-workspace-m4-w17-improvement-dev.cjs',
      'docs/vue-workspace/parity-plan/m4-sql/w17_A_preview.sql',
      'docs/vue-workspace/parity-plan/m4-sql/w17_B_apply.sql',
      'docs/vue-workspace/parity-plan/m4-sql/w17_C_rollback.sql',
      'docs/vue-workspace/parity-plan/m4-sql/w17_D_reporter_diff.sql',
    ])
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    const apply = read('docs/vue-workspace/parity-plan/m4-sql/w17_B_apply.sql');
    expect(apply).toMatch(/^BEGIN;/m);
    expect(apply).toContain('m4_w17_backup');
    expect(apply).toContain('Asia/Taipei');
    expect(read('docs/vue-workspace/parity-plan/m4-sql/w17_C_rollback.sql')).toMatch(/^BEGIN;/m);
    expect(read('docs/vue-workspace/parity-plan/m4-sql/README.md')).toContain('w17_B_apply.sql');
  });
  it('應用層「今天」按台灣日期（共用 improvement-rules）', () => {
    expect(access).toContain('improvementToday');
    expect(read('lib/workspace/improvement-rules.ts')).toContain('Asia/Taipei');
  });
});

describe('Q18 誰可以回報：管理員、該門市店長、有「提交改善」權限者（任何門市）', () => {
  it('canSubmit 的三個條件', () => {
    expect(access).toMatch(/const canSubmit =\s*access\.admin \|\|\s*access\.stores\.includes\(row\.store_id\) \|\|\s*ctx\.has\("inspection\.improvement\.submit"\)/);
  });
});

describe('Q19 逾期一律可補報', () => {
  it('伺服器：pending 與補跑程式標的 overdue 都可回報，其它狀態（已改善）不可', () => {
    expect(detailApi).toContain('const REPORTABLE = ["pending", "overdue"]');
    expect(detailApi).toContain('canSubmit: canSubmit && REPORTABLE.includes(row.status)');
    expect(detailApi).toContain('.in("status", REPORTABLE)');
  });
  it('畫面：逾期時顯示「仍可補報、回補 0 分」說明', () => {
    expect(detail).toContain('data-testid="overdue-note"');
    expect(detail).toContain('回補 0 分');
  });
});

describe('急迫標示與連結（補回舊版）', () => {
  it('列表 API 回 urgent 與 remaining，逾期按台灣日期只在顯示時計算', () => {
    expect(listApi).toContain('urgent: isUrgent(');
    expect(listApi).toContain('remaining: ');
    expect(listApi).toContain('displayStatus(row.status');
  });
  it('列表有急迫徽章、剩幾天、查看完整巡店記錄', () => {
    expect(list).toContain('data-testid="urgent-badge"');
    expect(list).toContain('data-testid="remaining"');
    expect(list).toContain('查看完整巡店記錄');
  });
  it('詳情有「查看完整巡店記錄」連結與伺服器預估回補', () => {
    expect(detail).toContain('查看完整巡店記錄');
    expect(detail).toContain('data.value?.estimate');
  });
  it('列表不再限制每狀態 200 筆（全部載入，已列白名單）', () => {
    expect(listApi).not.toMatch(/limit\(200\)|LIST_LIMIT/);
  });
});

describe('F 節：舊新版改善回報資格差異（只讀 SQL）', () => {
  const sql = read('docs/vue-workspace/parity-plan/m4-sql/w17_D_reporter_diff.sql');
  it('只讀、涵蓋督導本人與管理改善權限、扣掉管理員／店長／提交改善權限，且不檢查 roles.is_active', () => {
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|TRUNCATE)\b/im);
    expect(sql).toContain('inspection.improvement.manage');
    expect(sql).toContain('inspection.improvement.submit');
    expect(sql).toContain('inspector_id');
    expect(sql).toContain('store_managers');
    expect(sql).toContain("pr.role = 'admin'");
    expect(sql).not.toMatch(/\br\.is_active/);
  });
  it('README 有說明', () => {
    expect(read('docs/vue-workspace/parity-plan/m4-sql/README.md')).toContain('w17_D_reporter_diff.sql');
  });
});
