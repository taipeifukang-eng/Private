#!/usr/bin/env node
/*
 * 正式區資料庫「逐步操作頁」產生器。
 *
 * 讀 docs/vue-workspace/parity-plan/m9-sql/README.md 的「全部正式區執行順序總表」與表中每個 SQL 檔，
 * 輸出單一 HTML（SQL 內容由本程式直接讀檔嵌入，不手抄）。
 * 絕不連資料庫、不讀 .env*、不輸出任何密碼／連線字串／project ref。
 *
 * 用法：node scripts/m9-runbook/build.cjs [輸出路徑]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PLAN_DIR = path.join(REPO, 'docs', 'vue-workspace', 'parity-plan');
const DEFAULT_OUT = 'C:\\Users\\user\\AppData\\Local\\Temp\\claude\\36e794268116a3de\\898eeb0b-3421-41c5-b9bb-ca6fa1ac61a8\\scratchpad\\m9-review\\m9-runbook.html';

/* ------------------------------------------------------------------ 決定（2026-11-24 老闆） */
// R3：不執行的補授權檔（改由權限勾選頁決定）；R4 之後被 m9 取代的舊草稿。
const EXCLUDED_README_STEPS = {
  83: 'm3-sql/grant_task_view_archived_B_grant.sql',
  84: 'm3-sql/grant_task_manage_B_grant.sql',
  85: 'm4-sql/w17_B_apply.sql',
  86: 'm4-sql/w18_B_apply.sql',
};
const OPTIONAL_README_STEPS = new Set([5, 82]);

const TITLES = {
  15: '補建缺少的權限碼（只建立、不授權）',
  1: '檢查舊版已涵蓋的項目', 2: '找出職位和升職紀錄不一致的員工', 3: '比對誰能打開別人的任務', 4: '查哪些主管缺「看封存任務」權限',
  5: '預覽要補「任務管理」權限的名單', 6: '看改善回補函式現況', 7: '看評級對照與範本總分', 8: '查舊版能回報改善、新版不能的人',
  9: '活動、部門、行事曆等上線前名單（15 份）', 10: '看盤點權限持有人數', 11: '總務上線準備度檢查', 12: '總務第 1 批：套用前現況',
  13: '查已停用但仍有啟用項目的分類', 14: '查料件庫存與重複名單',
  16: '建立「回舊版」備援開關', 17: '員工表加「階段」欄位', 18: '預覽階段回填', 19: '回填員工階段',
  20: '組織與部門職掌（表與函式）', 21: '門市、店長、督導（權限碼與函式）', 22: '活動版本與營運', 23: '任務核心',
  24: '任務刪除與代理', 25: '巡店改善加分', 26: '巡店評級設定與快照', 27: '巡店寫入核心',
  28: '員工管理與員編規則', 29: '門市升遷申請與生效佇列', 30: '調店確認與更正', 31: '異動批次與每月人員名冊',
  32: '關係會員銷售匯入', 33: '商品主檔操作紀錄', 34: '缺貨回覆與刪除回報', 35: '督導日誌軟刪除',
  36: '語音與 AI（每月用量上限）', 37: '自費診所截圖私有桶', 38: '處方箋門市簡稱對照',
  39: '總務第 1 批：分類與料件規則', 40: '總務第 2 批：套用前預覽', 41: '總務第 2 批：異動紀錄與轉移單', 42: '總務第 2 批：設施上線貼標',
  43: '總務第 2 批：Excel 匯入批次', 44: '總務第 2 批：進行中轉移單擋報廢', 45: '總務第 2 批：歷史顯示目前門市',
  46: '總務第 3 批：套用前預覽', 47: '總務第 3 批：庫存位置規則', 48: '總務第 3 批：庫存過帳', 49: '總務第 3 批：調撥', 50: '總務第 3 批：分類保留停用',
  51: '總務第 4 批：套用前預覽', 52: '總務第 4 批：請購規則', 53: '總務第 4 批：採購單', 54: '總務第 4 批：到貨驗入與配發', 55: '總務第 4 批：資產移轉搬單',
  56: '總務第 5 批：套用前預覽', 57: '總務第 5 批：工單規則', 58: '總務第 5 批：請購補件同步', 59: '總務第 5 批：工單領用料件', 60: '總務第 5 批：工單權限收緊',
  61: '總務第 6 批：套用前預覽', 62: '總務第 6 批：廠商欄位與固定資料', 63: '總務第 6 批：廠商函式', 64: '總務第 6 批：統編唯一索引',
  65: '總務第 6 批：工單廠商檢查', 66: '總務第 6 批：水電帳單', 67: '總務第 6 批：績效與首頁徽章', 68: '總務第 6 批：效能調整', 69: '總務第 6 批：廠商權限收緊',
  70: '總務第 4.5 批：套用前預覽', 71: '總務第 4.5 批：進貨明細回填未稅金額', 72: '總務第 4.5 批：請款單', 73: '總務第 4.5 批：廠商銀行欄位',
  74: '總務第 4.5 批：附件類型', 75: '總務第 4.5 批：新權限碼', 76: '總務第 4.5 批：函式', 77: '總務第 4.5 批：待請款與分析',
  78: '總務第 4.5 批：作廢進貨', 79: '總務第 4.5 批追加：廠商銀行異動紀錄', 80: '總務第 4.5 批追加：請款規則', 81: '總務第 4.5 批追加：草稿過期',
  82: '把誤停用的活動改回啟用',
};

/* ------------------------------------------------------------------ README 解析 */
function readUtf8(p) { return fs.readFileSync(p, 'utf8'); }
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map((c) => c.trim());
}

