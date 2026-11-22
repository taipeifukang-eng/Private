import { test } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { adminDb, DEFAULT_THRESHOLDS, deleteRunMasters, M4_MONTH, runIdOrThrow, seedMaster } from '../support/m4-fixtures';
import { legacyHardcodedGrade } from '../../lib/workspace/inspection-scoring';

// W18 對等層（M4 Q5）。評分、評級會進入每月巡店得分與獎金，所以用同輸入同輸出對照：
//  - grade-default-same：邊界分數在預設門檻下，新版資料庫評級函式 = 舊版寫死門檻（含 219.9、215、214.9、191、190.9、121、120.9、0）。
//  - grade-new-inspection-after-change：評級對照表被改過之後，舊版（寫死）與新版（完成當時的設定）不同 → 已核可差異（Q5）。
// Q6、Q7、Q8 是設定頁新增提示與檢查（舊版沒有），列在 allowlist 供登記；畫面行為由 e2e 驗證。

const map = loadMap('inspection-settings');
const recorder = new ParityRecorder('inspection-settings');
const find = (id: string) => map.entries.find((e) => e.id === id)!;

test.afterAll(async () => {
  await deleteRunMasters();
});

test('預設門檻下邊界分數：新版資料庫評級 = 舊版寫死門檻', async () => {
  runIdOrThrow();
  const db = adminDb();
  const scores = [220, 219.9, 215, 214.9, 191, 190.9, 181, 180.9, 171, 170.9, 161, 160.9, 151, 150.9, 141, 140.9, 131, 130.9, 121, 120.9, 0];
  const legacy: Record<string, number> = {};
  const native: Record<string, number> = {};
  for (const s of scores) {
    legacy[String(s)] = legacyHardcodedGrade(s);
    const r = await db.rpc('workspace_grade_for_score', { p_score: s, p_thresholds: DEFAULT_THRESHOLDS });
    native[String(s)] = Number(r.data);
  }
  const e = find('grade-default-same');
  assertNoUnlistedDiffs(
    recorder.record({
      entry: 'grade-default-same',
      mechanism: 'write-readback',
      role: 'admin',
      title: '邊界分數評級（預設門檻）',
      legacy: { endpoint: e.legacy.source || '' },
      native: { endpoint: e.native.source || '' },
      compared: legacy,
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
});

test('評級對照表被改過之後：新增的巡店單舊版仍用寫死門檻，新版用完成當時的設定（Q5 已核可差異）', async () => {
  test.setTimeout(120_000);
  const db = adminDb();
  const original = ((await db.from('inspection_grade_mapping').select('id,grade,min_score').order('grade')).data || []) as { id: string; grade: number; min_score: string }[];
  const nine = original.find((m) => m.grade === 9)!;
  const nextHigher = 219; // 9 級門檻改到 219，216 分不再是 9 級
  try {
    const u = await db.from('inspection_grade_mapping').update({ min_score: nextHigher }).eq('id', nine.id);
    if (u.error) throw new Error(`改評級對照失敗：${u.error.message}`);
    const id = await seedMaster({ store: 'ZT04', inspector: 'admin', date: `${M4_MONTH.snapshot}-05`, status: 'draft', total: 216, tag: 'par-grade' });
    const done = await db.from('inspection_masters').update({ status: 'completed', total_score: 216 }).eq('id', id).select('grade').single();
    if (done.error) throw new Error(`完成巡店失敗：${done.error.message}`);
    const legacy = { total: 216, grade: legacyHardcodedGrade(216) };
    const native = { total: 216, grade: Number(done.data.grade) };
    const e = find('grade-new-inspection-after-change');
    assertNoUnlistedDiffs(
      recorder.record({
        entry: 'grade-new-inspection-after-change',
        mechanism: 'write-readback',
        role: 'admin',
        title: '改評級對照後新完成的單',
        legacy: { endpoint: e.legacy.source || '' },
        native: { endpoint: e.native.source || '' },
        compared: legacy,
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  } finally {
    await db.from('inspection_grade_mapping').update({ min_score: nine.min_score }).eq('id', nine.id);
  }
});
