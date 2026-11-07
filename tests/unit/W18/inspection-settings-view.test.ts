import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W18 單元層：設定頁顯示（Q5 說明、Q6 影響筆數、Q7 重疊提示、Q8 滿分總和警告）與 SQL 檔案存在且附 rollback。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const settings = read('vue-workspace/src/pages/InspectionSettings.vue');
const edit = read('vue-workspace/src/pages/InspectionSettingEdit.vue');
const api = read('app/api/workspace/inspection-settings/route.ts');

describe('設定列表頁', () => {
  it('Q8：顯示啟用項目滿分總和，不等於 220 時顯示警告（不阻擋）', () => {
    expect(settings).toContain('data-testid="score-total"');
    expect(settings).toContain('data-testid="score-warning"');
    expect(settings).toContain('maxScoreWarning(scoreTotal.value)');
  });
  it('Q5：評級對照頁說明以完成當時為準', () => {
    expect(settings).toContain('data-testid="grade-snapshot-note"');
    expect(settings).toContain('完成當時');
  });
  it('Q6：改善回補頁顯示受影響筆數', () => {
    expect(settings).toContain('bonusImpactNotice(data.pendingImprovements ?? 0)');
  });
});

describe('回補規則編輯頁', () => {
  it('Q6：儲存前就看得到受影響筆數，停用確認視窗也顯示', () => {
    expect(edit.match(/bonusImpactNotice\(pendingCount\)/g)?.length).toBe(2);
  });
  it('Q7：前端先擋重疊，伺服器另有 BONUS_OVERLAP 檢查', () => {
    expect(edit).toContain('findBonusOverlap(');
    expect(api).toContain('BONUS_OVERLAP');
  });
  it('API 回傳等待改善筆數', () => {
    expect(api).toContain('pendingImprovements');
    expect(api).toContain('.eq("status", "pending")');
  });
});

describe('DEV SQL（M4 Q5 snapshot）', () => {
  const sql = 'supabase/workspace-dev/20261107160000_m4_grade_snapshot.sql';
  it('SQL、rollback、apply 腳本都存在', () => {
    for (const f of [sql, sql.replace('.sql', '.rollback.sql'), 'scripts/apply-workspace-m4-grade-snapshot-dev.cjs'])
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });
  it('加分重算不再寫死門檻，改讀 snapshot', () => {
    const body = read(sql);
    expect(body).not.toMatch(/v_new_total >= 215/);
    expect(body).toContain('workspace_grade_for_score(v_new_total, v_thresholds)');
  });
});