function parseReadme(text) {
  const startIdx = text.indexOf('## 全部正式區執行順序總表');
  if (startIdx < 0) throw new Error('README 找不到「全部正式區執行順序總表」');
  const rest = text.slice(startIdx);
  const endIdx = rest.indexOf('\n---');
  const section = endIdx > 0 ? rest.slice(0, endIdx) : rest;
  const stages = [];
  const steps = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const c = splitRow(line);
    if (/^\*\*階段/.test(c[0])) {
      stages.push({ title: c[0].replace(/\*/g, '').replace(/\s+/g, ' ').trim() });
    } else if (/^\d+$/.test(c[0])) {
      if (c.length < 7) throw new Error('README 第 ' + c[0] + ' 步欄位不足 7 欄');
      steps.push({ no: Number(c[0]), stageIdx: stages.length - 1, fileCell: c[1], what: c[2], nature: c[3], backup: c[4], rollback: c[5], verify: c[6] });
    }
  }
  const claim = section.match(/合計\s*\*\*(\d+)\s*步\*\*/);
  if (!claim) throw new Error('README 找不到「合計 N 步」');
  if (Number(claim[1]) !== steps.length) {
    throw new Error('README 寫合計 ' + claim[1] + ' 步，但總表實際解析到 ' + steps.length + ' 步');
  }
  steps.forEach((s, i) => { if (s.no !== i + 1) throw new Error('README 步驟序號不連續：預期 ' + (i + 1) + ' 實際 ' + s.no); });
  return { stages, steps, claimed: Number(claim[1]) };
}

/* ------------------------------------------------------------------ 檔案解析 */
function must(planDir, rel) {
  const abs = path.join(planDir, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('總表步驟對應的檔案不存在：' + rel);
  return abs;
}
function fileBlock(planDir, rel, label, note) {
  const abs = must(planDir, rel);
  return { label, file: rel.replace(/\\/g, '/'), sql: readUtf8(abs), ...(note ? { note } : {}) };
}
function resolvePrefix(planDir, dir, name) {
  const all = fs.readdirSync(path.join(planDir, dir)).filter((f) => f.endsWith('.sql'));
  const exact = all.filter((f) => f === name + '.sql');
  if (exact.length === 1) return dir + '/' + exact[0];
  const pre = all.filter((f) => f.startsWith(name + '_') || f.startsWith(name + '-'));
  if (pre.length !== 1) throw new Error('總表列出的檔名無法唯一對應：' + dir + '/' + name + '（找到 ' + pre.length + ' 個）');
  return dir + '/' + pre[0];
}
function resolveMainFiles(planDir, step) {
  const toks = [...step.fileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (!toks.length) throw new Error('README 第 ' + step.no + ' 步沒有檔案欄位');
  if (toks.length === 1 && toks[0].endsWith('/')) {
    const dir = toks[0].replace(/\/$/, '');
    const afterColon = step.fileCell.split(/[：:]/).slice(1).join(':');
    const names = afterColon.split('、').map((x) => x.replace(/`/g, '').trim()).filter(Boolean);
    if (!names.length) throw new Error('README 第 ' + step.no + ' 步沒列出檔名');
    return names.map((n) => resolvePrefix(planDir, dir, n));
  }
  return toks.map((t) => { must(planDir, t); return t; });
}
function siblingPaths(rel) {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel, '.sql');
  return {
    backup: dir + '/' + base + '.backup.sql',
    preview: dir + '/' + base + '.preview.sql',
    verify: dir + '/' + base + '.verify.sql',
    rollbackA: dir + '/' + base + '.rollback.sql',
    rollbackB: dir + '/' + base + '-rollback.sql',
  };
}
const EXISTS = (planDir, rel) => fs.existsSync(path.join(planDir, rel));

/* ------------------------------------------------------------------ SQL 工具 */
function needsCommit(sql) {
  return /^\s*BEGIN\s*;/im.test(sql) && !/^\s*COMMIT\s*;/im.test(sql);
}
function selfBackup(sql) {
  return /pg_get_functiondef|_backup\b|zz_bak|m9_bak|m9_.*_backup|m5_w19_campaign_backup/i.test(sql);
}

/* ------------------------------------------------------------------ 自寫（非檔案）區塊 */
const R4_CHECK_SQL = `-- R4 判斷（唯讀，只有 SELECT）：舊草稿 w17_B／w18_B 之前有沒有在正式區跑過
WITH f AS (
  SELECT
    to_regclass('public.m4_w17_backup') IS NOT NULL AS w17_backup_table,
    to_regclass('public.m4_w18_backup') IS NOT NULL AS w18_backup_table,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'calculate_improvement_bonus'
              AND p.prosrc LIKE '%Asia/Taipei%' AND p.prosrc LIKE '%deadline%') AS w17_function_is_new,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'inspection_masters' AND column_name = 'grade_thresholds') AS w18_column_exists,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_01_grade_snapshot' AND NOT tgisinternal) AS w18_trigger_exists,
    to_regclass('public.m9_improvements_backup') IS NOT NULL AS m9_55_backup_exists,
    to_regclass('public.m9_inspection_settings_backup') IS NOT NULL AS m9_90_backup_exists
)
SELECT f.*,
       (w17_backup_table OR (w17_function_is_new AND NOT m9_55_backup_exists)) AS w17_B_looks_applied,
       (w18_backup_table OR w18_column_exists OR w18_trigger_exists) AS w18_B_looks_applied,
       CASE
         WHEN m9_55_backup_exists OR m9_90_backup_exists THEN 'STOP：55 或 90 的備份表已存在，表示之前跑過，請停下來聯絡 Claude'
         WHEN (w17_backup_table OR w17_function_is_new) OR (w18_backup_table OR w18_column_exists OR w18_trigger_exists) THEN 'STOP：舊草稿 w17_B 或 w18_B 疑似跑過，請停下來聯絡 Claude'
         ELSE 'OK：兩份舊草稿都沒跑過，可以繼續'
       END AS conclusion
FROM f;
`;
const CRON_ENABLE_CHECK_SQL = `-- 檢查 pg_cron 是否已啟用（唯讀）
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
`;
const CRON_SCHEDULE_SQL = `-- 每天台北時間 00:05 執行 workspace_apply_due_promotions()（讓「生效日已到」的升遷自動生效）。
-- 注意：pg_cron 用 UTC。台北 00:05 = UTC 16:05（前一天），所以排程寫 '5 16 * * *'。
-- 可重複執行：先取消同名排程再重建（若 pg_cron 先前已裝，草稿 30 建的每分鐘排程也是這個名字，會一起被換掉）。
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workspace-promotion-activation';
  PERFORM cron.schedule('workspace-promotion-activation', '5 16 * * *', 'SELECT public.workspace_apply_due_promotions();');
END $$;
`;
const CRON_CHECK_SQL = `-- 檢查排程（唯讀）：應該剛好 1 列，schedule 是 5 16 * * *，active 是 true
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'workspace-promotion-activation';
`;
const CRON_RUNS_SQL = `-- 隔天（12/8）早上再看一次：最近幾次執行結果（唯讀）。status 應為 succeeded。
SELECT status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'workspace-promotion-activation')
ORDER BY start_time DESC
LIMIT 5;
`;
const CRON_UNSCHEDULE_SQL = `-- 撤回：取消這個排程（之後未來生效的升遷要手動呼叫 workspace_apply_due_promotions()）
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workspace-promotion-activation';
`;
const BACKUP_GA_VENDORS_SQL = `-- 備份 ga_vendors（整張複製；表已存在就不會覆蓋舊備份）。確認上線穩定後再自行 DROP。
CREATE TABLE IF NOT EXISTS public.zz_bak_b6_ga_vendors AS SELECT * FROM public.ga_vendors;
SELECT (SELECT count(*) FROM public.ga_vendors) AS source_rows, (SELECT count(*) FROM public.zz_bak_b6_ga_vendors) AS backup_rows;
`;
const BUCKET_STATE_SQL = `-- 記錄「自費診所截圖」桶套用前的設定（唯讀）。要撤回時，依這份記錄人工調回原設定。
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'clinic-selfpay-screenshots';
`;
const COMMIT_SQL = 'COMMIT;\n';
const ROLLBACK_SQL = 'ROLLBACK;\n';

function extractB45Backup(planDir) {
  const text = readUtf8(path.join(planDir, 'm7m8-sql', 'README.md'));
  const m = text.match(/CREATE TABLE public\.zz_bak_b45_receipts AS SELECT \* FROM public\.ga_purchase_receipts;[^`]*?public\.zz_bak_b45_receipt_items AS SELECT \* FROM public\.ga_purchase_receipt_items;/);
  if (!m) throw new Error('m7m8-sql/README.md 找不到第 4.5 批備份指令');
  return m[0].replace(/;\s+CREATE/g, ';\nCREATE') + '\n';
}

/* ------------------------------------------------------------------ 每步的白話補充 */
const READONLY_DEFAULT = '查詢能跑完、沒有紅色錯誤訊息。這是「現況名單」，不是對錯題：有名單就截圖留給 Claude 對照，沒有名單也正常。';
const STATUS_JUDGE = '結果裡的 status 欄不應該出現 MISSING；出現就停下。WARN 與 ALREADY 請截圖給 Claude，其餘 OK、INFO 是正常資訊。';
const VERIFY_STOP = { where: 'verify', title: '檢查不通過就停下', body: '只要有一列 ok 不是 true、或出現紅色錯誤，就停下來，不要做下一步；截圖給 Claude，需要撤回時照下面「撤回」那一段，先問 Claude 再貼。' };
const VERIFY_DEFAULT = '每一列的 ok 都是 true（沒有 false）。';

const EXPECT = {
  1: '每一列的 ok 都是 true；只有最後兩列（has_permission 語意）預期是 false。其他任何一列是 false，代表正式區少了一支舊版 migration，要停下。',
  2: READONLY_DEFAULT, 3: READONLY_DEFAULT, 4: READONLY_DEFAULT, 5: READONLY_DEFAULT,
  6: '看得出函式現況與「UTC 少算一天」的筆數即可，數字截圖給 Claude；沒有紅字就算對。',
  7: '第 1 段「評級對照」的 diff 欄應該全是 false（和舊版寫死值相同）；第 4 段「不一致」應為 0 筆。不是的話停下。',
  8: READONLY_DEFAULT, 9: '15 份依序執行，每份都跑得出結果、沒有紅字即可。有名單的截圖留給 Claude。',
  10: READONLY_DEFAULT, 11: STATUS_JUDGE, 12: STATUS_JUDGE, 13: READONLY_DEFAULT, 14: READONLY_DEFAULT,
  18: '預覽欄位 proposed_stage 就是下一步會填入的值：抽看幾位員工，階段符合你的認知即可；沒有紅字。',
  19: '看過回傳的「更新筆數」合理後，再貼 COMMIT; 單獨執行。做完後回上一步（預覽）重跑，「待回填」應為 0。',
  25: VERIFY_DEFAULT + ' 備份表 m9_improvements_backup 會自動出現。',
  26: VERIFY_DEFAULT + ' 特別看「目前評級對照表」那一項，要和舊版寫死值（220/215/191/181/171/161/151/141/131/121）相同。',
  28: VERIFY_DEFAULT,
  31: '第一部分每一列 ok 都是 true；第二部分逐月檢查，每個月份的「問題筆數」都應為 0（pending_recheck 有數字是正常，不算問題）。從最舊的月份一個月一個月看。',
  40: STATUS_JUDGE, 46: STATUS_JUDGE, 51: STATUS_JUDGE, 56: STATUS_JUDGE + ' 這份第 6、7 區的名單要仔細看，截圖給 Claude。',
  61: STATUS_JUDGE + ' 第 3 區（重複統編）必須是 0 組；第 6、7、8 區的名單要先給 Claude 確認。', 70: STATUS_JUDGE + ' 第 2 區回填筆數與第 9 區權限碼請截圖。',
};
const NO_VERIFY_FILE = '畫面下方出現 Success（成功）、沒有紅色錯誤訊息。這份沒有專屬檢查檔：整批做完後，可再跑一次該批的「套用前預覽」，status 應轉為 ALREADY 或 OK。';

// 特定步驟的停止點 / 提醒（where: preview | main | verify）
const STOPS = {
  7: [{ where: 'main', title: '評級對照和舊版寫死值不同就停下', body: '第 1 段的 diff 欄如果有 true，或第 4 段不一致不是 0，先不要做{{26}}，把截圖給 Claude 決定（老闆決定事項 4）。' }],
  26: [{ where: 'main', title: '先確認{{7}}的評級對照是「相同」', body: '如果{{7}}看到評級對照和舊版寫死值不同，請先停下聯絡 Claude；上線後新單的評級會跟著資料庫對照表走。' }],
  28: [{ where: 'preview', title: 'R1 員編規則：預覽有「近期仍在用的不合規員編」就停下', body: '先跑下面的預覽（15 的 .preview.sql）。若列出近期仍在用的不合規員編（舊版近期的入職異動或手動新增用了 FKI、留空、大小寫不一致等），不要貼主檔，停下來聯絡 Claude，不繼續後面的步驟。看不出來是不是「近期仍在用」也停下問。老闆已決定員編規則觸發器要裝，但前提是預覽乾淨。' }],
  60: [{ where: 'main', title: '這步會收緊工單權限：名單沒確認前先不要做', body: '總表標示「驗收並補授權後才執行」。若還沒和 Claude 確認過{{56}}預覽的第 6、7 區名單，這一步先不要貼，直接問 Claude（不要勾完成）。' }],
  64: [{ where: 'main', title: '檔案若列出重複統編並中止，就停下', body: '這份開頭會檢查重複統編；有重複就自己中止並列出名單。看到名單不要硬跑，截圖給 Claude 先整理重複資料。' }],
  69: [{ where: 'main', title: '這步會收緊廠商權限：名單確認前不得做', body: '總表標示「名單確認前不得套用」。{{61}}預覽第 6、7、8 區的名單沒和 Claude 確認過，這一步先不要貼，直接問 Claude（不要勾完成）。' }],
};
const CAUTIONS = {
  15: ['這份只建立 11 個權限碼，不授權給任何角色（授權由權限勾選頁決定），所以做完之後角色看不到任何變化是正常的。其中督導管理日誌的 7 個碼，舊版是和 supervisor_management_* 資料表一起建的；若{{35}}（督導日誌軟刪除）一開頭就報「Missing prerequisite」，代表正式區沒有那些資料表，要停下問 Claude。'],
  5: ['這份要先改檔內的名單才有結果（預設是佔位文字）。老闆已決定補授權改由權限勾選頁處理，沒有要預覽名單就跳過這一步（選用）。'],
  19: ['這份和{{30}}（調店確認與更正）裡的階段回填內容相同，總表寫「二擇一即可」；照總表仍列在這裡，做完沒問題後{{30}}會再跑一次也無妨。'],
  24: ['前置：{{23}}（任務核心）必須先做完。'],
  30: ['如果{{19}}已經跑過備份，這裡的備份檔會因為「已存在就不覆蓋」而保留{{19}}當時的備份，這是正常的。'],
  37: ['套用前先確認正式區既有的「自費診所截圖」桶是私有的：這份會把同名桶改回私有、上限 10MB。用公開網址讀截圖的地方會失效（新舊版都用簽名網址則不受影響）。'],
  82: ['這份是選用：要先看過「{{9}}」中的停用活動名單，決定要改回啟用的活動，並把 id 填進檔內暫存表；沒有要改就整步跳過（保持不勾）。'],
};
const PREVIEW_JUDGE = {
  29: '預覽看一下現況；pg_cron 是否已安裝這欄現在可能是 false，這是預期的（排程另外在後面步驟處理）。',
  31: '第一部分是套用前現況（唯讀）；第二部分會故意用 RAISE EXCEPTION 還原，看到「錯誤」訊息是預期的、不會寫入。',
};

/* ------------------------------------------------------------------ 組裝 */
function kindOf(nature) {
  if (nature === '唯讀') return { kind: 'readonly', label: '唯讀' };
  if (nature === '新增') return { kind: 'add', label: '新增' };
  if (nature === '新增＋改既有') return { kind: 'addmodify', label: '新增＋會改既有資料' };
  if (nature === '改既有資料') return { kind: 'modify', label: '會改既有資料' };
  throw new Error('未知的「性質」：' + nature);
}
function estimateMinutes(step) {
  if (step.kind === 'manual') return step.minutes || 5;
  const b = step.blocks;
  const nMain = b.main.length;
  if (step.kind === 'readonly') return Math.max(2, Math.round(1 + 1.5 * nMain));
  return Math.round(2 + 2 * nMain + b.backup.length + b.preview.length + (b.verify.length ? 2 : 0) + (b.commit.length ? 2 : 0));
}

function buildModel(opts) {
  opts = opts || {};
  const planDir = opts.planDir || PLAN_DIR;
  const readmePath = opts.readmePath || path.join(planDir, 'm9-sql', 'README.md');
  const readme = parseReadme(readUtf8(readmePath));
  const readmeStages = readme.stages;

  const readmeSteps = {};
  const warnings = [];
  for (const rs of readme.steps) {
    if (EXCLUDED_README_STEPS[rs.no]) {
      // 被排除的步驟仍要確認總表列的檔案就是我們預期要排除的那一個
      const toks = [...rs.fileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (!toks.includes(EXCLUDED_README_STEPS[rs.no])) {
        throw new Error('README 第 ' + rs.no + ' 步預期是 ' + EXCLUDED_README_STEPS[rs.no] + '，實際是 ' + toks.join(','));
      }
      continue;
    }
    if (!TITLES[rs.no]) throw new Error('第 ' + rs.no + ' 步沒有白話標題');
    const { kind, label } = kindOf(rs.nature);
    const mainFiles = resolveMainFiles(planDir, rs);
    const blocks = { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] };

    mainFiles.forEach((f) => {
      blocks.main.push(fileBlock(planDir, f, path.posix.basename(f)));
    });

    const first = mainFiles[0];
    const sib = siblingPaths(first);
    const inM9 = first.startsWith('m9-sql/');
    // 備份
    if (EXISTS(planDir, sib.backup) && inM9) blocks.backup.push(fileBlock(planDir, sib.backup, '備份：' + path.posix.basename(sib.backup)));
    // 預覽（m9 的 .preview.sql）
    if (EXISTS(planDir, sib.preview) && inM9) blocks.preview.push(fileBlock(planDir, sib.preview, '預覽：' + path.posix.basename(sib.preview)));
    // 驗證
    if (EXISTS(planDir, sib.verify) && inM9) blocks.verify.push(fileBlock(planDir, sib.verify, '檢查：' + path.posix.basename(sib.verify)));
    // 撤回
    let rb = null;
    if (EXISTS(planDir, sib.rollbackA)) rb = sib.rollbackA; else if (EXISTS(planDir, sib.rollbackB)) rb = sib.rollbackB;
    if (rs.no === 82) rb = 'm5-sql/w19_q2_C_rollback.sql';
    if (rb && rs.no !== 9) blocks.rollback.push(fileBlock(planDir, rb, '撤回：' + path.posix.basename(rb)));

    // README 說有哪些檔，就必須找得到
    if (inM9) {
      if (/\.preview\.sql/.test(rs.verify) && !blocks.preview.length) throw new Error('README 第 ' + rs.no + ' 步列有 .preview.sql 但找不到檔案');
      if (/\.verify\.sql/.test(rs.verify) && !blocks.verify.length) throw new Error('README 第 ' + rs.no + ' 步列有 .verify.sql 但找不到檔案');
      if (/\.backup\.sql/.test(rs.backup) && !/65\.backup/.test(rs.backup) && !blocks.backup.length) throw new Error('README 第 ' + rs.no + ' 步列有 .backup.sql 但找不到檔案');
    }
    if (/rollback\.sql/.test(rs.rollback) && !blocks.rollback.length) throw new Error('README 第 ' + rs.no + ' 步列有 rollback 檔但找不到：' + rs.rollback);

    // 特例
    if (rs.no === 19) blocks.backup.push(fileBlock(planDir, 'm9-sql/65_transfer_confirm_correct_batch.backup.sql', '備份：65_transfer_confirm_correct_batch.backup.sql（與{{30}}共用）'));
    if (rs.no === 62) blocks.backup.push({ label: '備份：ga_vendors（本產生器內建）', file: '', sql: BACKUP_GA_VENDORS_SQL });
    if (rs.no === 71) blocks.backup.push({ label: '備份：進貨兩張表（照 m7m8-sql/README.md 第 4.5 批的備份指令）', file: 'm7m8-sql/README.md', sql: extractB45Backup(planDir) });

    if (rs.no === 37) blocks.backup.push({ label: '備份：先記下既有桶現況（唯讀，複製結果存記事本；沒有列代表桶還不存在）', file: '', sql: BUCKET_STATE_SQL });
    if (rs.no === 27) {
      const m = blocks.main[0].sql.match(/--\s+(CREATE TABLE IF NOT EXISTS public\.bak_inspection_masters_20261124 AS SELECT \* FROM public\.inspection_masters;)/);
      if (!m) throw new Error('50_inspection_write_core.sql 檔頭找不到選用備份指令');
      blocks.backup.push({ label: '選用備份：inspection_masters（取自檔頭註解）', file: '', sql: m[1] + '\n' });
    }
    // BEGIN 開頭又沒有 COMMIT 的檔，要另外 COMMIT
    const needC = blocks.main.some((b) => needsCommit(b.sql));
    if (needC) { blocks.commit.push({ label: '確認寫入：另外貼這行單獨執行', file: '', sql: COMMIT_SQL }, { label: '放棄不寫入：改貼這行', file: '', sql: ROLLBACK_SQL }); }

    // 備份說明
    let backupText = '';
    if (!/^否/.test(rs.backup)) {
      const auto = blocks.main.some((b) => selfBackup(b.sql));
      backupText = 'README 標示：' + rs.backup + '。' + (blocks.backup.length ? '請先貼下面的備份 SQL，確認筆數對得上，再做主要 SQL。' : (auto ? '這份檔案內容裡有自動備份的語句，執行時會自己先備份；退路另外還有整庫備份。' : '這份沒有獨立的備份檔，檔案裡也沒偵測到自動備份語句。請把上一個「套用前預覽」步驟輸出的現況（函式、政策、筆數）複製存到記事本，並以一開始做的整庫備份當退路；不確定怎麼存，這步先問 Claude 再做。'));
    }

    const stops = (STOPS[rs.no] || []).slice();
    if (blocks.verify.length) stops.push(VERIFY_STOP);
    const cautions = (CAUTIONS[rs.no] || []).slice();
    if (blocks.main.some((b) => /md5/i.test(b.sql) && /守衛/.test(b.sql))) cautions.push('這份檔頭有 md5 守衛：如果函式內容和預期不符，檔案會自己中止並顯示訊息。看到中止訊息就停下，不要硬跑。');
    if (needC) cautions.push('這份檔案以 BEGIN; 開頭、沒有自己的 COMMIT;：貼上執行並看過回傳的核對結果後，要另外貼 COMMIT;（確認）或 ROLLBACK;（放棄）。若貼 COMMIT; 時出現「沒有進行中的交易」之類訊息，代表資料沒寫入，請停下問 Claude。');

    let expect = EXPECT[rs.no];
    if (!expect) {
      if (kind === 'readonly') expect = READONLY_DEFAULT;
      else if (blocks.verify.length) expect = VERIFY_DEFAULT;
      else expect = NO_VERIFY_FILE;
    }

    const step = {
      id: 's' + String(rs.no).padStart(2, '0'),
      readmeNo: rs.no, readmeStage: rs.stageIdx,
      title: TITLES[rs.no], what: rs.what,
      kind, kindLabel: label, optional: OPTIONAL_README_STEPS.has(rs.no),
      backupText, readmeBackup: rs.backup, readmeRollback: rs.rollback,
      blocks, stops, cautions, expect, previewJudge: PREVIEW_JUDGE[rs.no] || '',
      commitText: needC ? '這份檔案不會自己提交。看過上面的核對結果沒問題，就貼 COMMIT; 單獨執行；有疑慮就貼 ROLLBACK;。忘了的話連線結束會自動回滾，等於沒做。' : '',
      rollbackText: (blocks.rollback.length || /無檔|交易內/.test(rs.rollback) ? '總表說明：' + rs.rollback + (blocks.rollback.length ? '' : '（沒有撤回檔）') : '')
        + (blocks.rollback.some((b) => needsCommit(b.sql)) ? '　注意：這份撤回檔也是 BEGIN; 開頭、沒有自己的 COMMIT;，貼上看過結果後要另外貼 COMMIT; 才會真的還原。' : ''),
      natureReadme: rs.nature,
    };
    if (rs.no === 9) step.cautions.push('一次只貼一份，貼之前先清空編輯器。15 份可以不分先後。');
    step.minutes = rs.no === 9 ? 20 : estimateMinutes(step);
    readmeSteps[rs.no] = step;
  }

  /* ---- 額外步驟（非 README 列表） ---- */
  const extra = {};
  extra.r4 = {
    id: 'x-r4', readmeNo: null, title: 'R4 判斷：舊草稿 w17_B／w18_B 跑過沒有', kind: 'readonly', kindLabel: '唯讀', optional: false,
    what: '用唯讀查詢自動判斷正式區有沒有跑過舊草稿 w17_B（改善回補）或 w18_B（評級快照）。m9 的 55、90 已取代它們，兩者擇一。結果決定後面 55、90 能不能照常做。',
    backupText: '', blocks: { backup: [], preview: [], main: [{ label: 'R4 判斷查詢（本產生器內建，唯讀）', file: '', sql: R4_CHECK_SQL }], commit: [], verify: [], rollback: [] },
    stops: [{ where: 'main', title: 'R4：結論欄是 STOP 就停下來聯絡 Claude', body: '結論欄（conclusion）若以 STOP 開頭，代表舊草稿 w17_B 或 w18_B 疑似在正式區跑過，或 55／90 的備份表已存在。不要繼續做 55、90（階段 1 的{{25}}、{{26}}）及後面的步驟，截圖給 Claude。' }],
    cautions: [],
    expect: '結果只有 1 列。結論欄寫「OK：兩份舊草稿都沒跑過，可以繼續」才算通過（欄位 w17_B_looks_applied、w18_B_looks_applied 都是 false）。\n結果 A（OK）：沒跑過，勾「已完成」「檢查通過」，照順序繼續。\n結果 B（STOP）：跑過，停下，截圖給 Claude。原因：55、90 會把「已被舊草稿改過的函式」當成原始版備份，之後撤回只能回到舊草稿版而不是最原始版；Claude 會先判斷 55／90 的備份基準是否需要調整（舊草稿自己的備份表 m4_w17_backup、m4_w18_backup 裡有最原始版本），再告訴你繼續還是調整。',
    minutes: 3, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.cronEnable = {
    id: 'x-cron-enable', readmeNo: null, title: '啟用 pg_cron 擴充', kind: 'manual', kindLabel: '手動操作（後台）', optional: false,
    what: '在 Supabase 後台啟用 pg_cron，讓「生效日到了的升遷」每天自動生效（老闆決定 R2：要開）。放在{{31}}之後，是為了避免草稿 30 一偵測到 pg_cron 就自己建「每分鐘」排程。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [{ label: '檢查：pg_cron 已啟用（唯讀）', file: '', sql: CRON_ENABLE_CHECK_SQL }], rollback: [] },
    stops: [], cautions: [],
    manualText: '1. 打開 Supabase 後台，確認左上角是「正式區」專案。\n2. 左側選 Database，再選 Extensions。\n3. 搜尋 pg_cron，把開關打開（schema 用預設即可）。\n4. 開好後，貼下面的檢查 SQL 執行。',
    expect: '檢查 SQL 回傳 1 列（extname 是 pg_cron）。沒有任何列＝還沒啟用成功，停下來重做第 3 點或問 Claude。',
    minutes: 4, rollbackText: '要停用：到 Database → Extensions 把 pg_cron 關掉（先問 Claude，這會連所有排程一起停）。', previewJudge: '', commitText: '',
  };
  extra.cronSchedule = {
    id: 'x-cron-schedule', readmeNo: null, title: '建立每日升遷生效排程（台北 00:05）', kind: 'add', kindLabel: '新增', optional: false,
    what: '建立排程：每天台北時間 00:05 執行 workspace_apply_due_promotions()。pg_cron 用 UTC，台北 00:05 就是 UTC 16:05（前一天），所以寫成 5 16 * * *。',
    backupText: '', blocks: { backup: [], preview: [], main: [{ label: '建立排程（本產生器內建）', file: '', sql: CRON_SCHEDULE_SQL }], commit: [], verify: [{ label: '檢查：排程是否存在', file: '', sql: CRON_CHECK_SQL }, { label: '隔天早上再看：最近執行結果', file: '', sql: CRON_RUNS_SQL }], rollback: [{ label: '撤回：取消排程', file: '', sql: CRON_UNSCHEDULE_SQL }] },
    stops: [VERIFY_STOP], cautions: ['前置：上一步（pg_cron 已啟用）與{{31}}（異動批次與每月人員名冊，才有最終版的 workspace_apply_due_promotions）都要完成。'],
    expect: '檢查 SQL 剛好 1 列：schedule 是「5 16 * * *」，active 是 true。12/8 早上再跑「最近執行結果」，status 應為 succeeded（00:05 之後才會有紀錄）。',
    minutes: 4, rollbackText: '', previewJudge: '', commitText: '',
  };
  const AUTH_BASE = path.join(PLAN_DIR, 'm9-sql', '95_role_permission_grants');
  extra.auth = {
    id: 'x-auth', readmeNo: null, title: '新權限授權（依權限勾選頁的決定）', kind: 'addmodify', kindLabel: '新增＋會改既有資料', optional: false,
    what: '依老闆在權限勾選頁送出的決定（2026-11-24，另在對話確認：總務服務中心先只給管理員、督導加回「看自己的管理日誌」），一次授權 33 組「角色＋權限」。只開不關：已有的不動，原本被關閉的打開。授權前的狀態記到 m9_role_grant_log，撤回只撤這一步加的。',
    backupText: '', blocks: { backup: [], preview: [],
      main: [{ label: '授權 33 組（可重複執行）', file: 'm9-sql/95_role_permission_grants.sql', sql: readUtf8(AUTH_BASE + '.sql') }],
      commit: [],
      verify: [{ label: '檢查：33 列都要 ok = true', file: 'm9-sql/95_role_permission_grants.verify.sql', sql: readUtf8(AUTH_BASE + '.verify.sql') }],
      rollback: [{ label: '撤回：只撤本步驟新增或打開的授權', file: 'm9-sql/95_role_permission_grants.rollback.sql', sql: readUtf8(AUTH_BASE + '.rollback.sql') }] },
    stops: [VERIFY_STOP],
    cautions: ['前置：補建權限碼那一步（{{15}}）、總務第 4 批與第 4.5 批的權限碼步驟都要先完成，否則有些配對會顯示「找不到」。', '總務服務中心這次刻意只給管理員：總務同仁與店長 12/8 起進不了總務服務中心，之後要開放再另外做一份授權。'],
    expect: '授權 SQL 最後一個查詢逐列列出結果，沒有「找不到」。檢查 SQL 33 列 ok 全部 true。',
    minutes: 10, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.cutover = {
    id: 'x-cutover', readmeNo: null, title: '切換開新版', kind: 'manual', kindLabel: '手動操作', optional: false,
    what: '資料庫與權限都就緒後，開啟新版：全部門市同一天切換，選單預設開新版，每頁都有「回舊版」連結。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] },
    stops: [{ where: 'main', title: '前面有任何一步沒勾「檢查通過」，或授權步驟還是占位，就先不要切換', body: '先回頭看哪一步沒完成；不確定就問 Claude。切換前先確認：R1 預覽已處理、R4 判斷是 OK、授權步驟已補完並做完。' }],
    cautions: [],
    manualText: '1. 回到上方，確認「必做」的步驟都已勾選完成與檢查通過。\n2. 依 Claude 在上線當天給你的切換指示，開啟新版（不是在 SQL Editor 做的事）。\n3. 用系統管理員帳號登入，點一下選單的任一個新版頁面，能正常打開、資料顯示正常。\n4. 再各用一個店長、督導、總務帳號登入，各點開一頁確認沒有出現「沒有權限」。',
    expect: '各角色帳號都能打開新版頁面，沒有紅色錯誤或空白頁。任何一個角色打不開，立刻回報 Claude，並先用下一步的「回舊版」連結救急。',
    minutes: 15, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.fallback = {
    id: 'x-fallback', readmeNo: null, title: '回舊版開關確認', kind: 'manual', kindLabel: '手動操作', optional: false,
    what: '確認「回舊版」的備援開關可用：{{16}}建好的兩張表在，系統管理員的「頁面回舊版設定」管理頁打得開。出問題時，管理員能單頁切回舊版，不需要重新部署。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] },
    stops: [], cautions: [],
    manualText: '1. 先貼下面的檢查 SQL（和{{16}}用的是同一份，唯讀），確認備援開關的表與函式都在。\n2. 用系統管理員帳號登入新版，打開「頁面回舊版設定」管理頁。\n3. 管理頁能打開、看得到頁面清單（不用真的切換任何一頁）。若想試一下：切一頁到舊版，確認選單改開舊版，馬上切回新版，並確認稽核紀錄有記到。\n4. 管理頁若出現「儲存失敗（503）」，代表{{16}}的表沒建好，停下問 Claude。',
    expect: '檢查 SQL 每一列 ok 都是 true；管理頁打得開、看得到清單。',
    minutes: 10, rollbackText: '', previewJudge: '', commitText: '',
  };
  // 備援開關的檢查 SQL 直接讀{{16}}用的 verify 檔（逐字）
  extra.fallback.blocks.verify.push(fileBlock(planDir, 'm9-sql/20261123150000_m9_page_fallbacks.verify.sql', '檢查：20261123150000_m9_page_fallbacks.verify.sql'));
  extra.fallback.stops.push(VERIFY_STOP);

  /* ---- 排序與分階段 ---- */
  const order = [];
  const stages = [];
  const addStage = (id, title, short, intro, items) => { stages.push({ id, title, short, intro, items }); };
  const rs = (a, b) => { const r = []; for (let i = a; i <= b; i++) if (readmeSteps[i]) r.push(readmeSteps[i]); return r; };
  const stageTitle = (i) => readmeStages[i].title.replace('　', '　');
  addStage('0', stageTitle(0), '0 上線前唯讀檢查', '只有 SELECT，不改任何資料，可全部先跑；最後一步是 R4 判斷。', [...rs(1, 14), extra.r4]);
  addStage('1', stageTitle(1), '1 M9 資料庫草稿', '照序號一步一步做，不能換順序（資料庫相依）。{{31}}之後接著設定每日升遷排程。', [...rs(15, 31), extra.cronEnable, extra.cronSchedule]);
  addStage('2', stageTitle(2), '2 客務、商品、語音、處方箋', '', rs(32, 38));
  addStage('3', stageTitle(3), '3 總務（第 1 到 6 批與第 4.5 批）', '每批先跑預覽再套用；撤回順序相反。', rs(39, 81));
  addStage('4', '階段 4　選用步驟（預設不做）', '4 選用', '原本總表階段 4 的授權類與舊草稿步驟已依老闆決定處理：補授權兩份不執行（改由權限勾選頁）、w17_B／w18_B 不執行（已由 55、90 取代）。只剩一個選用步驟。', rs(82, 82));
  addStage('5', '階段 5　新權限授權', '5 授權', '新版開啟前，依權限勾選頁（2026-11-24 已送出）授權 33 組角色權限。', [extra.auth]);
  addStage('6', '階段 6　切換開新版與回舊版確認', '6 切換開新版', '最後一階段。', [extra.cutover, extra.fallback]);

  let no = 0;
  const outStages = stages.map((st) => {
    const ids = [];
    st.items.forEach((s) => { no += 1; s.no = no; order.push(s); ids.push(s.id); });
    return { id: st.id, title: st.title, short: st.short, intro: st.intro, stepIds: ids };
  });

  // 文字裡的{{N}} 是「總表第 N 步」，換成頁面上實際顯示的序號（階段 0 多了 R4 判斷等，序號會和總表差幾號）
  const noByReadme = {};
  order.forEach((s) => { if (s.readmeNo) noByReadme[s.readmeNo] = s.no; });
  const resolveRefs = (v) => {
    if (typeof v === 'string') {
      return v.replace(/\{\{(\d+)\}\}/g, (all, n) => {
        if (!noByReadme[n]) throw new Error('文字引用了不存在的總表步驟：' + n);
        return '第 ' + noByReadme[n] + ' 步';
      });
    }
    if (Array.isArray(v)) return v.map(resolveRefs);
    if (v && typeof v === 'object') { Object.keys(v).forEach((k) => { if (k !== 'sql') v[k] = resolveRefs(v[k]); }); return v; }
    return v;
  };
  order.forEach((s) => resolveRefs(s));

  const stopList = [];
  order.forEach((s) => (s.stops || []).forEach((x) => {
    if (x === VERIFY_STOP) return; // 通用的「檢查不通過就停下」不逐步列出，頁首另有一句統一說明
    stopList.push({ stepId: s.id, no: s.no, stepTitle: s.title, where: x.where, title: x.title });
  }));
  const totalMin = order.reduce((a, s) => a + (s.optional ? 0 : s.minutes), 0);

  const model = {
    meta: {
      title: '正式區上線操作',
      runDate: '2026-12-07', goLiveDate: '2026-12-08',
      readmeStepCount: readme.steps.length,
      excludedReadmeSteps: Object.keys(EXCLUDED_README_STEPS).map(Number),
      stepCount: order.length, requiredStepCount: order.filter((s) => !s.optional).length,
      readmeStepsIncluded: order.filter((s) => s.readmeNo).length,
      extraStepIds: order.filter((s) => !s.readmeNo).map((s) => s.id),
      estMinutes: totalMin,
    },
    stages: outStages,
    steps: order,
    stopList,
    warnings,
  };
  return model;
}

/* ------------------------------------------------------------------ HTML */
function jsonForHtml(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderHtml(model) {
  const css = readUtf8(path.join(__dirname, 'style.css'));
  const js = readUtf8(path.join(__dirname, 'client.js'));
  const m = model.meta;
  const hours = Math.floor(m.estMinutes / 60), mins = m.estMinutes % 60;
  const est = (hours ? hours + ' 小時 ' : '') + mins + ' 分';
  const withBuffer = Math.ceil((m.estMinutes * 1.3) / 30) * 30;
  const bufH = Math.floor(withBuffer / 60), bufM = withBuffer % 60;
  const buf = (bufH ? bufH + ' 小時' : '') + (bufM ? ' ' + bufM + ' 分' : '');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正式區上線操作</title>
<style>
${css}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="eyebrow">富康菁英業務網　新版上線</div>
  <h1>正式區資料庫逐步操作</h1>
  <p>老闆在 2026-12-07（日）營業結束後，照著這一頁從上做到下。每一步貼上執行、看結果、勾選。進度會自動記住。</p>
  <div class="meta-row">
    <div class="meta"><span class="k">預定執行</span><span class="v">2026-12-07（日）晚上</span><span class="k">上線日 2026-12-08（一）</span></div>
    <div class="meta"><span class="k">現在時間</span><span class="v" id="clock">--</span></div>
    <div class="meta"><span class="k">總步驟數</span><span class="v">${m.stepCount} 步</span><span class="k">必做 ${m.requiredStepCount} 步，選用 ${m.stepCount - m.requiredStepCount} 步</span></div>
    <div class="meta"><span class="k">預估時間</span><span class="v">約 ${esc(est)}</span><span class="k">連同檢查與意外建議預留 ${esc(buf)}</span></div>
  </div>
  <div class="panels">
    <section class="panel">
      <h3>開始前先做（都做完再開始第 1 步）</h3>
      <ol>
        <li>在 Supabase 後台做「整庫備份」：Database → Backups，確認有可用的 Point-in-Time 還原點，或當日備份可還原；沒有的話，先下載最新的備份檔存到自己的電腦。備份完成時間記在第 1 步的備註欄。</li>
        <li>確認現在開的是「正式區」專案，不是 DEV：看左上角的專案名稱。不確定就先問 Claude，不要貼任何 SQL。</li>
        <li>SQL Editor 每次只貼一份：貼之前先把編輯器清空，按 Run，看完結果再貼下一份。不要把兩份連在一起貼。</li>
        <li>檔案是 BEGIN 開頭的（卡片會標示），不會自己提交：看過回傳的結果沒問題後，要另外貼 COMMIT; 單獨執行；有疑慮就貼 ROLLBACK;。</li>
        <li>照卡片順序做，不要跳步、不要換順序；資料庫之間有相依。</li>
      </ol>
    </section>
    <section class="panel err">
      <h3>出錯怎麼辦</h3>
      <ol>
        <li>立刻停下，不要繼續下一步，也不要重貼一次試試看。</li>
        <li>把畫面截圖（含紅色錯誤訊息和你貼的那一步序號）給 Claude。</li>
        <li>需要撤回時，才展開該步的「撤回」SQL，先問過 Claude 再貼。撤回順序與套用順序相反。</li>
        <li>所有 SQL 都是可重複執行的，但「出錯後自己亂重跑」不在其中，請先問。</li>
      </ol>
    </section>
    <section class="panel stops">
      <h3>停止點（遇到就停下，聯絡 Claude）</h3>
      <ul id="stop-list"></ul>
      <p class="hint">另外：任何一步的「檢查」只要有一列不是 true，也要停下。</p>
    </section>
  </div>
  <p class="sync-detail" id="sync-detail" hidden></p>
</div></header>

<div class="bar" role="region" aria-label="進度">
  <div class="wrap">
    <div class="prog">
      <div class="prog-line" id="prog-text">進度計算中…</div>
      <div class="track" role="progressbar" aria-label="完成進度" aria-valuemin="0" aria-valuenow="0" aria-valuemax="${m.requiredStepCount}"><div class="fill" id="prog-bar"></div></div>
    </div>
    <button type="button" class="btn" id="next-btn">跳到下一個未完成的步驟</button>
    <button type="button" class="btn ghost" id="sync-retry" hidden>重試儲存到雲端</button>
    <p class="sync" id="sync" role="status">正在連線雲端儲存…</p>
  </div>
</div>

<main class="wrap"><div class="layout">
  <aside class="side" aria-label="階段列表">
    <h3>階段</h3>
    <nav id="stage-nav"></nav>
    <button type="button" class="btn ghost" id="expand-first" style="width:100%;margin-top:8px">打開下一步</button>
  </aside>
  <div id="steps"></div>
</div></main>
<div class="wrap"><footer class="end">本頁由 scripts/m9-runbook/build.cjs 讀取 docs/vue-workspace/parity-plan 內的 SQL 草稿產生，SQL 為逐字嵌入。頁面本身不連資料庫，所有 SQL 都由人在正式區 SQL Editor 貼上執行。</footer></div>

<script id="rb-data" type="application/json">${jsonForHtml(model)}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ CLI */
function main() {
  const out = process.argv[2] || DEFAULT_OUT;
  const model = buildModel();
  const html = renderHtml(model);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log('輸出：' + out);
  console.log('步驟：' + model.meta.stepCount + '（總表 ' + model.meta.readmeStepCount + ' 步中排除 ' + model.meta.excludedReadmeSteps.join('、') + '，納入 ' + model.meta.readmeStepsIncluded + ' 步，另加 ' + model.meta.extraStepIds.length + ' 步）');
  console.log('預估分鐘：' + model.meta.estMinutes);
  console.log('大小：' + Math.round(Buffer.byteLength(html) / 1024) + ' KB');
}

module.exports = { buildModel, renderHtml, parseReadme, needsCommit, EXCLUDED_README_STEPS, PLAN_DIR };
if (require.main === module) {
  try { main(); } catch (e) { console.error('產生失敗：' + e.message); process.exit(1); }
}
